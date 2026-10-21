use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

pub fn chat_completions_url(base: &str) -> Result<String, String> {
    let trimmed = base.trim().trim_end_matches('/');
    let base = if trimmed.is_empty() {
        "http://127.0.0.1:4000/v1"
    } else {
        trimmed
    };
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("FreeLM 地址需要以 http:// 或 https:// 开头".into());
    }
    if base.ends_with("/chat/completions") {
        return Ok(base.to_string());
    }
    Ok(format!("{base}/chat/completions"))
}

pub fn is_loopback_url(url: &str) -> bool {
    let rest = url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = rest.split('/').next().unwrap_or("");
    let host = host.rsplit_once('@').map(|(_, host)| host).unwrap_or(host);
    let host = if let Some(host) = host.strip_prefix('[') {
        host.split(']').next().unwrap_or(host)
    } else {
        host.split(':').next().unwrap_or(host)
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

pub fn listen_port(url: &str) -> Result<u16, String> {
    let trimmed = url.trim();
    let rest = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let authority = rest.split('/').next().unwrap_or("");
    let hostport = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    let port_text = if let Some(rest) = hostport.strip_prefix('[') {
        rest.split_once(']')
            .and_then(|(_, after)| after.strip_prefix(':'))
    } else {
        hostport.rsplit_once(':').map(|(_, port)| port)
    };
    match port_text {
        Some(port) => port
            .parse::<u16>()
            .map_err(|_| format!("FreeLM 端口无效：{port}")),
        None => Ok(if trimmed.starts_with("https://") {
            443
        } else {
            80
        }),
    }
}

pub fn health_url(chat_url: &str) -> String {
    const MARKER: &str = "/v1/chat/completions";
    if let Some(index) = chat_url.find(MARKER) {
        return format!("{}/health", &chat_url[..index]);
    }
    format!("{}/health", chat_url.trim_end_matches('/'))
}

pub fn is_our_runtime_image(path: &str) -> bool {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    let name = path.rsplit('/').next().unwrap_or("");
    (name == "node.exe" || name == "node") && path.contains("/freelm/")
}

pub fn serve_arguments(script: &Path, port: u16, api_key: &str) -> Vec<String> {
    vec![
        script.to_string_lossy().into_owned(),
        "serve".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--api-key".into(),
        api_key.to_string(),
        "--quiet".into(),
    ]
}

pub fn text_from_body(body: &str) -> Result<String, String> {
    let trimmed = body.trim();
    if trimmed.starts_with("data:") {
        return text_from_sse(trimmed);
    }
    let parsed: Value = serde_json::from_str(trimmed)
        .map_err(|_| format!("FreeLM 响应不是 JSON：{}", snippet(trimmed)))?;
    if let Some(message) = parsed["error"]["message"].as_str() {
        let message = message.trim();
        if !message.is_empty() {
            return Err(message.to_string());
        }
    }
    completion_text(&parsed)
}

fn text_from_sse(body: &str) -> Result<String, String> {
    let mut text = String::new();
    for line in body.lines() {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if let Some(message) = value["error"]["message"].as_str() {
            return Err(message.trim().to_string());
        }
        let delta = &value["choices"][0]["delta"]["content"];
        if let Some(part) = delta.as_str() {
            text.push_str(part);
            continue;
        }
        if let Ok(part) = completion_text(&value) {
            text.push_str(&part);
        }
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("FreeLM 没有返回文本".into());
    }
    Ok(text.to_string())
}

pub fn completion_text(value: &Value) -> Result<String, String> {
    let content = &value["choices"][0]["message"]["content"];
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if let Some(parts) = content.as_array() {
        let text: String = parts
            .iter()
            .filter_map(|part| part["text"].as_str().or_else(|| part.as_str()))
            .collect();
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }
    Err("FreeLM 没有返回文本".into())
}

fn resolved_secret(value: &str, env_name: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    std::env::var(env_name)
        .ok()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn snippet(body: &str) -> String {
    body.chars()
        .filter(|ch| !ch.is_control())
        .take(180)
        .collect()
}

struct OwnedServer {
    child: Option<Child>,
    pid: u32,
    pid_file: PathBuf,
}

static OWNED: Mutex<Option<OwnedServer>> = Mutex::new(None);

fn lock_owned() -> std::sync::MutexGuard<'static, Option<OwnedServer>> {
    OWNED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Remember a FreeLM process this app started in an earlier run, so closing
/// the app still stops it.
pub fn adopt_existing(app: &AppHandle) {
    let Ok(path) = pid_file(app) else {
        return;
    };
    let mut guard = lock_owned();
    adopt(&mut guard, &path);
}

pub fn shutdown() {
    let owned = {
        let mut guard = lock_owned();
        guard.take()
    };
    if let Some(owned) = owned {
        stop_owned(owned);
    }
}

#[tauri::command]
pub async fn freelm_complete(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
    system: String,
    user: String,
) -> Result<String, String> {
    let url = chat_completions_url(&resolved_secret(
        &base_url,
        "FREELM_BASE_URL",
        "http://127.0.0.1:4000/v1",
    ))?;
    let key = resolved_secret(&api_key, "FREELM_API_KEY", "freelm");
    let model = resolved_secret(&model, "FREELM_MODEL", "auto");
    let user = if user.chars().count() > 16_000 {
        user.chars().take(16_000).collect()
    } else {
        user
    };
    let client = http_client(90)?;
    let payload = serde_json::json!({
        "model": model,
        "temperature": 0.2,
        "stream": false,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    match post_chat(&client, &url, &key, &payload).await {
        Ok(text) => Ok(text),
        Err(ChatError::Transport(err)) if err.is_connect() && is_loopback_url(&url) => {
            ensure_local_server(&app, &url, &key).await?;
            post_chat(&client, &url, &key, &payload)
                .await
                .map_err(|err| match err {
                    ChatError::Transport(err) => transport_error(&err, &url),
                    ChatError::Remote(message) => message,
                })
        }
        Err(ChatError::Transport(err)) => Err(transport_error(&err, &url)),
        Err(ChatError::Remote(message)) => Err(message),
    }
}

fn transport_error(err: &reqwest::Error, url: &str) -> String {
    if err.is_timeout() {
        return format!("FreeLM 已连接，但 90 秒内没有返回结果（{url}）。");
    }
    if err.is_connect() {
        return format!("连不上 FreeLM（{url}）。");
    }
    format!("FreeLM 请求失败：{err}")
}

enum ChatError {
    Transport(reqwest::Error),
    Remote(String),
}

async fn post_chat(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    payload: &Value,
) -> Result<String, ChatError> {
    let response = client
        .post(url)
        .bearer_auth(key)
        .json(payload)
        .send()
        .await
        .map_err(ChatError::Transport)?;
    let status = response.status();
    let body = response.text().await.map_err(ChatError::Transport)?;
    if body.len() > 1_000_000 {
        return Err(ChatError::Remote("FreeLM 响应过长".into()));
    }
    if !status.is_success() {
        return Err(ChatError::Remote(remote_status_message(status, &body)));
    }
    text_from_body(&body).map_err(ChatError::Remote)
}

async fn ensure_local_server(app: &AppHandle, chat_url: &str, api_key: &str) -> Result<(), String> {
    let port = listen_port(chat_url)?;
    let pid_path = pid_file(app)?;
    let log_path = freelm_log(app);
    {
        let mut guard = lock_owned();
        adopt(&mut guard, &pid_path);
        reap_if_exited(&mut guard);
    }
    if health_ok(chat_url).await {
        return Ok(());
    }
    {
        let mut guard = lock_owned();
        reap_if_exited(&mut guard);
        if matches!(guard.as_ref(), Some(owned) if owned.child.is_none()) {
            if let Some(owned) = guard.take() {
                drop(guard);
                stop_owned(owned);
            }
        }
    }
    {
        let mut guard = lock_owned();
        reap_if_exited(&mut guard);
        if !owned_running(&guard) {
            let runtime = find_runtime(app)?;
            let child = spawn_server(&runtime, port, api_key, &log_path)?;
            let pid = child.id();
            let _ = std::fs::write(&pid_path, pid.to_string());
            assign_job(pid);
            *guard = Some(OwnedServer {
                child: Some(child),
                pid,
                pid_file: pid_path,
            });
        }
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
    while std::time::Instant::now() < deadline {
        if health_ok(chat_url).await {
            return Ok(());
        }
        let mut guard = lock_owned();
        if let Some(status) = reap_if_exited(&mut guard) {
            return Err(format!(
                "FreeLM 进程已退出（{status}）。{}",
                log_tail(&log_path)
            ));
        }
        drop(guard);
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    Err(format!(
        "已启动应用内的 FreeLM，但 45 秒内没有就绪。{}",
        log_tail(&log_path)
    ))
}

fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    // A system proxy turns http://127.0.0.1 into "502 Bad Gateway" with an empty body.
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .no_proxy()
        .build()
        .map_err(|err| format!("无法创建 FreeLM 客户端：{err}"))
}

fn remote_status_message(status: reqwest::StatusCode, body: &str) -> String {
    if let Some(message) = json_error_message(body) {
        return format!("FreeLM 返回 {status}：{message}");
    }
    let text = snippet(body.trim());
    if text.is_empty() {
        format!("FreeLM 返回 {status}")
    } else {
        format!("FreeLM 返回 {status}：{text}")
    }
}

fn json_error_message(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body.trim()).ok()?;
    let message = parsed["error"]["message"].as_str()?.trim();
    if message.is_empty() {
        None
    } else {
        Some(message.to_string())
    }
}

async fn health_ok(chat_url: &str) -> bool {
    let Ok(client) = http_client(1) else {
        return false;
    };
    client
        .get(health_url(chat_url))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

struct Runtime {
    node: PathBuf,
    script: PathBuf,
    root: PathBuf,
}

fn find_runtime(app: &AppHandle) -> Result<Runtime, String> {
    let mut dirs = Vec::new();
    if cfg!(debug_assertions) {
        dirs.push(manifest_runtime());
    }
    if let Ok(resource) = app.path().resource_dir() {
        dirs.push(resource.join("resources").join("freelm"));
        dirs.push(resource.join("freelm"));
    }
    if !cfg!(debug_assertions) {
        dirs.push(manifest_runtime());
    }
    for dir in dirs {
        let node = dir.join(node_binary_name());
        let script = dir
            .join("node_modules")
            .join("freelm")
            .join("bin")
            .join("freelm.mjs");
        if node.is_file() && script.is_file() {
            return Ok(Runtime {
                node: plain_windows_path(&node),
                script: plain_windows_path(&script),
                root: plain_windows_path(&dir),
            });
        }
    }
    Err(missing_runtime_message())
}

fn manifest_runtime() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("freelm")
}

/// Node 24 resolves `\\?\C:\...` as the drive root and exits with
/// `EISDIR: lstat 'C:'`. Spawn paths have to be ordinary Windows paths.
fn plain_windows_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn missing_runtime_message() -> String {
    if cfg!(debug_assertions) {
        "应用内没有找到 FreeLM 运行时。请先运行 npm run vendor:freelm，再重新编译桌面应用。".into()
    } else {
        "应用内没有附带 FreeLM 运行时，请重新安装应用。".into()
    }
}

fn spawn_server(
    runtime: &Runtime,
    port: u16,
    api_key: &str,
    log_path: &Path,
) -> Result<Child, String> {
    let _ = log_path.parent().map(std::fs::create_dir_all);
    let stdout = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|err| format!("无法写 FreeLM 日志：{err}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|err| format!("无法写 FreeLM 日志：{err}"))?;
    let mut command = Command::new(&runtime.node);
    command
        .args(serve_arguments(&runtime.script, port, api_key))
        .current_dir(&runtime.root)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map_err(|err| format!("没能启动应用内的 FreeLM：{err}"))
}

fn pid_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("无法创建数据目录：{err}"))?;
    Ok(dir.join("freelm.pid"))
}

fn freelm_log(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("freelm.log")
}

fn adopt(guard: &mut Option<OwnedServer>, pid_file: &Path) {
    if guard.is_some() {
        return;
    }
    let Ok(text) = std::fs::read_to_string(pid_file) else {
        return;
    };
    let Ok(pid) = text.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(pid_file);
        return;
    };
    if pid == 0 || !process_is_our_runtime(pid) {
        let _ = std::fs::remove_file(pid_file);
        return;
    }
    *guard = Some(OwnedServer {
        child: None,
        pid,
        pid_file: pid_file.to_path_buf(),
    });
}

fn owned_running(guard: &Option<OwnedServer>) -> bool {
    match guard {
        Some(owned) if owned.child.is_some() => true,
        Some(owned) => process_is_our_runtime(owned.pid),
        None => false,
    }
}

fn reap_if_exited(guard: &mut Option<OwnedServer>) -> Option<String> {
    let owned = guard.as_mut()?;
    if let Some(child) = owned.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                let pid_file = owned.pid_file.clone();
                let _ = std::fs::remove_file(pid_file);
                *guard = None;
                return Some(status.to_string());
            }
            Ok(None) => return None,
            Err(err) => return Some(err.to_string()),
        }
    }
    if !process_is_our_runtime(owned.pid) {
        let pid_file = owned.pid_file.clone();
        let _ = std::fs::remove_file(pid_file);
        *guard = None;
    }
    None
}

fn stop_owned(mut owned: OwnedServer) {
    kill_pid(owned.pid);
    if let Some(mut child) = owned.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if !process_is_our_runtime(owned.pid) {
        let _ = std::fs::remove_file(owned.pid_file);
    }
}

fn kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn log_tail(path: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let text = text.trim();
    if text.is_empty() {
        return String::new();
    }
    let tail: String = text.chars().rev().take(800).collect();
    let tail: String = tail.chars().rev().collect();
    format!(" {tail}")
}

fn process_is_our_runtime(pid: u32) -> bool {
    process_image(pid).is_some_and(|path| is_our_runtime_image(&path))
}

#[cfg(windows)]
fn process_image(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        queried.ok()?;
        let len = len as usize;
        if len > buffer.len() {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..len]))
    }
}

#[cfg(not(windows))]
fn process_image(pid: u32) -> Option<String> {
    let _ = pid;
    None
}

#[cfg(windows)]
fn assign_job(pid: u32) {
    use std::sync::OnceLock;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    static JOB: OnceLock<isize> = OnceLock::new();
    let raw = *JOB.get_or_init(|| unsafe { create_kill_on_close_job().unwrap_or(0) });
    if raw == 0 {
        return;
    }
    let job = HANDLE(raw as *mut core::ffi::c_void);
    let Ok(process) = (unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) })
    else {
        return;
    };
    let _ = unsafe { AssignProcessToJobObject(job, process) };
    let _ = unsafe { CloseHandle(process) };
}

#[cfg(windows)]
unsafe fn create_kill_on_close_job() -> Result<isize, ()> {
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(|_| ())?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|_| ())?;
    Ok(job.0 as isize)
}

#[cfg(not(windows))]
fn assign_job(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::{
        chat_completions_url, completion_text, health_url, is_loopback_url, is_our_runtime_image,
        listen_port, plain_windows_path, remote_status_message, serve_arguments, shutdown,
        text_from_body,
    };
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn builds_the_local_openai_compatible_endpoint() {
        assert_eq!(
            chat_completions_url("http://127.0.0.1:4000/v1").unwrap(),
            "http://127.0.0.1:4000/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:4000/v1/chat/completions/").unwrap(),
            "http://127.0.0.1:4000/v1/chat/completions"
        );
        assert!(chat_completions_url("file:///tmp/freelm").is_err());
    }

    #[test]
    fn reads_string_and_part_message_content() {
        let text = json!({
            "choices": [{ "message": { "content": " {\"items\":[]} " } }]
        });
        assert_eq!(completion_text(&text).unwrap(), "{\"items\":[]}");
        let parts = json!({
            "choices": [{ "message": { "content": [{ "text": "甲" }, { "text": "乙" }] } }]
        });
        assert_eq!(completion_text(&parts).unwrap(), "甲乙");
        assert!(completion_text(&json!({})).is_err());
    }

    #[test]
    fn local_health_url_and_sse_text() {
        assert!(is_loopback_url("http://127.0.0.1:4000/v1/chat/completions"));
        assert!(!is_loopback_url("https://example.com/v1/chat/completions"));
        assert_eq!(
            health_url("http://127.0.0.1:4000/v1/chat/completions"),
            "http://127.0.0.1:4000/health"
        );
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"甲\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"乙\"}}]}\n\ndata: [DONE]\n";
        assert_eq!(text_from_body(sse).unwrap(), "甲乙");
    }

    #[test]
    fn bundled_server_uses_its_own_node_and_port() {
        assert_eq!(
            listen_port("http://127.0.0.1:4000/v1/chat/completions").unwrap(),
            4000
        );
        assert_eq!(listen_port("http://[::1]:4001/v1").unwrap(), 4001);
        assert!(listen_port("http://127.0.0.1:nope/v1").is_err());
        let args = serve_arguments(Path::new("freelm.mjs"), 4000, "freelm");
        assert!(args.iter().any(|arg| arg == "serve"));
        assert!(args.iter().any(|arg| arg == "4000"));
        assert!(!args.iter().any(|arg| arg == "npx"));
        assert!(is_our_runtime_image(
            r"C:\Program Files\咻咻小火箭\resources\freelm\node.exe"
        ));
        assert!(!is_our_runtime_image(r"C:\Program Files\nodejs\node.exe"));
        shutdown();
    }

    #[test]
    fn node_spawn_paths_drop_the_windows_verbatim_prefix() {
        let plain = Path::new(r"C:\app\resources\freelm\node.exe");
        assert_eq!(plain_windows_path(plain), plain);
        #[cfg(windows)]
        {
            assert_eq!(
                plain_windows_path(Path::new(r"\\?\C:\app\resources\freelm\node.exe")),
                Path::new(r"C:\app\resources\freelm\node.exe")
            );
            assert_eq!(
                plain_windows_path(Path::new(r"\\?\UNC\server\share\node.exe")),
                Path::new(r"\\server\share\node.exe")
            );
        }
    }

    #[test]
    fn gateway_status_keeps_the_provider_message() {
        let body = r#"{"error":{"message":"all providers exhausted","type":"upstream_error"}}"#;
        assert_eq!(
            remote_status_message(reqwest::StatusCode::BAD_GATEWAY, body),
            "FreeLM 返回 502 Bad Gateway：all providers exhausted"
        );
        assert_eq!(
            remote_status_message(reqwest::StatusCode::BAD_GATEWAY, "   "),
            "FreeLM 返回 502 Bad Gateway"
        );
    }
}
