//! Presets and looks: one .json per preset in Presets\Visualizer and Presets\Grade.

use crate::paths::*;
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
};
use tauri::{
    AppHandle,
};

/* ---------- presets and looks: one .json per preset ---------- */

#[derive(Serialize)]
pub(crate) struct PresetFile {
    name: String,
    content: String,
    modified: u64,
}

pub(crate) fn preset_entries(app: &AppHandle, kind: &str) -> Result<Vec<(String, PathBuf, fs::Metadata)>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(preset_dir(app, kind)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if ext_of(&path.to_string_lossy()) != "json" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if meta.is_file() {
            out.push((name, path, meta));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

#[tauri::command]
pub(crate) fn preset_list(app: AppHandle, kind: String) -> Result<Vec<PresetFile>, String> {
    let mut out = Vec::new();
    for (name, path, meta) in preset_entries(&app, &kind)? {
        let Ok(content) = fs::read_to_string(&path) else { continue };
        out.push(PresetFile {
            name,
            content: content.trim_start_matches('\u{feff}').to_string(),
            modified: modified_ms(&meta),
        });
    }
    Ok(out)
}

/// Cheap fingerprint of the folder: changes when a preset is added, removed or edited.
#[tauri::command]
pub(crate) fn preset_stamp(app: AppHandle, kind: String) -> Result<String, String> {
    Ok(preset_entries(&app, &kind)?
        .iter()
        .map(|(n, _, m)| format!("{n}:{}:{}", modified_ms(m), m.len()))
        .collect::<Vec<_>>()
        .join("|"))
}

#[tauri::command]
pub(crate) fn preset_write(app: AppHandle, kind: String, name: String, content: String) -> Result<(), String> {
    check_stem(&name)?;
    write_atomic(&preset_dir(&app, &kind)?.join(format!("{name}.json")), content.as_bytes())
}

#[tauri::command]
pub(crate) fn preset_delete(app: AppHandle, kind: String, name: String) -> Result<bool, String> {
    check_stem(&name)?;
    let path = preset_dir(&app, &kind)?.join(format!("{name}.json"));
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path).map(|_| true).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn preset_rename(app: AppHandle, kind: String, from: String, to: String, copy: bool) -> Result<(), String> {
    check_stem(&from)?;
    check_stem(&to)?;
    let d = preset_dir(&app, &kind)?;
    let (src, dst) = (d.join(format!("{from}.json")), d.join(format!("{to}.json")));
    if !src.exists() {
        return Err(format!("\"{from}\" no longer exists"));
    }
    let same_file = !copy && from.eq_ignore_ascii_case(&to);
    if dst.exists() && !same_file {
        return Err(format!("\"{to}\" already exists"));
    }
    if copy {
        fs::copy(&src, &dst).map(|_| ()).map_err(|e| e.to_string())
    } else {
        fs::rename(&src, &dst).map_err(|e| e.to_string())
    }
}
