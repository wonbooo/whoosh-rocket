use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindow};

const ICON_WIDTH: f64 = 96.0;
const ICON_HEIGHT: f64 = 175.0;

#[derive(Serialize, Deserialize)]
struct SavedPos {
    x: i32,
    y: i32,
}

pub fn install(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let desktop_only = std::env::args().any(|arg| arg == "--desktop-only");
    if let Some(main) = app.get_webview_window("main") {
        if desktop_only {
            let _ = main.hide();
        } else {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        "desktop-icon",
        WebviewUrl::App("index.html?view=desktop-icon".into()),
    )
    .title("咻咻小火箭")
    .inner_size(ICON_WIDTH, ICON_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .focused(false)
    .visible(true)
    .closable(false)
    .minimizable(false)
    .maximizable(false)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .build()?;

    #[cfg(windows)]
    {
        let handle = app.handle().clone();
        place_on_desktop(&handle, &window);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = app.get_webview_window("desktop-icon") {
                    place_on_desktop(&app, &window);
                }
            });
        });
        if !cfg!(debug_assertions) {
            let _ = register_autostart();
        }
    }

    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "desktop-icon-open" => show_main(app),
        "desktop-icon-quit" => app.exit(0),
        _ => {}
    }
}

#[tauri::command]
pub fn desktop_icon_open(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn desktop_icon_menu(app: AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};

    let window = app
        .get_webview_window("desktop-icon")
        .ok_or("没有桌面图标窗口")?;
    let open = MenuItem::with_id(&app, "desktop-icon-open", "打开", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let quit = MenuItem::with_id(&app, "desktop-icon-quit", "退出", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &quit]).map_err(|err| err.to_string())?;
    window.popup_menu(&menu).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desktop_icon_nudge(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("desktop-icon")
        .ok_or("没有桌面图标窗口")?;
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let px = (dx * scale).round() as i32;
    let py = (dy * scale).round() as i32;
    if px == 0 && py == 0 {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        nudge(hwnd, px, py).map_err(|err| err.to_string())?;
        if let Some((x, y)) = screen_origin(hwnd) {
            save_pos(&app, x, y);
        }
    }

    #[cfg(not(windows))]
    {
        let position = window.outer_position().map_err(|err| err.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(
                position.x + px,
                position.y + py,
            ))
            .map_err(|err| err.to_string())?;
        save_pos(&app, position.x + px, position.y + py);
    }

    Ok(())
}

fn pos_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("desktop-icon.json"))
}

fn save_pos(app: &AppHandle, x: i32, y: i32) {
    let Some(path) = pos_path(app) else {
        return;
    };
    let _ = std::fs::write(
        path,
        serde_json::to_string(&SavedPos { x, y }).unwrap_or_default(),
    );
}

fn load_pos(app: &AppHandle) -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(pos_path(app)?).ok()?;
    let saved: SavedPos = serde_json::from_str(&text).ok()?;
    Some((saved.x, saved.y))
}

#[cfg(windows)]
fn place_on_desktop(app: &AppHandle, window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::SetParent;

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        if let Some(host) = desktop_host() {
            let _ = SetParent(hwnd, Some(host));
        }
    }
    let size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
        ICON_WIDTH as u32,
        ICON_HEIGHT as u32,
    ));
    let (x, y) =
        load_pos(app).unwrap_or_else(|| default_pos(size.width as i32, size.height as i32));
    let (x, y) = clamp_pos(x, y, size.width as i32, size.height as i32);
    let _ = move_to_screen(hwnd, x, y);
    save_pos(app, x, y);
}

#[cfg(windows)]
fn register_autostart() -> std::io::Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let exe = std::env::current_exe()?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )?;
    let command = format!("\"{}\" --desktop-only", exe.display());
    key.set_value("WhooshRocket", &command)?;
    Ok(())
}

#[cfg(windows)]
fn work_area() -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    unsafe {
        let mut rect = RECT::default();
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut rect as *mut RECT as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
        Some((rect.left, rect.top, rect.right, rect.bottom))
    }
}

#[cfg(windows)]
fn default_pos(width: i32, height: i32) -> (i32, i32) {
    let (left, top, right, bottom) = work_area().unwrap_or((0, 0, 1280, 800));
    let x = right - width - 24;
    let y = top + 24;
    clamp_pos_in(x, y, width, height, left, top, right, bottom)
}

#[cfg(windows)]
fn clamp_pos(x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
    let (left, top, right, bottom) = work_area().unwrap_or((0, 0, 1920, 1080));
    clamp_pos_in(x, y, width, height, left, top, right, bottom)
}

#[cfg(windows)]
fn clamp_pos_in(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> (i32, i32) {
    let max_x = (right - width).max(left);
    let max_y = (bottom - height).max(top);
    (x.clamp(left, max_x), y.clamp(top, max_y))
}

#[cfg(windows)]
fn desktop_host() -> Option<windows::Win32::Foundation::HWND> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowW, SendMessageTimeoutW, SMTO_NORMAL,
    };

    unsafe {
        let progman = FindWindowW(w!("Progman"), PCWSTR::null()).ok()?;
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            1000,
            None,
        );
        let mut host = progman;
        let slot = &mut host as *mut HWND;
        let _ = EnumWindows(Some(enum_desktop), LPARAM(slot as isize));
        Some(host)
    }
}

#[cfg(windows)]
unsafe extern "system" fn enum_desktop(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;

    if let Ok(defview) = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
        if !defview.0.is_null() {
            let slot = lparam.0 as *mut HWND;
            if !slot.is_null() {
                *slot = hwnd;
            }
        }
    }
    windows::core::BOOL(1)
}

#[cfg(windows)]
fn screen_origin(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        Some((rect.left, rect.top))
    }
}

#[cfg(windows)]
fn parent_point(hwnd: windows::Win32::Foundation::HWND, x: i32, y: i32) -> (i32, i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::WindowsAndMessaging::GetParent;

    unsafe {
        let Ok(parent) = GetParent(hwnd) else {
            return (x, y);
        };
        let mut point = POINT { x, y };
        if !ScreenToClient(parent, &mut point).as_bool() {
            return (x, y);
        }
        (point.x, point.y)
    }
}

#[cfg(windows)]
fn move_to_screen(
    hwnd: windows::Win32::Foundation::HWND,
    x: i32,
    y: i32,
) -> windows::core::Result<()> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOSIZE,
    };

    let (x, y) = parent_point(hwnd, x, y);
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        )
    }
}

#[cfg(windows)]
fn nudge(hwnd: windows::Win32::Foundation::HWND, dx: i32, dy: i32) -> windows::core::Result<()> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };

    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        let (x, y) = parent_point(hwnd, rect.left + dx, rect.top + dy);
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        )
    }
}
