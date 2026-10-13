//! Files for downloads, upscaled images, cut-out pictures and captured video frames, inside the Halation
//! folder.

use crate::paths::*;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use tauri::{ipc::Response, AppHandle};

pub fn out_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    match kind {
        "converted" => dir(app, &["Exports", "Converted"]),
        "stems" => dir(app, &["Exports", "Stems"]),
        "video" => dir(app, &["Downloads", "Video"]),
        "audio" => dir(app, &["Downloads", "Audio"]),
        "cover" => dir(app, &["Downloads", "Covers"]),
        "upscaled" => dir(app, &["Exports", "Upscaled"]),
        "cutout" => dir(app, &["Exports", "Cutouts"]),
        "frames" => dir(app, &["Exports", "Frames"]),
        "interp" => dir(app, &["Exports", "Interpolated"]),
        "layers" => dir(app, &["Exports", "Videos"]),
        "library-frames" => dir(app, &["Library", "Frames"]),
        _ => Err(format!("unknown folder {kind}")),
    }
}

/// A free name in the folder for `kind`: "Title", or "Title (2)"… when any file already starts that way.
/// Returns the path without extension; the tool adds it.
#[tauri::command]
pub fn reserve_stem(app: AppHandle, kind: String, stem: String) -> Result<String, String> {
    let d = out_dir(&app, &kind)?;
    let base = file_stem(&stem);
    let taken = |s: &str| {
        fs::read_dir(&d).map(|rd| {
            rd.flatten().any(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                Path::new(&n).file_stem().is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(s))
                    || n.to_ascii_lowercase().starts_with(&format!("{}.", s.to_ascii_lowercase()))
            })
        }).unwrap_or(false)
    };
    let pick = std::iter::once(base.clone()).chain((2..).map(|n| format!("{base} ({n})"))).find(|s| !taken(s)).unwrap_or(base);
    Ok(d.join(pick).to_string_lossy().into_owned())
}

/// Copies bytes coming from the page to a file and returns its path: the work folder of the job named by x-job (an image
/// to upscale), loose temporary files in the workspace's temp\loose (gone at the next start), or Settings\Recent with
/// the header x-dir: recent (the copies behind the recent files on Home).
#[tauri::command]
pub fn temp_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let name = crate::clean_filename(&crate::header(&request, "x-name"));
    let data = crate::raw_body(&request)?;
    let job = crate::header(&request, "x-job");
    let d = if crate::header(&request, "x-dir") == "recent" {
        dir(&app, &["Settings", "Recent"])?
    } else {
        let lease = if crate::workspace::valid_key(&job) { job } else { "loose".to_string() };
        let d = crate::workspace::temp_root(&app)?.join(lease);
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        d
    };
    let p = crate::unique_path(&d, &name);
    fs::write(&p, data).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// Writes bytes from the page to a path returned by reserve_stem (a converted cover), inside the Halation folder or
/// the workspace (a job's work folder).
#[tauri::command]
pub fn write_path(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let target = PathBuf::from(crate::header(&request, "x-path"));
    let parent = target.parent().ok_or("invalid path")?;
    let base = base_dir(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent.starts_with(&base) && !crate::workspace::inside(&app, &parent) && !crate::save_location::allows(&app, &target) {
        return Err("path outside the Halation folder".into());
    }
    let name = target.file_name().and_then(|n| n.to_str()).ok_or("invalid path")?;
    let dest = parent.join(crate::clean_filename(name));
    fs::write(&dest, crate::raw_body(&request)?).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_path(app: AppHandle, path: String) -> Result<Response, String> {
    let p = inside_base(&app, &path);
    match p {
        Ok(p) => Ok(Response::new(fs::read(p).map_err(|e| e.to_string())?)),
        Err(_) => crate::library::library_read(app, path),
    }
}

// Large model bytes must not cross WebView IPC in one blocking response.
#[tauri::command]
pub fn read_path_chunk(app: AppHandle, path: String, offset: u64) -> Result<Response, String> {
    Ok(Response::new(read_chunk(&inside_base(&app, &path)?, offset)?))
}
fn read_chunk(path: &Path, offset: u64) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len().saturating_sub(offset).min(512 << 10) as usize;
    if len == 0 { return Ok(vec![]); }
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; len];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Removes what a cancelled job left behind (partial files), only inside the Halation folder or the workspace.
#[tauri::command]
pub fn delete_paths(app: AppHandle, paths: Vec<String>) -> Result<u32, String> {
    let base = base_dir(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let mut n = 0;
    for p in paths {
        if let Ok(c) = Path::new(&p).canonicalize() {
            if (c.starts_with(&base) || crate::workspace::inside(&app, &c) || crate::save_location::allows(&app, Path::new(&p))) && c.is_file() && fs::remove_file(&c).is_ok() {
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Files in a download folder whose name starts with `stem` (to find what yt-dlp wrote).
#[tauri::command]
pub fn files_with_stem(path_stem: String) -> Vec<String> {
    let p = Path::new(&path_stem);
    let (Some(d), Some(stem)) = (p.parent(), p.file_name().map(|s| s.to_string_lossy().to_string())) else { return vec![] };
    fs::read_dir(d)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|f| f.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&format!("{stem}."))))
                .map(|f| f.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// The files of folder `d` with one of `exts` (lower case, no dot), newest first: [{path, name, size, modified}]
/// (the Library's sections).
pub(crate) fn files_in(d: &Path, exts: &[String]) -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<(u64, serde_json::Value)> = fs::read_dir(d)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let name = p.file_name()?.to_string_lossy().into_owned();
            exts.iter().any(|x| ext_of(&name) == *x).then(|| {
                let m = modified_ms(&meta);
                (m, serde_json::json!({ "path": p.to_string_lossy(), "name": name, "size": meta.len(), "modified": m }))
            })
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.0));
    Ok(out.into_iter().map(|(_, v)| v).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_chunks_are_bounded_and_preserve_every_byte() {
        let path = std::env::temp_dir().join(format!("halation-model-chunks-{}", std::process::id()));
        let bytes: Vec<u8> = (0..((512 << 10) * 2 + 17)).map(|i| (i % 251) as u8).collect();
        fs::write(&path, &bytes).unwrap();
        let mut restored = Vec::new();
        loop {
            let chunk = read_chunk(&path, restored.len() as u64).unwrap();
            assert!(chunk.len() <= 512 << 10);
            if chunk.is_empty() { break; }
            restored.extend(chunk);
        }
        assert_eq!(restored, bytes);
        assert!(read_chunk(&path, u64::MAX).unwrap().is_empty());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn lists_files_by_extension_newest_first() {
        let d = std::env::temp_dir().join(format!("halation-list-{}", std::process::id()));
        fs::create_dir_all(d.join("sub.png")).unwrap();
        fs::write(d.join("old.png"), b"{}").unwrap();
        fs::write(d.join("notes.txt"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(d.join("New.PNG"), b"{ }").unwrap();
        let l = files_in(&d, &["png".into()]).unwrap();
        let names: Vec<&str> = l.iter().map(|v| v["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["New.PNG", "old.png"]);
        assert_eq!(l[0]["size"], 3);
        let _ = fs::remove_dir_all(&d);
    }
}
