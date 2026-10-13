//! Folders of Documents\Halation and small helpers shared by every command module.

use percent_encoding::percent_decode_str;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(not(feature = "preview"))]
use tauri::Manager;
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle,
};

pub(crate) const BASE: &str = "Halation";
pub(crate) const LAYOUT: [&[&str]; 12] = [
    &["Presets", "Visualizer"],
    &["Presets", "Grade"],
    &["Exports", "Videos"],
    &["Exports", "Covers"],
    &["Exports", "Upscaled"],
    &["Downloads", "Video"],
    &["Downloads", "Audio"],
    &["Downloads", "Covers"],
    &["Tools"],
    &["Resources", "Fonts"],
    &["Resources", "Logos"],
    &["Settings"],
];
pub(crate) const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
    "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub(crate) fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/* ---------- folders ---------- */

pub(crate) fn docs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "preview")]
    return Ok(preview::profile_dir(app)?.join("Documents"));
    #[cfg(not(feature = "preview"))]
    app.path().document_dir().map_err(|e| e.to_string())
}

/// Where %LOCALAPPDATA% is for Halation's own folders (the workspace); a Preview profile has its own.
pub(crate) fn local_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "preview")]
    return Ok(preview::profile_dir(app)?.join("Local"));
    #[cfg(not(feature = "preview"))]
    app.path().local_data_dir().map_err(|e| e.to_string())
}

pub(crate) fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = docs_dir(app)?.join(BASE);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn dir(app: &AppHandle, parts: &[&str]) -> Result<PathBuf, String> {
    #[cfg(feature = "preview")]
    let mut d = if parts.first() == Some(&"Tools") { preview::root(app)? } else { base_dir(app)? };
    #[cfg(not(feature = "preview"))]
    let mut d = base_dir(app)?;
    d.extend(parts);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

pub(crate) fn preset_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    match kind {
        "visualizer" => dir(app, &["Presets", "Visualizer"]),
        "grade" => dir(app, &["Presets", "Grade"]),
        _ => Err(format!("unknown preset kind: {kind}")),
    }
}

pub(crate) fn export_dir(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    match ext_of(filename).as_str() {
        "mp4" | "webm" | "mov" | "mkv" => dir(app, &["Exports", "Videos"]),
        "png" | "jpg" | "jpeg" | "webp" => dir(app, &["Exports", "Covers"]),
        _ => dir(app, &["Exports"]),
    }
}

pub(crate) fn folder(app: &AppHandle, which: &str) -> Result<PathBuf, String> {
    match which {
        "presets" => dir(app, &["Presets"]),
        "presets-visualizer" => dir(app, &["Presets", "Visualizer"]),
        "presets-grade" => dir(app, &["Presets", "Grade"]),
        "exports" => dir(app, &["Exports"]),
        "videos" => dir(app, &["Exports", "Videos"]),
        "covers" => dir(app, &["Exports", "Covers"]),
        "upscaled" => dir(app, &["Exports", "Upscaled"]),
        "frames" => dir(app, &["Exports", "Frames"]),
        "converted" => dir(app, &["Exports", "Converted"]),
        "library" => dir(app, &["Library"]),
        "downloads" => dir(app, &["Downloads"]),
        "downloads-video" => dir(app, &["Downloads", "Video"]),
        "downloads-audio" => dir(app, &["Downloads", "Audio"]),
        "downloads-covers" => dir(app, &["Downloads", "Covers"]),
        "tools" => dir(app, &["Tools"]),
        "resources" => dir(app, &["Resources"]),
        "settings" => dir(app, &["Settings"]),
        _ => base_dir(app),
    }
}

/* ---------- preview ---------- */

/// Halation Preview (feature "preview", docs/PREVIEW.md): a development build with its own identifier
/// (com.halation.preview). Everything it writes lives under %LOCALAPPDATA%\com.halation.preview, never in
/// Documents\Halation or %LOCALAPPDATA%\Halation: one folder per profile (Documents, Local, WebView2) and one Tools
/// folder shared by the profiles.
#[cfg(feature = "preview")]
pub(crate) mod preview {
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};

    /// HALATION_PREVIEW_PROFILE (letters, digits, - and _), "default" when unset or empty.
    pub(crate) fn profile() -> String {
        let p = super::safe_id(&std::env::var("HALATION_PREVIEW_PROFILE").unwrap_or_default());
        if p.is_empty() { "default".into() } else { p }
    }

    pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
        app.path().app_local_data_dir().map_err(|e| e.to_string())
    }

    pub(crate) fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(root(app)?.join("profiles").join(profile()))
    }

    /// The profile's WebView2 data (localStorage, caches), set before the window exists. A folder given by the
    /// launcher (WEBVIEW2_USER_DATA_FOLDER) wins.
    #[cfg(windows)]
    pub(crate) fn webview_folder() {
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
            return;
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let d = PathBuf::from(local).join(crate::system::APP_ID).join("profiles").join(profile()).join("WebView2");
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", d);
        }
    }
}

/* ---------- helpers ---------- */

pub(crate) fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub(crate) fn safe_id(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(56)
        .collect()
}

/// Any text → a valid Windows file name (same rule as fileStem in shim.js).
pub(crate) fn file_stem(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| if c.is_control() || r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .take(120)
        .collect();
    let mut s = mapped.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() {
        s = "preset".into();
    }
    if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        s.push('_');
    }
    s
}

pub(crate) fn check_stem(name: &str) -> Result<(), String> {
    if file_stem(name) == name {
        Ok(())
    } else {
        Err(format!("invalid file name: {name}"))
    }
}

/// Valid export file name, keeping the extension.
pub(crate) fn clean_filename(name: &str) -> String {
    let ext = ext_of(name);
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let stem = file_stem(if stem.is_empty() { "halation" } else { stem });
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{}", safe_id(&ext))
    }
}

/// "name.ext", or "name (2).ext", "name (3).ext"… if it already exists.
pub(crate) fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let first = dir.join(filename);
    if !first.exists() {
        return first;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

pub(crate) fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub(crate) fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn header(req: &Request<'_>, key: &str) -> String {
    req.headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode_str(s).decode_utf8_lossy().to_string())
        .unwrap_or_default()
}

pub(crate) fn raw_body<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(data) => Ok(data.as_slice()),
        _ => Err("no data received".into()),
    }
}

pub(crate) fn read_json(path: &Path) -> Option<Value> {
    let s = fs::read_to_string(path).ok()?;
    serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()
}

pub(crate) fn inside_base(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let base = base_dir(app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = Path::new(path).canonicalize().map_err(|_| "the file no longer exists".to_string())?;
    // the jobs' work folders and loose temporary files live in the workspace (workspace.rs); the Preview keeps its
    // components (Tools) outside the Halation folder (preview.rs)
    let tools = crate::tools::tools_dir(app).ok().and_then(|d| d.canonicalize().ok());
    if p.starts_with(&base) || crate::workspace::inside(app, &p) || tools.is_some_and(|t| p.starts_with(t)) || crate::save_location::allows(app, Path::new(path)) {
        Ok(p)
    } else {
        Err("path outside the Halation folder".into())
    }
}

pub(crate) fn spawn_explorer(args: &[&std::ffi::OsStr]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems() {
        assert_eq!(file_stem("Shorts 9:16"), "Shorts 9-16");
        assert_eq!(file_stem("con"), "con_");
        assert_eq!(file_stem("  a.. "), "a");
        assert_eq!(file_stem(""), "preset");
        for s in ["Shorts 9:16", "con", "  a.. ", "x/y\\z"] {
            assert_eq!(file_stem(&file_stem(s)), file_stem(s));
        }
    }

    #[test]
    fn filenames() {
        assert_eq!(clean_filename("Artist - Night: blue.mp4"), "Artist - Night- blue.mp4");
        assert_eq!(clean_filename(".png"), ".png");
    }

    #[test]
    fn unique() {
        let d = std::env::temp_dir().join(format!("halation-test-{}", now_ms()));
        fs::create_dir_all(&d).unwrap();
        assert_eq!(unique_path(&d, "a.mp4"), d.join("a.mp4"));
        fs::write(d.join("a.mp4"), b"x").unwrap();
        assert_eq!(unique_path(&d, "a.mp4"), d.join("a (2).mp4"));
        fs::write(d.join("a (2).mp4"), b"x").unwrap();
        assert_eq!(unique_path(&d, "a.mp4"), d.join("a (3).mp4"));
        fs::remove_dir_all(d).unwrap();
    }
}
