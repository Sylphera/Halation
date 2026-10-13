//! Uploaded resources: fonts and logos in Resources.

use crate::paths::*;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{
    ipc::{Request, Response},
    AppHandle,
};

pub(crate) const FONT_EXT: [&str; 4] = ["ttf", "otf", "woff", "woff2"];
/* ---------- uploaded resources: fonts and logos ---------- */

pub(crate) fn asset_dirs(app: &AppHandle) -> Result<[PathBuf; 2], String> {
    Ok([dir(app, &["Resources", "Fonts"])?, dir(app, &["Resources", "Logos"])?])
}

pub(crate) fn find_asset(app: &AppHandle, id: &str) -> Result<Option<PathBuf>, String> {
    let id = safe_id(id);
    if id.is_empty() {
        return Ok(None);
    }
    for d in asset_dirs(app)? {
        for entry in fs::read_dir(d).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.is_file() && path.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(&id)) {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub(crate) fn asset_put(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let data = raw_body(&request)?;
    let ext = match safe_id(&header(&request, "x-ext")).to_ascii_lowercase() {
        e if e.is_empty() => "bin".to_string(),
        e => e,
    };
    let [fonts, logos] = asset_dirs(&app)?;
    let dest = if FONT_EXT.contains(&ext.as_str()) { fonts } else { logos };
    let original = header(&request, "x-name");
    let stem = safe_id(Path::new(&original).file_stem().and_then(|s| s.to_str()).unwrap_or(""));
    let base = if stem.is_empty() { format!("{:x}", now_ms()) } else { stem };
    let mut id = base.clone();
    let mut n = 2;
    while find_asset(&app, &id)?.is_some() {
        id = format!("{base}-{n}");
        n += 1;
    }
    fs::write(dest.join(format!("{id}.{ext}")), data).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub(crate) fn asset_get(app: AppHandle, id: String) -> Result<Response, String> {
    let path = find_asset(&app, &id)?.ok_or("not found")?;
    Ok(Response::new(fs::read(path).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub(crate) fn asset_delete(app: AppHandle, id: String) -> Result<bool, String> {
    match find_asset(&app, &id)? {
        Some(path) => fs::remove_file(path).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

#[derive(Serialize)]
pub(crate) struct FontFile {
    id: String,
    file: String,
}

/// Fonts in Resources\Fonts, including the ones copied there by hand.
#[tauri::command]
pub(crate) fn font_files(app: AppHandle) -> Result<Vec<FontFile>, String> {
    let [fonts, _] = asset_dirs(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(fonts).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let file = entry.file_name().to_string_lossy().into_owned();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if path.is_file() && FONT_EXT.contains(&ext_of(&file).as_str()) && safe_id(stem) == stem && !stem.is_empty() {
            out.push(FontFile { id: stem.to_string(), file });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
