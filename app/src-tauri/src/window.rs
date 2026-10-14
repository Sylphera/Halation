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
// docs/WINDOW_SPEC.md. app.json `window`: x, y (outer position, physical: it says which monitor), width, height (inner
// size, logical), units = 2, monitor, maximized, fullscreen. Older files kept the size in physical pixels (no units).

/// The smallest window (also `minWidth` / `minHeight` in tauri.conf.json), logical.
const MIN: (f64, f64) = (960.0, 640.0);
/// First run: this share of the work area, centred, within MIN and FIRST_RUN_MAX (logical).
const FIRST_RUN_FRACTION: f64 = 0.85;
const FIRST_RUN_MAX: (f64, f64) = (1600.0, 1000.0);
/// The default size of the versions before 1.2: a saved window of exactly this size was never chosen.
const OLD_DEFAULT: (f64, f64) = (1480.0, 940.0);

/// A monitor's work area (physical) and scale.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Screen {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
    pub name: String,
}

/// What app.json kept of the window; sizes logical (older physical sizes already converted).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Saved {
    pub pos: Option<(i32, i32)>,
    pub size: Option<(f64, f64)>,
    pub maximized: bool,
    pub fullscreen: bool,
}

/// How the window opens: its normal (restored) rectangle in physical pixels, then maximized or full screen on top.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Plan {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub maximize: bool,
    pub fullscreen: bool,
}

/// The screen a saved position falls on (its title bar visible).
fn holding(screens: &[Screen], pos: Option<(i32, i32)>) -> Option<&Screen> {
    let (x, y) = pos?;
    screens.iter().find(|m| x + 80 >= m.x && y >= m.y - 10 && x + 80 < m.x + m.w as i32 && y + 40 < m.y + m.h as i32)
}

/// That screen, else the primary one.
fn screen_at(screens: &[Screen], primary: usize, pos: Option<(i32, i32)>) -> Option<&Screen> {
    holding(screens, pos).or_else(|| screens.get(primary)).or_else(|| screens.first())
}

/// The first run's restored size in a work area of `area` logical pixels.
pub(crate) fn first_run_size(area: (f64, f64)) -> (f64, f64) {
    let fit = |a: f64, min: f64, max: f64| (a * FIRST_RUN_FRACTION).round().clamp(min, max).min(a.max(min));
    (fit(area.0, MIN.0, FIRST_RUN_MAX.0), fit(area.1, MIN.1, FIRST_RUN_MAX.1))
}

/// Decides how the window opens. `mode`: the setting openMode (last | maximized | fullscreen).
pub(crate) fn plan(screens: &[Screen], primary: usize, saved: Option<&Saved>, mode: &str, remember_fs: bool) -> Option<Plan> {
    let near = |a: f64, b: f64| (a - b).abs() <= 2.0;
    // A window still at the old default size (never resized by hand) opens as on a first run, once.
    let fresh = match saved {
        None => true,
        Some(s) => match s.size {
            None => true,
            Some((w, h)) => !s.maximized && !s.fullscreen && near(w, OLD_DEFAULT.0) && near(h, OLD_DEFAULT.1),
        },
    };
    let screen = screen_at(screens, primary, saved.and_then(|s| s.pos))?;
    let k = if screen.scale > 0.0 { screen.scale } else { 1.0 };
    let area = (screen.w as f64 / k, screen.h as f64 / k);
    let logical = if fresh { first_run_size(area) } else { saved.and_then(|s| s.size).unwrap_or_else(|| first_run_size(area)) };
    // Never larger than the work area; MIN wins over a smaller screen (Windows enforces it anyway)
    let w = (logical.0.min(area.0).max(MIN.0) * k).round() as u32;
    let h = (logical.1.min(area.1).max(MIN.1) * k).round() as u32;
    let centre = (screen.x + (screen.w as i32 - w as i32) / 2, screen.y + (screen.h as i32 - h as i32) / 2);
    let kept = if fresh { None } else { saved.and_then(|s| s.pos).filter(|p| holding(screens, Some(*p)).is_some()) };
    let (x, y) = match kept {
        // Kept, pulled back inside the work area where it overflows
        Some((x, y)) => (
            x.min(screen.x + screen.w as i32 - w as i32).max(screen.x),
            y.min(screen.y + screen.h as i32 - h as i32).max(screen.y),
        ),
        None => centre,
    };
    let was = |f: fn(&Saved) -> bool| !fresh && saved.map(f).unwrap_or(false);
    let (maximize, fullscreen) = match mode {
        "fullscreen" => (false, true),
        "maximized" => (true, false),
        _ if fresh => (true, false),
        _ if remember_fs && was(|s| s.fullscreen) => (false, true),
        _ => (was(|s| s.maximized) || was(|s| s.fullscreen), false),
    };
    Some(Plan { x, y, w, h, maximize, fullscreen })
}

/// Reads app.json's `window`, converting an older physical size with the scale of the monitor it was on.
fn read_saved(w: &serde_json::Value, screens: &[Screen], primary: usize) -> Saved {
    let num = |k: &str| w.get(k).and_then(|v| v.as_f64());
    let pos = match (num("x"), num("y")) {
        (Some(x), Some(y)) => Some((x as i32, y as i32)),
        _ => None,
    };
    let mut size = match (num("width"), num("height")) {
        (Some(a), Some(b)) if a >= 200.0 && b >= 150.0 => Some((a, b)),
        _ => None,
    };
    if num("units") != Some(2.0) {
        let k = screen_at(screens, primary, pos).map(|m| m.scale).filter(|k| *k > 0.0).unwrap_or(1.0);
        size = size.map(|(a, b)| (a / k, b / k));
    }
    let flag = |k: &str| w.get(k).and_then(|v| v.as_bool()) == Some(true);
    Saved { pos, size, maximized: flag("maximized"), fullscreen: flag("fullscreen") }
}

fn screens(win: &WebviewWindow) -> (Vec<Screen>, usize) {
    let list: Vec<Screen> = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Screen {
                x: a.position.x,
                y: a.position.y,
                w: a.size.width,
                h: a.size.height,
                scale: m.scale_factor(),
                name: m.name().cloned().unwrap_or_default(),
            }
        })
        .collect();
    let primary = win
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|p| list.iter().position(|s| s.x <= p.position().x && p.position().x < s.x + s.w as i32 && s.y <= p.position().y && p.position().y < s.y + s.h as i32))
        .unwrap_or(0);
    (list, primary)
}

pub(crate) fn restore_window(app: &AppHandle, win: &WebviewWindow) {
    let (saved, settings) = {
        let lock = app.state::<StateLock>();
        let _g = hold(&lock.0);
        let m = read_state(app).unwrap_or_default();
        (m.get("window").cloned(), m.get("settings").cloned().unwrap_or_default())
    };
    let mode = settings.get("openMode").and_then(|v| v.as_str()).unwrap_or("last").to_string();
    let remember_fs = settings.get("rememberFullscreen").and_then(|v| v.as_bool()) == Some(true);
    let (list, primary) = screens(win);
    let saved = saved.map(|w| read_saved(&w, &list, primary));
    if let Some(p) = plan(&list, primary, saved.as_ref(), &mode, remember_fs) {
        // Position first: on a monitor with another scale the size is then taken in that monitor's pixels
        let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
        let _ = win.set_size(PhysicalSize::new(p.w, p.h));
        if p.fullscreen {
            let _ = win.set_fullscreen(true);
        } else if p.maximize {
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
    let fullscreen = win.is_fullscreen().unwrap_or(false);
    let maximized = !fullscreen && win.is_maximized().unwrap_or(false);
    let mut w = m.get("window").cloned().unwrap_or_else(|| json!({}));
    w["fullscreen"] = json!(fullscreen);
    // Leaving full screen restores what was under it; keep that state
    if !fullscreen {
        w["maximized"] = json!(maximized);
    }
    if !maximized && !fullscreen {
        if let (Ok(p), Ok(s), Ok(k)) = (win.outer_position(), win.inner_size(), win.scale_factor()) {
            let k = if k > 0.0 { k } else { 1.0 };
            w["x"] = json!(p.x);
            w["y"] = json!(p.y);
            w["width"] = json!((s.width as f64 / k).round());
            w["height"] = json!((s.height as f64 / k).round());
            w["units"] = json!(2);
            if let Ok(Some(mon)) = win.current_monitor() {
                w["monitor"] = json!(mon.name().cloned().unwrap_or_default());
            }
        }
    }
    m.insert("window".into(), w);
    let _ = write_state(app, &m);
}

/// F11: full screen on or off (`on` absent: the other). Returns the new state.
#[tauri::command]
pub(crate) fn window_fullscreen(app: AppHandle, on: Option<bool>) -> Result<bool, String> {
    let win = main_window(&app)?;
    let now = win.is_fullscreen().map_err(|e| e.to_string())?;
    let next = on.unwrap_or(!now);
    if next != now {
        win.set_fullscreen(next).map_err(|e| e.to_string())?;
    }
    Ok(next)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scr(x: i32, y: i32, w: u32, h: u32, scale: f64) -> Screen {
        Screen { x, y, w, h, scale, name: String::new() }
    }
    fn saved(pos: (i32, i32), size: (f64, f64)) -> Saved {
        Saved { pos: Some(pos), size: Some(size), ..Default::default() }
    }

    #[test]
    fn first_run_sizes() {
        // 1080p at 150 % (1280 × 680 logical work area), 1366 × 728, 1080p at 100 %, 1440p at 100 %
        assert_eq!(first_run_size((1280.0, 680.0)), (1088.0, 640.0));
        assert_eq!(first_run_size((1366.0, 728.0)), (1161.0, 640.0));
        assert_eq!(first_run_size((1920.0, 1040.0)), (1600.0, 884.0));
        assert_eq!(first_run_size((2560.0, 1400.0)), (1600.0, 1000.0));
        // A work area under the minimum: the minimum
        assert_eq!(first_run_size((800.0, 560.0)), (960.0, 640.0));
    }

    #[test]
    fn first_run_opens_maximized_and_centred() {
        let s = [scr(0, 0, 1920, 1032, 1.5)];
        let p = plan(&s, 0, None, "last", false).unwrap();
        assert!(p.maximize && !p.fullscreen);
        assert!(p.w <= 1920 && p.h <= 1032);
        assert_eq!((p.x, p.y), ((1920 - p.w as i32) / 2, (1032 - p.h as i32) / 2));
    }

    #[test]
    fn saved_size_is_clamped_to_the_work_area() {
        // Saved on a large monitor, now a 1366 × 728 one
        let s = [scr(0, 0, 1366, 728, 1.0)];
        let p = plan(&s, 0, Some(&saved((100, 50), (2000.0, 1300.0))), "last", false).unwrap();
        assert_eq!((p.w, p.h), (1366, 728));
        assert_eq!((p.x, p.y), (0, 0));
        assert!(!p.maximize);
    }

    #[test]
    fn saved_window_kept_where_it_was() {
        let s = [scr(0, 0, 2560, 1400, 1.0), scr(2560, 0, 1920, 1040, 1.25)];
        let p = plan(&s, 0, Some(&saved((2700, 100), (1200.0, 800.0))), "last", false).unwrap();
        assert_eq!((p.x, p.y, p.w, p.h), (2700, 40, 1500, 1000));
    }

    #[test]
    fn position_off_every_monitor_is_centred_on_the_primary() {
        let s = [scr(0, 0, 1920, 1040, 1.0)];
        let p = plan(&s, 0, Some(&saved((5000, 3000), (1200.0, 800.0))), "last", false).unwrap();
        assert_eq!((p.x, p.y, p.w, p.h), (360, 120, 1200, 800));
    }

    #[test]
    fn old_default_size_opens_as_a_first_run_once() {
        let s = [scr(0, 0, 1920, 1040, 1.0)];
        let p = plan(&s, 0, Some(&saved((200, 50), (1480.0, 940.0))), "last", false).unwrap();
        assert!(p.maximize);
        assert_eq!((p.w, p.h), (1600, 884));
        // Chosen by hand: kept
        let p = plan(&s, 0, Some(&saved((200, 50), (1500.0, 940.0))), "last", false).unwrap();
        assert!(!p.maximize);
        assert_eq!((p.w, p.h), (1500, 940));
    }

    #[test]
    fn open_modes() {
        let s = [scr(0, 0, 1920, 1040, 1.0)];
        let mut w = saved((100, 100), (1200.0, 800.0));
        assert!(plan(&s, 0, Some(&w), "maximized", false).unwrap().maximize);
        let f = plan(&s, 0, Some(&w), "fullscreen", false).unwrap();
        assert!(f.fullscreen && !f.maximize);
        w.fullscreen = true;
        assert!(!plan(&s, 0, Some(&w), "last", false).unwrap().fullscreen);
        assert!(plan(&s, 0, Some(&w), "last", true).unwrap().fullscreen);
        w.fullscreen = false;
        w.maximized = true;
        assert!(plan(&s, 0, Some(&w), "last", false).unwrap().maximize);
    }

    #[test]
    fn older_physical_sizes_are_converted() {
        let s = [scr(0, 0, 1920, 1040, 1.5)];
        let old = json!({ "x": 10, "y": 10, "width": 1800.0, "height": 1200.0, "maximized": false });
        let r = read_saved(&old, &s, 0);
        assert_eq!(r.size, Some((1200.0, 800.0)));
        let new = json!({ "x": 10, "y": 10, "width": 1200.0, "height": 800.0, "units": 2, "fullscreen": true });
        let r = read_saved(&new, &s, 0);
        assert_eq!(r.size, Some((1200.0, 800.0)));
        assert!(r.fullscreen);
    }
}
