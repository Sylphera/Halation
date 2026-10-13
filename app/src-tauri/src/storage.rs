//! Settings → Storage and Modules: what Halation takes on disk (the app, its downloaded components, caches),
//! the user's own content apart, clearing the caches and removing a downloaded component.
//! Only Halation's own copies (Documents\Halation\Tools) count and can be removed; a tool found elsewhere on
//! the PC (Upscayl installed, FFmpeg on PATH) is reported with its path and left alone.

use crate::{paths::*, tools::*};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

/// Bytes of a file, or of everything inside a folder (links are not followed).
pub(crate) fn size_of(p: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(p) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0)
}

/// Unfinished downloads left in Tools (a .part, or a zip that was never unpacked).
fn leftovers(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            leftovers(&p, out);
        } else if matches!(ext_of(&p.to_string_lossy()).as_str(), "part" | "zip" | "pkg" | "check") {
            out.push(p);
        }
    }
}

/// The folder or file of each component in Halation's own Tools folder.
pub(crate) fn own_path(tools: &Path, id: &str) -> Option<PathBuf> {
    match id {
        "ffmpeg" => Some(tools.join("ffmpeg")),
        "ytdlp" => Some(tools.join(exe("yt-dlp"))),
        "upscayl" => Some(tools.join("upscayl").join("bin")),
        "models" => Some(tools.join("upscayl").join("models")),
        "cutout" => Some(tools.join("cutout")),
        "rife" => Some(tools.join("rife")),
        "span" => Some(tools.join("span")),
        "pandoc" => Some(tools.join("pandoc")),
        "libreoffice" => Some(tools.join("libreoffice")),
        "pdfium" => Some(tools.join("pdfium")),
        "onnxruntime" => Some(tools.join("stems").join("runtime")),
        "stems-hq4" | "stems-htdemucs" => crate::stems::ASSETS.iter().find(|a| a.comp == id).map(|a| crate::stems::place(&tools.join("stems"), a)),
        _ => None,
    }
}

/// Where each component is found: its path, whether it is Halation's own copy, and the bytes of that copy.
fn components(app: &AppHandle, tools: &Path) -> Vec<Value> {
    let up = find_upscaler(app);
    let own_bin = tools.join("upscayl").join("bin").join(exe("upscayl-bin"));
    let own_models = tools.join("upscayl").join("models");
    let cutout = crate::cutout::find_cutout(app).and_then(|v| v["dir"].as_str().map(PathBuf::from));
    let rife = crate::interp::find_rife(app).map(|r| r.bin.parent().map(Path::to_path_buf).unwrap_or(r.bin));
    let span = find_span(app).map(|s| s.bin.parent().map(Path::to_path_buf).unwrap_or(s.bin));
    let span = if tools.join("span").is_dir() { Some(tools.join("span")) } else { span };
    let [(_, ort), (_, hq4), (_, htd)] = crate::stems::status(app);
    let found: [(&str, Option<PathBuf>); 13] = [
        ("ffmpeg", find_ffmpeg(app)),
        ("ytdlp", find_ytdlp(app)),
        ("upscayl", if own_bin.is_file() { Some(own_bin) } else { up.as_ref().map(|u| u.bin.clone()) }),
        ("models", if !models_in(&own_models).is_empty() { Some(own_models) } else { up.as_ref().map(|u| u.models.clone()) }),
        ("cutout", cutout),
        ("rife", rife),
        ("span", span),
        ("pandoc", find_pandoc(app)),
        ("libreoffice", find_soffice(app)),
        ("pdfium", find_pdfium(app)),
        ("onnxruntime", ort.map(PathBuf::from)),
        ("stems-hq4", hq4.map(PathBuf::from)),
        ("stems-htdemucs", htd.map(PathBuf::from)),
    ];
    found
        .into_iter()
        .map(|(id, p)| {
            let own = p.as_ref().is_some_and(|p| p.starts_with(tools));
            let size = if own { own_path(tools, id).map(|d| size_of(&d)).unwrap_or(0) } else { 0 };
            let extra = if id == "models" { p.as_ref().map(|d| models_in(d).len()).unwrap_or(0) } else { 0 };
            let ready = id != "span" || p.as_ref().is_some_and(|d| d.join(exe("span-ncnn-vulkan")).is_file()
                && SPAN_MODELS.iter().all(|m| models_in(&d.join("models")).iter().any(|a| a.as_str() == *m)));
            json!({ "id": id, "path": p.map(|p| p.to_string_lossy().into_owned()), "own": own, "size": size, "models": extra, "ready": ready })
        })
        .collect()
}

/// The installed program: the folder of an installed copy, or only the executable of the portable one.
fn app_size() -> (String, u64) {
    let Ok(exe_path) = std::env::current_exe() else { return (String::new(), 0) };
    let dir = exe_path.parent().map(Path::to_path_buf).unwrap_or_default();
    let installed = dir.join(exe("uninstall")).is_file();
    let size = if installed { size_of(&dir) } else { size_of(&exe_path) };
    (if installed { dir } else { exe_path }.to_string_lossy().into_owned(), size)
}

/// {app, components, caches, user}; every entry has a path and a size in bytes.
/// The total the page shows is app + own components + caches; the user's content is listed apart.
#[tauri::command]
pub fn storage_report(app: AppHandle) -> Result<Value, String> {
    let tools = tools_dir(&app)?;
    let (app_path, app_bytes) = app_size();
    let mut parts = vec![];
    leftovers(&tools, &mut parts);
    let entry = |id: &str, p: PathBuf| json!({ "id": id, "path": p.to_string_lossy(), "size": size_of(&p) });
    // the workspace (workspace.rs): the jobs' work folders and each area of the common cache
    let ws = crate::workspace::root(&app)?;
    let mut caches = vec![entry("temp", ws.join("temp"))];
    for (area, _) in crate::workspace::AREAS {
        caches.push(entry(area, ws.join("cache").join(area)));
    }
    caches.extend([
        json!({ "id": "partial", "path": tools.to_string_lossy(), "size": parts.iter().map(|p| size_of(p)).sum::<u64>() }),
        entry("recent", dir(&app, &["Settings", "Recent"])?),
        entry("covertest", crate::profile::feed_dir(&app)?),
    ]);
    let user = [("presets", "Presets"), ("projects", "Projects"), ("library", "Library"), ("exports", "Exports"), ("downloads", "Downloads"), ("resources", "Resources")]
        .iter()
        .map(|(id, d)| Ok(entry(id, dir(&app, &[d])?)))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({
        "app": { "path": app_path, "size": app_bytes },
        "components": components(&app, &tools),
        "caches": caches,
        "user": user,
    }))
}

/// "Clean now": the unfinished downloads, the copies behind Home's recent files, the Cover Test's feed, and in the
/// workspace every work folder no live job holds (`live`: their ids) and every cache entry no open tool uses.
/// Returns the bytes freed.
#[tauri::command]
pub fn cache_clear(app: AppHandle, ws: tauri::State<'_, crate::workspace::Workspace>, live: Option<Vec<String>>) -> Result<u64, String> {
    let tools = tools_dir(&app)?;
    let mut gone: Vec<PathBuf> = vec![];
    leftovers(&tools, &mut gone);
    let workspace = crate::workspace::clean(&app, &ws, live.unwrap_or_default())?;
    for d in [dir(&app, &["Settings", "Recent"])?, crate::profile::feed_dir(&app)?] {
        if let Ok(rd) = fs::read_dir(&d) {
            gone.extend(rd.flatten().map(|e| e.path()));
        }
    }
    let mut freed = workspace;
    for p in gone {
        let n = size_of(&p);
        let ok = if p.is_dir() { fs::remove_dir_all(&p).is_ok() } else { fs::remove_file(&p).is_ok() };
        if ok {
            freed += n;
        }
    }
    Ok(freed)
}

/// Removes Halation's own copy of a component ("ffmpeg", "ytdlp", "upscayl", "models", "cutout", "rife", "span",
/// "pandoc", "libreoffice", "pdfium", "onnxruntime", "stems-hq4", "stems-htdemucs"). Returns the new status.
#[tauri::command]
pub fn tool_uninstall(app: AppHandle, tool: String) -> Result<Value, String> {
    let tools = tools_dir(&app)?;
    let p = own_path(&tools, &tool).ok_or_else(|| format!("unknown tool {tool}"))?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else if p.is_file() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_add_up_and_leftovers_are_found() {
        let d = std::env::temp_dir().join(format!("halation-size-{}", std::process::id()));
        fs::create_dir_all(d.join("a").join("b")).unwrap();
        fs::write(d.join("x.bin"), vec![0u8; 1000]).unwrap();
        fs::write(d.join("a").join("y.part"), vec![0u8; 300]).unwrap();
        fs::write(d.join("a").join("b").join("z.zip"), vec![0u8; 20]).unwrap();
        assert_eq!(size_of(&d), 1320);
        assert_eq!(size_of(&d.join("x.bin")), 1000);
        assert_eq!(size_of(&d.join("missing")), 0);
        let mut found = vec![];
        leftovers(&d, &mut found);
        found.sort();
        assert_eq!(found, vec![d.join("a").join("b").join("z.zip"), d.join("a").join("y.part")]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn own_copies_live_in_tools() {
        let t = Path::new("T");
        assert_eq!(own_path(t, "ffmpeg").unwrap(), t.join("ffmpeg"));
        assert_eq!(own_path(t, "models").unwrap(), t.join("upscayl").join("models"));
        assert_eq!(own_path(t, "cutout").unwrap(), t.join("cutout"));
        assert!(own_path(t, "other").is_none());
    }
}
