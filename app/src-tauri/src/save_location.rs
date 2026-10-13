//! One destination policy for user exports. Temporary/cache writes never enter this layer.
use crate::{paths::*, state::*};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub(crate) struct Destinations(pub Mutex<HashMap<PathBuf, bool>>, pub Mutex<HashSet<PathBuf>>);

pub(crate) fn allows(app: &AppHandle, path: &Path) -> bool {
    if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) { return false; }
    hold(&app.state::<Destinations>().0).keys().any(|p| path == p || p.is_dir() && path.starts_with(p))
}

pub(crate) fn resolve(app: &AppHandle, name: &str, kind: Option<&str>) -> Result<Option<PathBuf>, String> {
    resolve_in(app, name, kind, None)
}

pub(crate) fn resolve_in(app: &AppHandle, name: &str, kind: Option<&str>, folder: Option<&str>) -> Result<Option<PathBuf>, String> {
    let mode = setting(app, "saveMode").ok_or("Choose a save & export location first")?;
    let manual = match mode.as_str() {
        "ask-every-time" | "ask" => true,
        "halation-folder" | "direct" => false,
        _ => return Err("Choose a save & export location first".into()),
    };
    let name = clean_filename(name);
    let p = if manual {
        let last = {
            let lock = app.state::<StateLock>(); let _g = hold(&lock.0);
            read_state(app)?.get("exportLocation").and_then(|v| v.get("lastManualDirectory")).and_then(Value::as_str).map(PathBuf::from)
        };
        let mut dialog = rfd::FileDialog::new().set_title(if spanish(app) { "Guardar" } else { "Save export" }).set_file_name(&name);
        if let Some(d) = last.filter(|p| p.is_dir()) { dialog = dialog.set_directory(d); }
        let ext = ext_of(&name);
        if !ext.is_empty() { dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]); }
        dialog.save_file()
    } else {
        let mut d = match kind {
            Some("session") => dir(app, &["Sessions"]),
            Some(k) => crate::outfiles::out_dir(app, k),
            None => export_dir(app, &name),
        }?;
        if let Some(folder) = folder {
            for part in folder.split(['/', '\\']).filter(|p| !p.is_empty() && *p != "." && *p != "..") { d.push(file_stem(part)); }
            std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        }
        let runtime = app.state::<Destinations>();
        let mut pending = hold(&runtime.0);
        let p = available_path(&d, &name, &pending);
        pending.insert(p.clone(), false);
        Some(p)
    };
    if let Some(p) = &p {
        hold(&app.state::<Destinations>().0).insert(p.clone(), manual);
        hold(&app.state::<Destinations>().1).remove(p);
    }
    Ok(p)
}

fn available_path(dir: &Path, name: &str, pending: &HashMap<PathBuf, bool>) -> PathBuf {
    let source = Path::new(name);
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    std::iter::once(dir.join(name)).chain((2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))))
        .find(|p| !p.exists() && !pending.contains_key(p)).expect("unbounded name candidates")
}

#[tauri::command]
pub(crate) async fn export_destination(app: AppHandle, name: String, kind: Option<String>, folder: Option<String>) -> Result<Option<String>, String> {
    // Native dialogs must not block the IPC thread that paints the application.
    tauri::async_runtime::spawn_blocking(move || resolve_in(&app, &name, kind.as_deref(), folder.as_deref()).map(|p| p.map(|p| p.to_string_lossy().into_owned())))
        .await.map_err(|e| e.to_string())?
}

/// Commit the remembered directory only after the tool has successfully written its final output.
#[tauri::command]
pub(crate) fn export_completed(app: AppHandle, path: String) -> Result<Value, String> {
    let p = PathBuf::from(path);
    if !p.is_file() && !p.is_dir() { return Err("The export was not created".into()); }
    let manual = hold(&app.state::<Destinations>().0).get(&p).copied();
    let Some(manual) = manual else { return Ok(json!({"fresh":false})); };
    if hold(&app.state::<Destinations>().1).contains(&p) { return Ok(json!({"fresh":false})); }
    let lock = app.state::<StateLock>(); let _g = hold(&lock.0);
    let mut state = read_state(&app)?;
    let location = state.entry("exportLocation").or_insert_with(|| json!({"lastManualDirectory":null,"folderExplanationShown":false}));
    if manual {
        location["lastManualDirectory"] = json!(p.parent().ok_or("invalid export path")?.to_string_lossy());
    }
    let explain = !manual && location["folderExplanationShown"] != true;
    if explain { location["folderExplanationShown"] = json!(true); }
    write_state(&app, &state)?;
    hold(&app.state::<Destinations>().1).insert(p);
    Ok(json!({"fresh":true,"managed":!manual,"explain":explain}))
}

#[tauri::command]
pub(crate) fn export_copy(app: AppHandle, source: String, destination: String) -> Result<String, String> {
    let src = inside_base(&app, &source)?;
    let dst = PathBuf::from(&destination);
    if !allows(&app, &dst) { return Err("Destination was not selected".into()); }
    std::fs::copy(src, dst).map_err(|e| e.to_string())?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reservations_do_not_collide_before_the_writer_starts() {
        let dir = std::env::temp_dir().join(format!("halation-dest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut pending = HashMap::new();
        let first = available_path(&dir, "cover.png", &pending);
        pending.insert(first, false);
        assert_eq!(available_path(&dir, "cover.png", &pending), dir.join("cover (2).png"));
        std::fs::write(dir.join("cover (2).png"), b"x").unwrap();
        assert_eq!(available_path(&dir, "cover.png", &pending), dir.join("cover (3).png"));
        assert_eq!(available_path(&dir, "layers", &HashMap::new()), dir.join("layers"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
