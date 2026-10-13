//! Window size and position, the window icon, the dark title bar, closing and the webview's memory.

use crate::{paths::*, state::*, system::main_window};
use serde_json::json;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, CloseRequestApi, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
};

/* ---------- window size and position ---------- */

pub(crate) fn restore_window(app: &AppHandle, win: &WebviewWindow) {
    let saved = {
        let lock = app.state::<StateLock>();
        let _g = hold(&lock.0);
        read_state(app).ok().and_then(|mut m| m.remove("window"))
    };
    if let Some(w) = saved {
        let num = |k: &str| w.get(k).and_then(|v| v.as_f64());
        if let (Some(width), Some(height)) = (num("width"), num("height")) {
            if width >= 600.0 && height >= 400.0 {
                let _ = win.set_size(PhysicalSize::new(width as u32, height as u32));
            }
        }
        if let (Some(x), Some(y)) = (num("x"), num("y")) {
            let (x, y) = (x as i32, y as i32);
            let visible = win.available_monitors().unwrap_or_default().iter().any(|m| {
                let (p, s) = (m.position(), m.size());
                x + 80 >= p.x && y >= p.y - 10 && x + 80 < p.x + s.width as i32 && y + 40 < p.y + s.height as i32
            });
            if visible {
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
        if w.get("maximized").and_then(|v| v.as_bool()) == Some(true) {
            let _ = win.maximize();
        }
    }
    let _ = win.show();
}

pub(crate) fn save_window(win: &tauri::Window) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let app = win.app_handle();
    let lock = app.state::<StateLock>();
    let _g = hold(&lock.0);
    let Ok(mut m) = read_state(app) else { return };
    let maximized = win.is_maximized().unwrap_or(false);
    let mut w = m.get("window").cloned().unwrap_or_else(|| json!({}));
    w["maximized"] = json!(maximized);
    if !maximized {
        if let (Ok(p), Ok(s)) = (win.outer_position(), win.inner_size()) {
            w["x"] = json!(p.x);
            w["y"] = json!(p.y);
            w["width"] = json!(s.width);
            w["height"] = json!(s.height);
        }
    }
    m.insert("window".into(), w);
    let _ = write_state(app, &m);
}

/// The window (title bar, taskbar, Alt+Tab) shows the bare light mark; the tile is the app icon (exe, installer,
/// desktop shortcut).
pub(crate) fn mark_icon(win: &WebviewWindow) {
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/halation-mark.png")) {
        let _ = win.set_icon(icon);
    }
}

/// Keeps the native Windows title bar (snap layouts, resize, accessibility) but paints it with the app
/// colours: dark mode on Windows 10, and on Windows 11 the caption, text and border colours of the theme.
/// Older builds ignore the attributes they don't know.
#[cfg(windows)]
pub(crate) fn dark_title_bar(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };
    let Ok(hwnd) = win.hwnd() else { return };
    let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;
    // COLORREF is 0x00BBGGRR
    let values: [(i32, u32); 4] = [
        (DWMWA_USE_IMMERSIVE_DARK_MODE, 1),
        (DWMWA_CAPTION_COLOR, 0x000F_0E0F), // #0f0e0f, the window background
        (DWMWA_TEXT_COLOR, 0x00EB_EAF0),    // #f0eaeb
        (DWMWA_BORDER_COLOR, 0x0017_1618),  // #181617
    ];
    for (attr, value) in values {
        // SAFETY: hwnd is this process's live window; the value is a 4-byte integer as the API expects.
        unsafe {
            DwmSetWindowAttribute(hwnd, attr as u32, &value as *const u32 as *const core::ffi::c_void, 4);
        }
    }
}

/* ---------- closing ---------- */

/// When the page was asked whether the app may close, until it answers (`close_ack`).
#[derive(Default)]
pub(crate) struct Closing(pub(crate) Mutex<Option<Instant>>);

/// The window's close button, Alt+F4, the taskbar: the page decides (it asks when a tool is still working, shell.js),
/// then calls `app_quit`. A page that has not answered after 3 s (hung) no longer holds the window.
pub(crate) fn close_requested(win: &tauri::Window, api: &CloseRequestApi) {
    save_window(win);
    let app = win.app_handle();
    let closing = app.state::<Closing>();
    let mut asked = hold(&closing.0);
    if matches!(*asked, Some(t) if t.elapsed() > Duration::from_secs(3)) {
        drop(asked);
        quit(app, false);
        return;
    }
    api.prevent_close();
    asked.get_or_insert_with(Instant::now);
    let _ = app.emit("close-requested", ());
}

/// The page heard the close request (it is asking, or closing).
#[tauri::command]
pub(crate) fn close_ack(closing: State<'_, Closing>) {
    *hold(&closing.0) = None;
}

/// Closes the app: what is still running stops, and the session ends clean (the next start opens empty).
#[tauri::command]
pub(crate) fn app_quit(app: AppHandle) {
    quit(&app, true);
}

pub(crate) fn quit(app: &AppHandle, clean: bool) {
    crate::procs::kill_all(&app.state::<crate::procs::Procs>());
    crate::encode::abort_all(&app.state::<crate::encode::Encoders>());
    if clean { end_session(app); }
    crate::update::on_quit(app);
    app.exit(0);
}

/* ---------- memory ---------- */

/// While the window is minimized and nothing is working, WebView2 gives back what it can (caches, the renderer's
/// spare memory); normal again as it comes back. Other platforms: nothing to do.
#[tauri::command]
pub(crate) fn memory_low(app: AppHandle, low: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        main_window(&app)?
            .with_webview(move |w| {
                use webview2_com::Microsoft::Web::WebView2::Win32::{
                    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                };
                use windows_core::Interface;
                let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                // SAFETY: the controller and its webview are live on this (the webview's) thread; an older runtime
                // without ICoreWebView2_19 fails the cast and nothing changes.
                unsafe {
                    if let Ok(core) = w.controller().CoreWebView2() {
                        if let Ok(v) = core.cast::<ICoreWebView2_19>() {
                            let _ = v.SetMemoryUsageTargetLevel(level);
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, low);
        let _ = main_window;
        Ok(())
    }
}
