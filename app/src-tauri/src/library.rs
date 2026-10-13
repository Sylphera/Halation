//! The Library (docs/ARCHITECTURE.md → Shared services): the user's sections, folders of Documents\Halation\Library, the
//! folders of the PC linked as sections (read where they are, never copied) and the optional packs
//! (Library\Packs\<pack>, read-only). What the page keeps about them (order, links, favourites, tags) is the
//! state "library" in Settings\app.json; a folder outside Halation's is only read while that state links it.
//! Thumbnails of the items are cached in Tools\cache\library (Settings → Storage clears them).

use crate::{paths::*, state::read_state};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{ipc::Response, AppHandle};

/// What a section shows: pictures and videos (their first frame here; playback lives in the tools).
pub(crate) const MEDIA: [&str; 10] = ["png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "webm", "mov", "mp4"];
const PACKS: &str = "Packs";

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    dir(app, &["Library"])
}

/// The folders the state links as sections
pub(crate) fn linked(app: &AppHandle) -> Vec<PathBuf> {
    let m = read_state(app).unwrap_or_default();
    m.get("library")
        .and_then(|l| l.get("linked"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.get("path").and_then(Value::as_str)).map(PathBuf::from).collect())
        .unwrap_or_default()
}

/// A path the Library may read: inside the Halation folder or inside a linked folder
pub(crate) fn readable(base: &Path, links: &[PathBuf], path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path).canonicalize().map_err(|_| "the file no longer exists".to_string())?;
    // a file of the PC added to the index by reference is read where it is (LIBRARY_SPEC §4)
    if p.is_file() && hold(&KNOWN).contains(path) {
        return Ok(p);
    }
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    if p.starts_with(&base) || links.iter().filter_map(|l| l.canonicalize().ok()).any(|l| p.starts_with(l)) {
        Ok(p)
    } else {
        Err("path outside the Library".into())
    }
}

/// How many items a folder holds and when the newest changed: the page compares both to sync a section
pub(crate) fn stamp(d: &Path) -> (u64, u64) {
    let Ok(rd) = fs::read_dir(d) else { return (0, 0) };
    let dm = fs::metadata(d).map(|m| modified_ms(&m)).unwrap_or(0);
    rd.flatten()
        .filter(|e| MEDIA.contains(&ext_of(&e.file_name().to_string_lossy()).as_str()))
        .filter_map(|e| e.metadata().ok().filter(|m| m.is_file()))
        .fold((0, dm), |(n, t), m| (n + 1, t.max(modified_ms(&m))))
}

fn section_json(name: &str, p: &Path) -> Value {
    let present = p.is_dir();
    let (count, stamp) = if present { stamp(p) } else { (0, 0) };
    json!({ "name": name, "path": p.to_string_lossy(), "missing": !present, "count": count, "stamp": stamp })
}

fn subfolders(d: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(d)
        .map(|rd| rd.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

/// {root, own: [...], packs: [...], linked: [...]}: each {name, path, missing, count, stamp}. A linked folder
/// that disappeared is listed as missing, without an error.
#[tauri::command]
pub fn library_sections(app: AppHandle) -> Result<Value, String> {
    let r = root(&app)?;
    let own: Vec<Value> = subfolders(&r).iter().filter(|n| *n != PACKS).map(|n| section_json(n, &r.join(n))).collect();
    let packs: Vec<Value> = subfolders(&r.join(PACKS)).iter().map(|n| section_json(n, &r.join(PACKS).join(n))).collect();
    let links: Vec<Value> = linked(&app)
        .iter()
        .map(|p| section_json(&p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), p))
        .collect();
    Ok(json!({ "root": r.to_string_lossy(), "own": own, "packs": packs, "linked": links }))
}

/// The items of a section's folder, newest first: [{path, name, size, modified}]
#[tauri::command]
pub fn library_items(app: AppHandle, path: String) -> Result<Vec<Value>, String> {
    let d = readable(&base_dir(&app)?, &linked(&app), &path)?;
    if !d.is_dir() {
        return Ok(vec![]);
    }
    crate::outfiles::files_in(&d, &MEDIA.map(String::from))
}

#[tauri::command]
pub fn library_read(app: AppHandle, path: String) -> Result<Response, String> {
    let p = readable(&base_dir(&app)?, &linked(&app), &path)?;
    Ok(Response::new(fs::read(p).map_err(|e| e.to_string())?))
}

/// An own section's folder: a single valid name, never the packs' folder
fn own_section(r: &Path, name: &str) -> Result<PathBuf, String> {
    check_stem(name)?;
    if name.is_empty() || name.eq_ignore_ascii_case(PACKS) {
        return Err(format!("invalid section name: {name}"));
    }
    Ok(r.join(name))
}

/// Sections: "create" name, "rename" name → to, "delete" name (the folder and what it holds)
pub(crate) fn section_op(r: &Path, op: &str, name: &str, to: &str) -> Result<String, String> {
    let d = own_section(r, name)?;
    match op {
        "create" => {
            if d.exists() {
                return Err("exists".into());
            }
            fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            Ok(d.to_string_lossy().into_owned())
        }
        "rename" => {
            let n = own_section(r, to)?;
            if n.exists() && !n.to_string_lossy().eq_ignore_ascii_case(&d.to_string_lossy()) {
                return Err("exists".into());
            }
            fs::rename(&d, &n).map_err(|e| e.to_string())?;
            Ok(n.to_string_lossy().into_owned())
        }
        "delete" => {
            if d.is_dir() {
                fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
            }
            Ok(String::new())
        }
        _ => Err(format!("unknown operation {op}")),
    }
}

#[tauri::command]
pub fn library_section(app: AppHandle, op: String, name: String, to: Option<String>) -> Result<String, String> {
    section_op(&root(&app)?, &op, &name, to.as_deref().unwrap_or(""))
}

/// Where a file written to the Library goes: an own section ("Covers"), or a pack ("Packs/Grain") when the page
/// installs one; the folder is created
pub(crate) fn target_dir(r: &Path, section: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = section.split('/').collect();
    let d = match parts.as_slice() {
        [PACKS, pack] => {
            check_stem(pack)?;
            if pack.is_empty() {
                return Err("invalid pack".into());
            }
            r.join(PACKS).join(pack)
        }
        [name] => own_section(r, name)?,
        _ => return Err(format!("invalid section {section}")),
    };
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Bytes from the page (a file dropped or added, a cut-out or cropped version, a pack's picture) into a section
/// with a free name; returns the new path
#[tauri::command]
pub fn library_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let d = target_dir(&root(&app)?, &header(&request, "x-section"))?;
    let name = crate::clean_filename(&header(&request, "x-name"));
    if !MEDIA.contains(&ext_of(&name).as_str()) {
        return Err(format!("not a picture or video: {name}"));
    }
    let p = unique_path(&d, &name);
    fs::write(&p, raw_body(&request)?).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// Removes an item of an own section (a pack or a linked folder is never changed)
#[tauri::command]
pub fn library_remove(app: AppHandle, path: String) -> Result<(), String> {
    let r = root(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = Path::new(&path).canonicalize().map_err(|_| "the file no longer exists".to_string())?;
    if !p.starts_with(&r) || p.starts_with(r.join(PACKS)) || !p.is_file() {
        return Err("not an item of an own section".into());
    }
    fs::remove_file(p).map_err(|e| e.to_string())
}

/// Removes an installed pack (Settings → Modules)
#[tauri::command]
pub fn library_pack_remove(app: AppHandle, id: String) -> Result<(), String> {
    check_stem(&id)?;
    let d = root(&app)?.join(PACKS).join(&id);
    if id.is_empty() || !d.is_dir() {
        return Ok(());
    }
    fs::remove_dir_all(d).map_err(|e| e.to_string())
}

/// Files of the PC to add by reference (the system's file dialog); none if cancelled
#[tauri::command]
pub fn library_pick_files(label: Option<String>) -> Vec<String> {
    rfd::FileDialog::new()
        .add_filter(label.as_deref().unwrap_or("Media"), &SCAN)
        .pick_files()
        .map(|v| v.iter().map(|p| p.to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

/// A folder of the PC to link as a section (the system's folder dialog); none if cancelled
#[tauri::command]
pub fn library_pick_folder() -> Option<String> {
    rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().into_owned())
}

/* ---------- the index (LIBRARY_SPEC §3) ---------- */
// Settings\Library\index.json: every item the Library knows (assets, presets, looks, exports, downloads) by reference,
// with its file identity so a file renamed or moved on the same drive is followed. The page owns the index; these
// commands read and write it, list folders with that identity and find missing files by it.

/// What the index lists: pictures and videos, sound, fonts and the presets' JSON
pub(crate) const SCAN: [&str; 20] = [
    "png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "webm", "mov", "mp4", "mkv", "mp3", "wav", "opus", "m4a", "flac", "ogg", "ttf", "otf", "json",
];
/// The paths of the index, readable where they are (library_read, thumbnails)
static KNOWN: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::LazyLock::new(Default::default);

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dir(app, &["Settings", "Library"])?.join("index.json"))
}
fn remember(v: &Value) {
    let paths = v.get("items").and_then(Value::as_array).map(|a| a.iter().filter_map(|i| i.get("path").and_then(Value::as_str)).map(String::from).collect()).unwrap_or_default();
    *hold(&KNOWN) = paths;
}

/// The index, or nothing before the first one (the page migrates then)
#[tauri::command]
pub fn library_index_get(app: AppHandle) -> Result<Option<Value>, String> {
    let v = read_json(&index_path(&app)?);
    if let Some(v) = &v {
        remember(v);
    }
    Ok(v)
}
#[tauri::command]
pub fn library_index_put(app: AppHandle, index: Value) -> Result<(), String> {
    let data = serde_json::to_vec(&index).map_err(|e| e.to_string())?;
    write_atomic(&index_path(&app)?, &data)?;
    remember(&index);
    Ok(())
}

/// A file's identity on its drive: volume serial + file index on Windows (GetFileInformationByHandle), device +
/// inode elsewhere. The same after a rename or a move on the same drive.
#[cfg(windows)]
pub(crate) fn file_key(p: &Path) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let f = fs::File::open(p).ok()?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the handle is the open file's for the whole call; info is a plain struct the call fills
    let ok = unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) };
    (ok != 0).then(|| format!("vol:{:08X}|idx:{:08X}{:08X}", info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow))
}
#[cfg(not(windows))]
pub(crate) fn file_key(p: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let m = fs::metadata(p).ok()?;
    Some(format!("dev:{:X}|ino:{:X}", m.dev(), m.ino()))
}

fn entry(p: &Path, meta: &fs::Metadata) -> Value {
    json!({ "path": p.to_string_lossy(), "name": p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        "size": meta.len(), "mtime": modified_ms(meta), "fileKey": file_key(p) })
}
/// The files under `d` the index lists, `depth` folders down (0: that folder only)
pub(crate) fn scan(d: &Path, depth: u32, exts: &[&str], out: &mut Vec<Value>) {
    let Ok(rd) = fs::read_dir(d) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                scan(&p, depth - 1, exts, out);
            }
        } else if exts.contains(&ext_of(&e.file_name().to_string_lossy()).as_str()) {
            out.push(entry(&p, &meta));
        }
    }
}

/// A folder (with `depth` levels below it) or one file: [{path, name, size, mtime, fileKey}]. Folders inside
/// Halation's or linked; a single file anywhere (it is being added by reference).
#[tauri::command]
pub fn library_scan(app: AppHandle, path: String, depth: Option<u32>, exts: Option<Vec<String>>) -> Result<Vec<Value>, String> {
    let p = Path::new(&path);
    if p.is_file() {
        let meta = fs::metadata(p).map_err(|e| e.to_string())?;
        return Ok(vec![entry(p, &meta)]);
    }
    if !p.is_dir() {
        return Ok(vec![]);
    }
    let d = readable(&base_dir(&app)?, &linked(&app), &path)?;
    let exts: Vec<String> = exts.unwrap_or_else(|| SCAN.iter().filter(|x| **x != "json").map(|x| x.to_string()).collect());
    let exts: Vec<&str> = exts.iter().map(String::as_str).collect();
    let mut out = vec![];
    scan(&d, depth.unwrap_or(0).min(6), &exts, &mut out);
    Ok(out)
}

/// Where the missing files went: each wanted {key, size} looked for in the folders given (4 levels down), by size
/// first and then by identity. {key: path} for the ones found.
pub(crate) fn resolve(dirs: &[PathBuf], want: &[(String, u64)]) -> serde_json::Map<String, Value> {
    fn walk(d: &Path, depth: u32, want: &[(String, u64)], found: &mut serde_json::Map<String, Value>) {
        let Ok(rd) = fs::read_dir(d) else { return };
        for e in rd.flatten() {
            if found.len() == want.len() {
                return;
            }
            let p = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_dir() {
                if depth > 0 {
                    walk(&p, depth - 1, want, found);
                }
            } else if want.iter().any(|(_, s)| *s == meta.len()) {
                if let Some(k) = file_key(&p) {
                    if want.iter().any(|(w, _)| *w == k) && !found.contains_key(&k) {
                        found.insert(k, Value::String(p.to_string_lossy().into_owned()));
                    }
                }
            }
        }
    }
    let mut found = serde_json::Map::new();
    for d in dirs {
        walk(d, 4, want, &mut found);
    }
    found
}
#[tauri::command]
pub fn library_resolve(app: AppHandle, dirs: Vec<String>, want: Vec<Value>) -> Result<Value, String> {
    let (base, links) = (base_dir(&app)?, linked(&app));
    // a folder Halation may read, or one that held a file of the index (added by reference)
    let known = hold(&KNOWN).clone();
    let held = |d: &str| known.iter().any(|p| Path::new(p).parent() == Some(Path::new(d)));
    let dirs: Vec<PathBuf> = dirs
        .iter()
        .filter_map(|d| readable(&base, &links, d).ok().or_else(|| held(d).then(|| PathBuf::from(d))))
        .filter(|d| d.is_dir())
        .collect();
    let want: Vec<(String, u64)> = want
        .iter()
        .filter_map(|w| Some((w.get("key")?.as_str()?.to_string(), w.get("size").and_then(Value::as_u64).unwrap_or(0))))
        .collect();
    Ok(Value::Object(resolve(&dirs, &want)))
}

/* ---------- cached thumbnails ---------- */
// The workspace's "thumbs" area (workspace.rs), under its one budget.

/// The cached thumbnail for `key`, or nothing (an empty answer)
#[tauri::command]
pub fn library_thumb_get(app: AppHandle, ws: tauri::State<'_, crate::workspace::Workspace>, key: String) -> Result<Response, String> {
    Ok(Response::new(crate::workspace::get(&app, &ws, "thumbs", &key)?))
}
#[tauri::command]
pub fn library_thumb_put(app: AppHandle, ws: tauri::State<'_, crate::workspace::Workspace>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    crate::workspace::put(&app, &ws, "thumbs", &header(&request, "x-key"), raw_body(&request)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("halation-lib-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn sections_are_created_renamed_and_deleted_inside_the_library() {
        let r = tmp("ops");
        section_op(&r, "create", "Covers", "").unwrap();
        assert!(r.join("Covers").is_dir());
        assert_eq!(section_op(&r, "create", "Covers", ""), Err("exists".into()));
        assert!(section_op(&r, "create", "..", "").is_err());
        assert!(section_op(&r, "create", "a/b", "").is_err());
        assert!(section_op(&r, "create", "Packs", "").is_err());
        fs::write(r.join("Covers").join("x.png"), b"x").unwrap();
        section_op(&r, "rename", "Covers", "Art").unwrap();
        assert!(r.join("Art").join("x.png").is_file() && !r.join("Covers").exists());
        section_op(&r, "delete", "Art", "").unwrap();
        assert!(!r.join("Art").exists());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn writes_go_to_a_section_or_a_pack_and_nowhere_else() {
        let r = tmp("write");
        assert_eq!(target_dir(&r, "Frames").unwrap(), r.join("Frames"));
        assert_eq!(target_dir(&r, "Packs/Grain").unwrap(), r.join("Packs").join("Grain"));
        for bad in ["../x", "Packs/../x", "Packs", "a/b", "Packs/a/b", ""] {
            assert!(target_dir(&r, bad).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn a_linked_folder_is_read_only_while_it_is_linked() {
        let (base, pc) = (tmp("base"), tmp("pc"));
        fs::write(pc.join("a.png"), b"x").unwrap();
        let file = pc.join("a.png").to_string_lossy().into_owned();
        assert!(readable(&base, &[], &file).is_err());
        assert!(readable(&base, std::slice::from_ref(&pc), &file).is_ok());
        assert!(readable(&base, std::slice::from_ref(&pc), &base.join("missing.png").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&pc);
    }

    #[test]
    fn a_stamp_changes_when_an_item_is_added_and_a_missing_folder_is_no_error() {
        let d = tmp("stamp");
        fs::write(d.join("a.png"), b"x").unwrap();
        fs::write(d.join("notes.txt"), b"x").unwrap();
        let s1 = stamp(&d);
        assert_eq!(s1.0, 1);
        fs::write(d.join("b.webm"), b"x").unwrap();
        assert_eq!(stamp(&d).0, 2);
        let gone = d.join("gone");
        assert_eq!(section_json("gone", &gone)["missing"], true);
        assert_eq!(stamp(&gone), (0, 0));
        let _ = fs::remove_dir_all(&d);
    }
    #[test]
    fn a_file_keeps_its_identity_when_renamed_or_moved_and_is_found_by_it() {
        let d = tmp("key");
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a.png"), b"12345").unwrap();
        fs::write(d.join("b.png"), b"54321").unwrap();
        let k = file_key(&d.join("a.png")).unwrap();
        assert_ne!(Some(k.clone()), file_key(&d.join("b.png")));
        fs::rename(d.join("a.png"), d.join("sub").join("renamed.png")).unwrap();
        assert_eq!(file_key(&d.join("sub").join("renamed.png")), Some(k.clone()));
        let found = resolve(std::slice::from_ref(&d), &[(k.clone(), 5), ("nothing".into(), 5)]);
        assert_eq!(found.get(&k).and_then(Value::as_str), Some(d.join("sub").join("renamed.png").to_string_lossy().as_ref()));
        assert_eq!(found.len(), 1);
        let mut out = vec![];
        scan(&d, 0, &["png"], &mut out);
        assert_eq!(out.len(), 1);
        out.clear();
        scan(&d, 1, &["png"], &mut out);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|e| e["fileKey"].is_string() && e["size"] == 5));
        let _ = fs::remove_dir_all(&d);
    }
}
