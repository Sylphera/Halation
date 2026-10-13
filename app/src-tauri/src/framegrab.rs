//! Frame Grab: reading a video in pieces and its cache on disk.
//! The page decodes the video itself (Mediabunny) from byte ranges read here, so a video is never read into memory
//! whole; a video can come from the Halation folder, a folder linked in the Library, or the file picker here. The
//! keyframe index, the strip's small frames, the analysis (sharpness, scene changes) and, for videos the page cannot
//! decode, the keyframes at preview size are kept by a hash of the file's content in the workspace's "frames" area
//! (workspace.rs), so a video opened again is ready at once, within the workspace's budget (Settings → Storage).

use crate::{library::linked, paths::*};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Response, AppHandle, State};

/// Files chosen in Frame Grab's file picker: they may be read wherever they are
#[derive(Default)]
pub(crate) struct Picked(pub(crate) Mutex<HashSet<PathBuf>>);

const READ_MAX: u64 = 16 * 1024 * 1024;
const SAMPLE: u64 = 64 * 1024;

/* ---------- the file ---------- */

/// FNV-1a over the size and three 64 KiB samples (start, middle, end): the same video copied elsewhere keeps its key
fn content_key(path: &Path) -> Result<(u64, String), String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    let mut h: u64 = 0xcbf29ce484222325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    };
    feed(&size.to_le_bytes());
    let mut buf = vec![0u8; SAMPLE as usize];
    for at in [0, size.saturating_sub(SAMPLE) / 2, size.saturating_sub(SAMPLE)] {
        f.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        feed(&buf[..n]);
    }
    Ok((size, format!("{h:016x}")))
}

/// A video Frame Grab may read: inside the Halation folder, inside a linked Library folder, or picked here
fn readable(app: &AppHandle, picked: &Picked, path: &str) -> Result<PathBuf, String> {
    if let Ok(p) = crate::library::readable(&base_dir(app)?, &linked(app), path) {
        return Ok(p);
    }
    let p = Path::new(path).canonicalize().map_err(|_| "the file no longer exists".to_string())?;
    if hold(&picked.0).contains(&p) {
        Ok(p)
    } else {
        Err("path outside the Halation folder".into())
    }
}

/// The file picker for videos: {path, name}, or nothing if cancelled
#[tauri::command]
pub fn framegrab_pick(picked: State<'_, Picked>, label: Option<String>) -> Option<Value> {
    let p = rfd::FileDialog::new().add_filter(label.as_deref().unwrap_or("Video"), &["mp4", "m4v", "mov", "webm", "mkv"]).pick_file()?;
    let p = p.canonicalize().unwrap_or(p);
    hold(&picked.0).insert(p.clone());
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Some(json!({ "path": p.to_string_lossy(), "name": name }))
}

/// {size, key} of a video
#[tauri::command]
pub fn framegrab_probe(app: AppHandle, picked: State<'_, Picked>, path: String) -> Result<Value, String> {
    let (size, key) = content_key(&readable(&app, &picked, &path)?)?;
    Ok(json!({ "size": size, "key": key }))
}

/// Bytes start..end of a video (fewer at its end, or while FFmpeg is still writing it)
#[tauri::command]
pub fn framegrab_read(app: AppHandle, picked: State<'_, Picked>, path: String, start: u64, end: u64) -> Result<Response, String> {
    let p = readable(&app, &picked, &path)?;
    Ok(Response::new(read_range(&p, start, end)?))
}

/// A dropped video copied to Tools\temp in pieces (x-path: the file from temp_write, x-offset: where this piece goes),
/// so FFmpeg can read it without the whole video passing through memory at once
#[tauri::command]
pub fn framegrab_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let p = inside_base(&app, &header(&request, "x-path"))?;
    let at: u64 = header(&request, "x-offset").parse().map_err(|_| "invalid offset")?;
    let mut f = fs::OpenOptions::new().write(true).open(&p).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
    f.write_all(raw_body(&request)?).map_err(|e| e.to_string())
}

fn read_range(p: &Path, start: u64, end: u64) -> Result<Vec<u8>, String> {
    let mut f = fs::File::open(p).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let end = end.min(len).min(start.saturating_add(READ_MAX));
    if end <= start {
        return Ok(vec![]);
    }
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut out = vec![0u8; (end - start) as usize];
    f.read_exact(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/* ---------- the cache ---------- */
// The workspace's "frames" area (workspace.rs): one budget for every cache, least recently used out first.

/// The cached entry for `key`, or nothing (an empty answer); a hit counts as recent use
#[tauri::command]
pub fn framegrab_cache_get(app: AppHandle, ws: State<'_, crate::workspace::Workspace>, key: String) -> Result<Response, String> {
    Ok(Response::new(crate::workspace::get(&app, &ws, "frames", &key)?))
}

#[tauri::command]
pub fn framegrab_cache_put(app: AppHandle, ws: State<'_, crate::workspace::Workspace>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    crate::workspace::put(&app, &ws, "frames", &header(&request, "x-key"), raw_body(&request)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("halation-fg-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn key_follows_the_content_not_the_path() {
        let d = tmp("key");
        let data: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
        fs::write(d.join("a.mp4"), &data).unwrap();
        fs::write(d.join("b.mp4"), &data).unwrap();
        let mut other = data.clone();
        other[150_000] ^= 1;
        fs::write(d.join("c.mp4"), &other).unwrap();
        let (sa, ka) = content_key(&d.join("a.mp4")).unwrap();
        assert_eq!(sa, 300_000);
        assert_eq!(ka, content_key(&d.join("b.mp4")).unwrap().1);
        assert_ne!(ka, content_key(&d.join("c.mp4")).unwrap().1);
        assert!(safe_id(&ka) == ka && ka.len() == 16);
    }

    #[test]
    fn ranges_stop_at_the_end_of_the_file() {
        let d = tmp("range");
        fs::write(d.join("f"), b"0123456789").unwrap();
        assert_eq!(read_range(&d.join("f"), 2, 5).unwrap(), b"234");
        assert_eq!(read_range(&d.join("f"), 8, 100).unwrap(), b"89");
        assert!(read_range(&d.join("f"), 20, 30).unwrap().is_empty());
    }
}
