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
    .visible(false)
    .closable(false)
    .minimizable(false)
    .maximizable(false)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .build()?;
    let _ = window.set_ignore_cursor_events(false);

    #[cfg(windows)]
    {
        let handle = app.handle().clone();
        place_on_desktop(&handle, &window);
        install_mouse_hook(handle.clone());
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
    #[cfg(windows)]
    {
        let _ = app;
        return post_icon_menu();
    }
    #[cfg(not(windows))]
    {
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
}

#[tauri::command]
pub fn desktop_icon_nudge(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("desktop-icon")
        .ok_or("没有桌面图标窗口")?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (px, py) = physical_delta(dx, dy, scale);
    nudge_physical(&app, px, py)
}

#[derive(Debug, PartialEq, Eq)]
enum ClickAction {
    DragEnd,
    Arm,
    Open,
}

fn drag_target(win_x: i32, win_y: i32, down_x: i32, down_y: i32, x: i32, y: i32) -> (i32, i32) {
    (
        win_x.saturating_add(x.saturating_sub(down_x)),
        win_y.saturating_add(y.saturating_sub(down_y)),
    )
}

fn physical_delta(dx: f64, dy: f64, scale: f64) -> (i32, i32) {
    let factor = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    ((dx * factor).round() as i32, (dy * factor).round() as i32)
}

#[derive(Debug, PartialEq, Eq)]
enum IconMenuAction {
    Open,
    Quit,
}

fn icon_menu_action(command: i32) -> Option<IconMenuAction> {
    match command {
        1 => Some(IconMenuAction::Open),
        2 => Some(IconMenuAction::Quit),
        _ => None,
    }
}

fn classify_click(moved: bool, last_ms: Option<u32>, now_ms: u32, double_ms: u32) -> ClickAction {
    if moved {
        return ClickAction::DragEnd;
    }
    if let Some(last) = last_ms {
        if now_ms.wrapping_sub(last) <= double_ms {
            return ClickAction::Open;
        }
    }
    ClickAction::Arm
}

fn point_in_rect(x: i32, y: i32, left: i32, top: i32, right: i32, bottom: i32) -> bool {
    x >= left && x < right && y >= top && y < bottom
}

fn nudge_physical(app: &AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    if dx == 0 && dy == 0 {
        return Ok(());
    }
    let window = app
        .get_webview_window("desktop-icon")
        .ok_or("没有桌面图标窗口")?;

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        nudge(hwnd, dx, dy).map_err(|err| err.to_string())?;
        if let Some((x, y)) = screen_origin(hwnd) {
            save_pos(app, x, y);
        }
    }

    #[cfg(not(windows))]
    {
        let position = window.outer_position().map_err(|err| err.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(
                position.x + dx,
                position.y + dy,
            ))
            .map_err(|err| err.to_string())?;
        save_pos(app, position.x + dx, position.y + dy);
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
struct IconDrag {
    down_x: i32,
    down_y: i32,
    win_x: i32,
    win_y: i32,
    moved: bool,
}

#[cfg(windows)]
static ICON_APP: std::sync::Mutex<Option<AppHandle>> = std::sync::Mutex::new(None);
#[cfg(windows)]
static ICON_DRAG: std::sync::Mutex<Option<IconDrag>> = std::sync::Mutex::new(None);
#[cfg(windows)]
static ICON_CLICK_MS: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);
#[cfg(windows)]
static MENU_OWNER: std::sync::Mutex<isize> = std::sync::Mutex::new(0);
#[cfg(windows)]
static MENU_QUEUED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(windows)]
static MENU_OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn install_mouse_hook(app: AppHandle) {
    {
        let mut guard = ICON_APP.lock().unwrap_or_else(|err| err.into_inner());
        if guard.is_some() {
            return;
        }
        *guard = Some(app);
    }
    if let Err(err) = ensure_menu_owner() {
        log::warn!("桌面图标菜单窗口没有建起来: {err}");
    }
    let installed = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowsHookExW(
            windows::Win32::UI::WindowsAndMessaging::WH_MOUSE_LL,
            Some(icon_mouse_hook),
            None,
            0,
        )
    };
    match installed {
        Ok(_) => {}
        Err(_) => log::warn!("桌面图标鼠标钩子没有装上，退回窗口内的点击处理"),
    }
}

#[cfg(windows)]
unsafe extern "system" fn icon_mouse_hook(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_RBUTTONDOWN,
        WM_RBUTTONUP,
    };

    if code < 0 || MENU_OPEN.load(std::sync::atomic::Ordering::SeqCst) {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    let app = {
        let guard = ICON_APP.lock().unwrap_or_else(|err| err.into_inner());
        (*guard).clone()
    };
    let Some(app) = app else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let Some(window) = app.get_webview_window("desktop-icon") else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let Ok(hwnd) = window.hwnd() else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
    let screen = (info.pt.x, info.pt.y);
    let Some((rect, inside)) = icon_hit(hwnd, screen.0, screen.1) else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let message = wparam.0 as u32;
    let pass = || unsafe { CallNextHookEx(None, code, wparam, lparam) };

    if message == WM_LBUTTONDOWN {
        if !inside {
            let mut drag = ICON_DRAG.lock().unwrap_or_else(|err| err.into_inner());
            *drag = None;
            return pass();
        }
        accept_mouse(hwnd);
        raise_top(hwnd);
        let (win_x, win_y) = screen_origin(hwnd).unwrap_or((rect.0, rect.1));
        let mut drag = ICON_DRAG.lock().unwrap_or_else(|err| err.into_inner());
        *drag = Some(IconDrag {
            down_x: screen.0,
            down_y: screen.1,
            win_x,
            win_y,
            moved: false,
        });
        return LRESULT(1);
    }

    if message == WM_MOUSEMOVE {
        // Only a move that belongs to a drag started on the icon may be eaten.
        // Swallowing every move in the system freezes the desktop's own dragging.
        let target = {
            let mut drag = ICON_DRAG.lock().unwrap_or_else(|err| err.into_inner());
            drag.as_mut().map(|state| {
                let dx = screen.0.saturating_sub(state.down_x) as i64;
                let dy = screen.1.saturating_sub(state.down_y) as i64;
                if dx * dx + dy * dy >= 16 {
                    state.moved = true;
                }
                drag_target(
                    state.win_x,
                    state.win_y,
                    state.down_x,
                    state.down_y,
                    screen.0,
                    screen.1,
                )
            })
        };
        let Some((x, y)) = target else {
            return pass();
        };
        let (x, y) = clamp_pos(x, y, rect.2 - rect.0, rect.3 - rect.1);
        let _ = move_to_screen(hwnd, x, y);
        // Swallowing the move would freeze the system cursor at the press
        // point, so the icon would look like it springs back.
        return pass();
    }

    if message == WM_LBUTTONUP {
        // The button going up anywhere ends the drag, even outside the icon,
        // otherwise the icon keeps following the pointer forever.
        let state = ICON_DRAG
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .take();
        let Some(state) = state else {
            return pass();
        };
        let action = {
            let mut last = ICON_CLICK_MS.lock().unwrap_or_else(|err| err.into_inner());
            let now = info.time;
            let action = classify_click(state.moved, *last, now, 500);
            *last = match action {
                ClickAction::Arm => Some(now),
                ClickAction::Open | ClickAction::DragEnd => None,
            };
            action
        };
        if action == ClickAction::Open {
            show_main(&app);
        } else if let Some((x, y)) = screen_origin(hwnd) {
            save_pos(&app, x, y);
        }
        return LRESULT(1);
    }

    if message == WM_RBUTTONDOWN && inside {
        return LRESULT(1);
    }
    if message == WM_RBUTTONUP && inside {
        let _ = post_icon_menu();
        return LRESULT(1);
    }
    pass()
}

#[cfg(windows)]
fn apply_desktop_style(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CHILD,
        WS_CLIPCHILDREN, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
    };

    unsafe {
        // The window is parented onto the desktop host, so it has to be a child
        // window. A popup keeps its own top-level frame, which is the rectangle
        // that paints over the desktop icons underneath.
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let next = (style & !WS_POPUP.0) | WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPCHILDREN.0;
        if next != style {
            SetWindowLongPtrW(hwnd, GWL_STYLE, next as isize);
        }
        // WS_EX_LAYERED is what lets the transparent parts of a child window pass
        // through instead of painting an opaque plate. WS_EX_NOACTIVATE keeps a
        // click from pulling the desktop host to the front.
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next_ex = ex | WS_EX_LAYERED.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0;
        if next_ex != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_ex as isize);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(windows)]
fn accept_mouse(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_TRANSPARENT,
    };

    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let cleared = ex & !WS_EX_TRANSPARENT.0;
        if cleared != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, cleared as isize);
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(windows)]
fn enable_per_pixel_alpha(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Graphics::Dwm::{
        DwmEnableBlurBehindWindow, DwmExtendFrameIntoClientArea, DWM_BB_BLURREGION, DWM_BB_ENABLE,
        DWM_BLURBEHIND,
    };
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
    use windows::Win32::UI::Controls::MARGINS;

    let region = unsafe { CreateRectRgn(0, 0, -1, -1) };
    if region.is_invalid() {
        return;
    }
    let blur = DWM_BLURBEHIND {
        dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
        fEnable: true.into(),
        hRgnBlur: region,
        fTransitionOnMaximized: false.into(),
    };
    let _ = unsafe { DwmEnableBlurBehindWindow(hwnd, &blur) };
    let _ = unsafe { DeleteObject(region.into()) };
    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    let _ = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };
}

#[cfg(windows)]
fn raise_top(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
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
    apply_desktop_style(hwnd);
    let size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
        ICON_WIDTH as u32,
        ICON_HEIGHT as u32,
    ));
    let (x, y) =
        load_pos(app).unwrap_or_else(|| default_pos(size.width as i32, size.height as i32));
    let (x, y) = clamp_pos(x, y, size.width as i32, size.height as i32);
    let _ = move_to_screen(hwnd, x, y);
    accept_mouse(hwnd);
    raise_top(hwnd);
    enable_per_pixel_alpha(hwnd);
    save_pos(app, x, y);
    let _ = window.show();
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
fn icon_hit(
    hwnd: windows::Win32::Foundation::HWND,
    x: i32,
    y: i32,
) -> Option<((i32, i32, i32, i32), bool)> {
    let (left, top) = screen_origin(hwnd)?;
    let size = icon_size(hwnd)?;
    let rect = (left, top, left + size.0, top + size.1);
    let inside = point_in_rect(x, y, rect.0, rect.1, rect.2, rect.3);
    Some((rect, inside))
}

#[cfg(windows)]
fn icon_size(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width > 0 && height > 0 {
            Some((width, height))
        } else {
            None
        }
    }
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
        SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };

    let (x, y) = parent_point(hwnd, x, y);
    unsafe {
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

#[cfg(windows)]
fn nudge(hwnd: windows::Win32::Foundation::HWND, dx: i32, dy: i32) -> windows::core::Result<()> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let (x, y) = clamp_pos(rect.left + dx, rect.top + dy, width, height);
        move_to_screen(hwnd, x, y)
    }
}

#[cfg(windows)]
const MENU_SHOW: u32 = windows::Win32::UI::WindowsAndMessaging::WM_APP + 1;

#[cfg(windows)]
fn post_icon_menu() -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

    if MENU_QUEUED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let raw = *MENU_OWNER.lock().unwrap_or_else(|err| err.into_inner());
    if raw == 0 {
        MENU_QUEUED.store(false, Ordering::SeqCst);
        return Err("菜单窗口还没有准备好".to_string());
    }
    let posted = unsafe { PostMessageW(Some(hwnd_from(raw)), MENU_SHOW, WPARAM(0), LPARAM(0)) };
    if posted.is_err() {
        MENU_QUEUED.store(false, Ordering::SeqCst);
        return Err("没能打开桌面图标菜单".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn hwnd_from(raw: isize) -> windows::Win32::Foundation::HWND {
    windows::Win32::Foundation::HWND(raw as *mut core::ffi::c_void)
}

#[cfg(windows)]
fn ensure_menu_owner() -> Result<(), String> {
    {
        let current = *MENU_OWNER.lock().unwrap_or_else(|err| err.into_inner());
        if current != 0 {
            return Ok(());
        }
    }
    let hwnd = create_menu_owner()?;
    *MENU_OWNER.lock().unwrap_or_else(|err| err.into_inner()) = hwnd.0 as isize;
    Ok(())
}

#[cfg(windows)]
fn create_menu_owner() -> Result<windows::Win32::Foundation::HWND, String> {
    use windows::core::w;
    use windows::Win32::Foundation::HINSTANCE;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, RegisterClassW, WNDCLASSW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_POPUP,
    };

    let class_name = w!("WhooshRocketIconMenu");
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|err| err.to_string())?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(menu_owner_proc),
        hInstance: HINSTANCE(instance.0),
        lpszClassName: class_name,
        ..Default::default()
    };
    unsafe { RegisterClassW(&class) };
    unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED,
            class_name,
            w!(""),
            WS_POPUP,
            0,
            0,
            1,
            1,
            None,
            None,
            Some(HINSTANCE(instance.0)),
            None,
        )
    }
    .map_err(|err| err.to_string())
}

#[cfg(windows)]
unsafe extern "system" fn menu_owner_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::DefWindowProcW;

    if msg == MENU_SHOW {
        show_icon_menu(hwnd);
        return windows::Win32::Foundation::LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

#[cfg(windows)]
fn show_icon_menu(owner: windows::Win32::Foundation::HWND) {
    use std::sync::atomic::Ordering;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, LPARAM, POINT, WPARAM};
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, DestroyMenu, GetCursorPos, GetForegroundWindow,
        GetWindowThreadProcessId, PostMessageW, SetForegroundWindow, SetLayeredWindowAttributes,
        SetWindowPos, ShowWindow, TrackPopupMenu, HWND_TOPMOST, LWA_ALPHA, MF_STRING,
        SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, TPM_LEFTALIGN, TPM_RETURNCMD, TPM_RIGHTBUTTON,
        WM_NULL,
    };

    if MENU_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = ICON_APP
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone();
    let menu = unsafe { CreatePopupMenu() };
    let Ok(menu) = menu else {
        MENU_OPEN.store(false, Ordering::SeqCst);
        MENU_QUEUED.store(false, Ordering::SeqCst);
        return;
    };
    let built = unsafe {
        AppendMenuW(menu, MF_STRING, 1, w!("打开"))
            .and_then(|_| AppendMenuW(menu, MF_STRING, 2, w!("退出")))
    };
    if built.is_err() {
        let _ = unsafe { DestroyMenu(menu) };
        MENU_OPEN.store(false, Ordering::SeqCst);
        MENU_QUEUED.store(false, Ordering::SeqCst);
        return;
    }

    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        let _ = GetCursorPos(&mut point);
        let _ = SetLayeredWindowAttributes(owner, COLORREF(0), 1, LWA_ALPHA);
        let _ = SetWindowPos(
            owner,
            Some(HWND_TOPMOST),
            point.x,
            point.y,
            1,
            1,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
        let foreground = GetForegroundWindow();
        let foreground_thread = GetWindowThreadProcessId(foreground, None);
        let current = GetCurrentThreadId();
        let attached = foreground_thread != 0
            && foreground_thread != current
            && AttachThreadInput(foreground_thread, current, true).as_bool();
        let _ = SetForegroundWindow(owner);
        let selected = TrackPopupMenu(
            menu,
            TPM_LEFTALIGN | TPM_RIGHTBUTTON | TPM_RETURNCMD,
            point.x,
            point.y,
            None,
            owner,
            None,
        )
        .0;
        if attached {
            let _ = AttachThreadInput(foreground_thread, current, false);
        }
        let _ = PostMessageW(Some(owner), WM_NULL, WPARAM(0), LPARAM(0));
        let _ = ShowWindow(owner, SW_HIDE);
        let _ = DestroyMenu(menu);
        MENU_OPEN.store(false, Ordering::SeqCst);
        MENU_QUEUED.store(false, Ordering::SeqCst);
        if let Some(app) = app {
            match icon_menu_action(selected) {
                Some(IconMenuAction::Open) => show_main(&app),
                Some(IconMenuAction::Quit) => app.exit(0),
                None => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_click, drag_target, icon_menu_action, physical_delta, point_in_rect, ClickAction,
        IconMenuAction,
    };

    #[test]
    fn double_click_opens_when_the_pointer_did_not_drag() {
        assert_eq!(classify_click(false, None, 1_000, 500), ClickAction::Arm);
        assert_eq!(
            classify_click(false, Some(1_000), 1_400, 500),
            ClickAction::Open
        );
        assert_eq!(
            classify_click(false, Some(1_000), 1_601, 500),
            ClickAction::Arm
        );
        assert_eq!(
            classify_click(true, Some(1_000), 1_100, 500),
            ClickAction::DragEnd
        );
    }

    #[test]
    fn drag_follows_the_pointer_from_the_press_origin() {
        assert_eq!(drag_target(100, 200, 110, 210, 150, 190), (140, 180));
        assert_eq!(drag_target(100, 200, 110, 210, 110, 210), (100, 200));
    }

    #[test]
    fn dip_delta_converts_with_the_window_scale() {
        assert_eq!(physical_delta(2.0, -1.2, 1.5), (3, -2));
        assert_eq!(physical_delta(1.0, 1.0, 0.0), (1, 1));
    }

    #[test]
    fn menu_commands_map_to_open_and_quit() {
        assert_eq!(icon_menu_action(1), Some(IconMenuAction::Open));
        assert_eq!(icon_menu_action(2), Some(IconMenuAction::Quit));
        assert_eq!(icon_menu_action(0), None);
    }

    #[test]
    fn hit_test_uses_an_exclusive_bottom_right() {
        assert!(point_in_rect(0, 0, 0, 0, 10, 10));
        assert!(!point_in_rect(10, 5, 0, 0, 10, 10));
        assert!(!point_in_rect(5, 10, 0, 0, 10, 10));
    }
}
