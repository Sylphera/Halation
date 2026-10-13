//! Saving exports: whole files, videos written piece by piece, opening and revealing them.

use crate::paths::*;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};
use tauri::{
    ipc::Request,
    AppHandle, State,
};

/// Videos being written to disk while they are rendered.
pub(crate) struct Exports(pub(crate) Mutex<HashMap<u32, (fs::File, PathBuf)>>);
pub(crate) static NEXT_EXPORT: AtomicU32 = AtomicU32::new(1);

/* ---------- export ---------- */

/// Where an export goes: the folder for its extension, or of an output kind (outfiles::out_dir); asks with a
/// dialog when Settings says so and the export is not direct.
pub(crate) fn pick_path_in(app: &AppHandle, name: &str, direct: bool, kind: Option<&str>) -> Result<Option<PathBuf>, String> {
    let _ = direct; // Batches and codec retries cannot bypass the global policy.
    crate::save_location::resolve(app, name, kind)
}

/// Saves a whole file (header x-kind: the folder of an output kind, as export_open). Returns its path, or null
/// if the dialog was cancelled.
#[tauri::command]
pub(crate) fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let data = raw_body(&request)?;
    let direct = false;
    let selected = header(&request, "x-path");
    let kind = header(&request, "x-kind");
    let picked = if selected.is_empty() { pick_path_in(&app, &header(&request, "x-filename"), direct, (!kind.is_empty()).then_some(kind.as_str()))? }
        else { let p = PathBuf::from(selected); if !crate::save_location::allows(&app, &p) { return Err("Destination was not selected".into()); } Some(p) };
    match picked {
        Some(path) => {
            fs::write(&path, data).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[derive(Serialize)]
pub(crate) struct ExportInfo {
    id: u32,
    path: String,
}

/// Opens a video file so it can be written piece by piece while it is rendered (kind: the folder of an
/// output kind, such as "frames"; none: the folder for the extension).
#[tauri::command]
pub(crate) fn export_open(app: AppHandle, exports: State<'_, Exports>, name: String, direct: bool, kind: Option<String>, path: Option<String>) -> Result<Option<ExportInfo>, String> {
    let picked = if let Some(p) = path { let p = PathBuf::from(p); if !crate::save_location::allows(&app, &p) { return Err("Destination was not selected".into()); } Some(p) } else { pick_path_in(&app, &name, direct, kind.as_deref())? };
    let Some(path) = picked else { return Ok(None) };
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let id = NEXT_EXPORT.fetch_add(1, Ordering::Relaxed);
    let info = ExportInfo { id, path: path.to_string_lossy().into_owned() };
    hold(&exports.0).insert(id, (file, path));
    Ok(Some(info))
}

#[tauri::command]
pub(crate) async fn export_write(exports: State<'_, Exports>, request: Request<'_>) -> Result<(), String> {
    let data = raw_body(&request)?;
    let id: u32 = header(&request, "x-id").parse().map_err(|_| "unknown export")?;
    let pos: u64 = header(&request, "x-pos").parse().map_err(|_| "invalid position")?;
    let mut map = hold(&exports.0);
    let (file, _) = map.get_mut(&id).ok_or("export already closed")?;
    file.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn export_close(exports: State<'_, Exports>, id: u32) -> Result<String, String> {
    let (mut file, path) = hold(&exports.0).remove(&id).ok_or("export already closed")?;
    file.flush().map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_abort(exports: State<'_, Exports>, id: u32) -> Result<(), String> {
    if let Some((file, path)) = hold(&exports.0).remove(&id) {
        drop(file);
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

#[tauri::command]
pub(crate) fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = inside_base(&app, &path)?;
    spawn_explorer(&[p.as_os_str()])
}

#[tauri::command]
pub(crate) fn reveal_path(_app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        let parent = p.parent().filter(|p| p.is_dir()).ok_or("The export folder no longer exists")?;
        return spawn_explorer(&[parent.as_os_str()]);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{UI::Shell::{SHParseDisplayName, SHOpenFolderAndSelectItems}, System::Com::{CoInitializeEx, CoUninitialize, CoTaskMemFree, COINIT_APARTMENTTHREADED}};
        let wide: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) >= 0;
            let mut pidl = std::ptr::null_mut();
            let parsed = SHParseDisplayName(wide.as_ptr(), std::ptr::null_mut(), &mut pidl, 0, std::ptr::null_mut());
            let shown = parsed >= 0 && SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0) >= 0;
            if !pidl.is_null() { CoTaskMemFree(pidl.cast()); }
            if initialized { CoUninitialize(); }
            if shown { return Ok(()); }
        }
        spawn_explorer(&[p.parent().unwrap_or(&p).as_os_str()])
    }
    #[cfg(not(target_os = "windows"))]
    {
        spawn_explorer(&[p.parent().unwrap_or(&p).as_os_str()])
    }
}
