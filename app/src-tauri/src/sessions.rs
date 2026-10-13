//! Manual sessions and crash recovery. Tool state never belongs to user preferences.
use crate::paths::*;
use serde_json::{Map, Value};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex};
use tauri::{ipc::{Request, Response}, AppHandle, State};

#[derive(Default)]
pub(crate) struct Sessions {
    pub(crate) tools: Mutex<Map<String, Value>>,
    allowed: Mutex<HashSet<PathBuf>>,
}

pub(crate) fn temporary(key: &str) -> bool {
    matches!(key, "visualizer" | "visualizerExport" | "grade" | "upscale" | "upscaleVideo" | "interp" | "removebg" | "framegrab" | "covertest" | "convert")
}

pub(crate) fn persistent_part(key: &str, value: &Value) -> Value {
    let fields: &[&str] = match key {
        "visualizer" => &["fonts", "presets", "updatedAt"],
        "grade" => &["looks"],
        _ => &[],
    };
    Value::Object(fields.iter().filter_map(|k| value.get(*k).map(|v| ((*k).to_string(), v.clone()))).collect())
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dir(app, &["Sessions"])?.join(".recovery.json"))
}
fn valid(v: &Value) -> bool {
    v.get("app").and_then(Value::as_str) == Some("halation-session")
        && v.get("version").and_then(Value::as_u64) == Some(1)
        && v.get("tools").is_some_and(Value::is_object)
}
fn checked(v: &Value) -> Result<(), String> {
    if valid(v) { Ok(()) } else { Err("Unsupported or invalid Halation Session".into()) }
}
fn saved_marker(path: &std::path::Path) -> PathBuf {
    let mut marker = path.as_os_str().to_owned();
    marker.push(".saved");
    PathBuf::from(marker)
}
pub(crate) fn discard(app: &AppHandle) -> Result<(), String> {
    let p = recovery_path(app)?;
    if p.exists() { fs::remove_file(p).map_err(|e| e.to_string())?; }
    // Only unsaved browser-input copies belong to recovery. A saved session pins
    // its referenced copies; original/user resources are never removed here.
    let media = dir(app, &["Sessions", ".media"])?;
    for entry in fs::read_dir(&media).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) != Some("saved") && !saved_marker(&path).exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn pin_media(app: &AppHandle, value: &Value) -> Result<(), String> {
    let media = dir(app, &["Sessions", ".media"])?.canonicalize().map_err(|e| e.to_string())?;
    fn visit(root: &std::path::Path, v: &Value) -> Result<(), String> {
        match v {
            Value::Object(o) => { for x in o.values() { visit(root, x)?; } }
            Value::Array(a) => { for x in a { visit(root, x)?; } }
            Value::String(s) => {
                if let Ok(p) = PathBuf::from(s).canonicalize() {
                    if p.is_file() && p.parent() == Some(root) {
                        fs::write(saved_marker(&p), []).map_err(|e| e.to_string())?;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    visit(&media, value)
}

#[tauri::command]
pub(crate) fn session_state(runtime: State<'_, Sessions>) -> Value {
    Value::Object(hold(&runtime.tools).clone())
}
#[tauri::command]
pub(crate) fn session_replace(runtime: State<'_, Sessions>, tools: Map<String, Value>) {
    *hold(&runtime.tools) = tools;
}
#[tauri::command]
pub(crate) fn session_recovery(app: AppHandle, runtime: State<'_, Sessions>) -> Result<Option<Value>, String> {
    let v = read_json(&recovery_path(&app)?).filter(valid);
    if let Some(path) = v.as_ref().and_then(|v| v.get("file")).and_then(Value::as_str) {
        hold(&runtime.allowed).insert(PathBuf::from(path));
    }
    Ok(v)
}
#[tauri::command]
pub(crate) fn session_recovery_write(app: AppHandle, snapshot: Value) -> Result<(), String> {
    checked(&snapshot)?;
    write_atomic(&recovery_path(&app)?, serde_json::to_string(&snapshot).map_err(|e| e.to_string())?.as_bytes())
}
#[tauri::command]
pub(crate) fn session_discard(app: AppHandle) -> Result<(), String> { discard(&app) }

#[tauri::command]
pub(crate) fn session_pick(app: AppHandle, runtime: State<'_, Sessions>, save: bool, label: String) -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new().set_directory(dir(&app, &["Sessions"])?).add_filter(label, &["halation-session"]);
    let picked = if save { crate::save_location::resolve(&app, "Session.halation-session", Some("session"))? } else { dialog.pick_file() };
    let Some(mut p) = picked else { return Ok(None) };
    if save && p.extension().and_then(|s| s.to_str()) != Some("halation-session") { p.set_extension("halation-session"); }
    hold(&runtime.allowed).insert(p.clone());
    Ok(Some(p.to_string_lossy().into_owned()))
}
fn authorized(runtime: &Sessions, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !hold(&runtime.allowed).contains(&p) { return Err("Session file was not selected".into()); }
    Ok(p)
}
#[tauri::command]
pub(crate) fn session_write(app: AppHandle, runtime: State<'_, Sessions>, path: String, snapshot: Value) -> Result<(), String> {
    checked(&snapshot)?;
    pin_media(&app, &snapshot)?;
    let target = if crate::save_location::allows(&app, std::path::Path::new(&path)) { PathBuf::from(&path) } else { authorized(&runtime, &path)? };
    hold(&runtime.allowed).insert(target.clone());
    write_atomic(&target, serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?.as_bytes())
}
#[tauri::command]
pub(crate) fn session_read(app: AppHandle, runtime: State<'_, Sessions>, path: String) -> Result<Value, String> {
    let v = read_json(&authorized(&runtime, &path)?).ok_or("Cannot read Halation Session")?;
    checked(&v)?;
    pin_media(&app, &v)?;
    Ok(v)
}

// Browser File inputs do not expose native paths. Keep a referenced file beside sessions,
// never embed bytes in their JSON. Existing native paths are kept by the frontend.
#[tauri::command]
pub(crate) fn session_file_put(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let name = crate::clean_filename(&header(&request, "x-name"));
    let p = unique_path(&dir(&app, &["Sessions", ".media"])?, &name);
    write_atomic(&p, raw_body(&request)?)?;
    Ok(p.to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) fn session_file_read(path: String) -> Result<Response, String> {
    // Only explicit Session references use this command. It is read-only; restored paths
    // are also registered with the existing video picker before decoding.
    Ok(Response::new(fs::read(path).map_err(|e| e.to_string())?))
}
#[tauri::command]
pub(crate) fn session_file_reference(app: AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !crate::workspace::inside(&app, &source) { return Ok(path); }
    let name = source.file_name().and_then(|n| n.to_str()).ok_or("invalid path")?;
    let target = unique_path(&dir(&app, &["Sessions", ".media"])?, name);
    fs::copy(source, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) fn session_allow_video(picked: State<'_, crate::framegrab::Picked>, path: String) -> Result<(), String> {
    let p = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    hold(&picked.0).insert(p);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn tool_work_is_not_a_preference() {
        assert!(!temporary("intro") && temporary("framegrab"));
        assert!(!temporary("settings") && !temporary("library") && !temporary("profiles"));
        assert_eq!(persistent_part("grade", &json!({"current": {}, "previewPct": 25, "looks": {"Saved": []}})), json!({"looks": {"Saved": []}}));
        assert_eq!(persistent_part("visualizer", &json!({"current": {}, "fonts": [1]})), json!({"fonts": [1]}));
    }
    #[test]
    fn session_format_is_explicitly_versioned() {
        assert!(valid(&json!({"app":"halation-session","version":1,"tools":{}})));
        assert!(!valid(&json!({"app":"halation-session","version":2,"tools":{}})));
    }
    #[test]
    fn saved_media_markers_do_not_depend_on_file_extensions() {
        assert_eq!(saved_marker(std::path::Path::new("cover")), PathBuf::from("cover.saved"));
        assert_eq!(saved_marker(std::path::Path::new("cover.png")), PathBuf::from("cover.png.saved"));
    }
}
