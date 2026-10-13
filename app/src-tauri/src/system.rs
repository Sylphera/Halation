//! Taskbar progress, notifications, fonts, folders and app information.

use crate::paths::*;
use serde_json::{json, Map, Value};
use std::{collections::BTreeSet, path::Path};
use tauri::{
    window::{ProgressBarState, ProgressBarStatus},
    AppHandle, Manager, WebviewWindow,
};

#[cfg(all(windows, not(feature = "preview")))]
pub(crate) const APP_ID: &str = "com.halation.app";
#[cfg(all(windows, feature = "preview"))]
pub(crate) const APP_ID: &str = "com.halation.preview";
#[cfg(windows)]
const APP_NAME: &str = if cfg!(feature = "preview") { "Halation Preview" } else { "Halation" };
/* ---------- taskbar and notifications ---------- */

pub(crate) fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "no window".to_string())
}

#[tauri::command]
pub(crate) fn set_progress(app: AppHandle, value: Option<f64>) -> Result<(), String> {
    let state = match value {
        Some(v) => ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some((v.clamp(0.0, 1.0) * 100.0).round() as u64),
        },
        None => ProgressBarState { status: Some(ProgressBarStatus::None), progress: None },
    };
    main_window(&app)?.set_progress_bar(state).map_err(|e| e.to_string())
}

/// Registers the app id so Windows shows its toasts even without a Start menu shortcut
/// (portable exe). The same id is set on the process and on the installer shortcuts.
#[cfg(windows)]
pub(crate) fn register_app_id(app: &AppHandle) {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let wide: Vec<u16> = APP_ID.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
    }
    let icon = app.path().app_local_data_dir().ok().and_then(|d| {
        std::fs::create_dir_all(&d).ok()?;
        let p = d.join("notification.png");
        std::fs::write(&p, include_bytes!("../icons/128x128.png")).ok()?;
        Some(p)
    });
    let key = format!(r"Software\Classes\AppUserModelId\{APP_ID}");
    if let Ok((k, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(key) {
        let _ = k.set_value("DisplayName", &APP_NAME);
        let _ = k.set_value("ShowInSettings", &1u32);
        if let Some(p) = icon {
            let _ = k.set_value("IconUri", &p.to_string_lossy().into_owned());
        }
    }
}

#[tauri::command]
pub(crate) async fn notify(title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{Duration, Sound, Toast};
        Toast::new(APP_ID)
            .title(&title)
            .text1(&body)
            .sound(Some(Sound::Default))
            .duration(Duration::Short)
            .show()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        println!("notification: {title} — {body}");
        Ok(())
    }
}

/* ---------- system ---------- */

#[tauri::command]
pub(crate) async fn list_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names = BTreeSet::new();
    for face in db.faces() {
        if let Some((name, _)) = face.families.first() {
            if !name.starts_with('.') && !name.starts_with('@') {
                names.insert(name.clone());
            }
        }
    }
    names.into_iter().collect()
}

#[tauri::command]
pub(crate) fn open_folder(app: AppHandle, which: Option<String>) -> Result<(), String> {
    let d = folder(&app, which.as_deref().unwrap_or("base"))?;
    spawn_explorer(&[d.as_os_str()])
}

#[tauri::command]
pub(crate) fn paths(app: AppHandle) -> Result<Value, String> {
    let mut m = Map::new();
    for k in ["base", "presets", "exports", "downloads", "resources", "tools", "settings"] {
        m.insert(k.into(), Value::String(folder(&app, k)?.to_string_lossy().into_owned()));
    }
    Ok(Value::Object(m))
}

#[tauri::command]
pub(crate) fn app_info(app: AppHandle) -> Value {
    let info = app.package_info();
    let recovered = app.try_state::<crate::state::Recovered>().is_some_and(|r| r.0);
    json!({ "name": info.name, "version": info.version.to_string(), "recovered": recovered, "portable": !crate::update::installed() })
}

/// Halation's licence (NOTICE.md, then the GPL) and the third-party notices, compiled into the executable so the portable copy carries them too
/// (the installer also copies both files beside it).
#[tauri::command]
pub(crate) fn legal_text(which: String) -> Result<&'static str, String> {
    match which.as_str() {
        "license" => Ok(concat!(include_str!("../../../NOTICE.md"), "\n\n", include_str!("../../../LICENSE"))),
        "notices" => Ok(include_str!("../../../THIRD_PARTY.md")),
        _ => Err(format!("unknown text: {which}")),
    }
}

/* ---------- disk space ---------- */

/// Free bytes on the drive that holds `path` (a folder inside Halation's, or the Halation folder).
#[tauri::command]
pub(crate) fn disk_free(app: AppHandle, path: Option<String>) -> Result<u64, String> {
    let p = match path {
        Some(p) => inside_base(&app, &p)?,
        None => base_dir(&app)?,
    };
    free_space(&p)
}

#[cfg(windows)]
pub(crate) fn free_space(p: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free: u64 = 0;
    // SAFETY: wide is a NUL-terminated path; the out pointer is a live u64, the other outputs may be null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(free)
    }
}

#[cfg(unix)]
#[allow(clippy::unnecessary_cast)] // the field types differ between systems
pub(crate) fn free_space(p: &Path) -> Result<u64, String> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // SAFETY: c is a NUL-terminated path and st a zeroed statvfs the call fills in.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(st.f_bavail as u64 * st.f_frsize as u64)
}

/* ---------- the machine, for the jobs' scheduler ---------- */

const MB: u64 = 1024 * 1024;

/// Cores, RAM (total and free), the GPU with the most video memory (its name, dedicated VRAM and what is free of its
/// budget) and the free space of the workspace's drive, in MB. jobs.js reads it every 2 s while jobs run.
#[tauri::command]
pub(crate) fn sys_resources(app: AppHandle) -> Value {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let (total, free) = memory().unwrap_or((0, 0));
    let disk = crate::workspace::root(&app).ok().and_then(|r| free_space(&r).ok()).unwrap_or(0);
    json!({ "cores": cores, "ramTotalMB": total / MB, "ramFreeMB": free / MB, "gpu": gpu(), "diskFreeMB": disk / MB })
}

#[cfg(windows)]
fn memory() -> Option<(u64, u64)> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: the struct is zeroed and sized as the call asks.
    unsafe {
        let mut m: MEMORYSTATUSEX = std::mem::zeroed();
        m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut m) != 0).then_some((m.ullTotalPhys, m.ullAvailPhys))
    }
}
#[cfg(not(windows))]
fn memory() -> Option<(u64, u64)> {
    let s = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kb = |k: &str| s.lines().find(|l| l.starts_with(k)).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<u64>().ok()).map(|v| v * 1024);
    Some((kb("MemTotal:")?, kb("MemAvailable:")?))
}

/// DXGI: the hardware adapter with the most dedicated memory; what is free is its local budget minus its use
#[cfg(windows)]
fn gpu() -> Value {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIAdapter3, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO};
    // SAFETY: COM calls on interfaces the factory returns; nothing outlives this function.
    let found = unsafe {
        let Ok(f) = CreateDXGIFactory1::<IDXGIFactory1>() else { return Value::Null };
        let mut best: Option<(u64, String, IDXGIAdapter1)> = None;
        let mut i = 0;
        while let Ok(a) = f.EnumAdapters1(i) {
            i += 1;
            let Ok(d) = a.GetDesc1() else { continue };
            if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let v = d.DedicatedVideoMemory as u64;
            if best.as_ref().is_none_or(|b| v > b.0) {
                let name = String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string();
                best = Some((v, name, a));
            }
        }
        best.map(|(v, name, a)| {
            let free = a.cast::<IDXGIAdapter3>().ok().and_then(|a3| {
                let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
                a3.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info).ok()?;
                Some(info.Budget.saturating_sub(info.CurrentUsage))
            });
            (v, name, free)
        })
    };
    match found {
        Some((v, name, free)) => json!({ "name": name, "vramMB": v / MB, "vramFreeMB": free.map(|f| f / MB) }),
        None => Value::Null,
    }
}
/// Elsewhere (the tests, a Linux build) the GPU is taken as present with its memory unknown
#[cfg(not(windows))]
fn gpu() -> Value {
    json!({ "name": "", "vramMB": 0, "vramFreeMB": null })
}
