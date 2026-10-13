//! External tools: upscayl-bin (Upscale), yt-dlp and FFmpeg (Downloader), Pandoc, LibreOffice and PDFium (Converter's
//! documents); rife-ncnn-vulkan is in interp.rs.
//! None of them ships with the installer. Halation uses an existing Upscayl install when there is one,
//! otherwise it downloads the tools to Documents\Halation\Tools the first time they are needed.
//! Processes run without a console window; their output goes to the page line by line (event "proc"),
//! where the progress and error messages are read.

use crate::{download::*, paths::*};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

/// Upscayl models offered in the interface, all 4× Real-ESRGAN models shipped with Upscayl.
pub const UPSCALE_MODELS: [&str; 4] = ["upscayl-standard-4x", "digital-art-4x", "ultrasharp-4x", "upscayl-lite-4x"];
pub(crate) const SPAN_MODELS: [&str; 2] = ["spanx2_ch52", "spanx4_ch52"];
const SPAN_RELEASE: &str = "https://api.github.com/repos/tntwise/span-ncnn-vulkan/releases/latest";
pub(crate) const MODELS_URL: &str = "https://raw.githubusercontent.com/upscayl/upscayl/main/resources/models/";
pub(crate) const UPSCAYL_RELEASE: &str = "https://api.github.com/repos/upscayl/upscayl-ncnn/releases/latest";
#[cfg(windows)]
pub(crate) const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
#[cfg(not(windows))]
pub(crate) const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
#[cfg(windows)]
pub(crate) const FFMPEG_URL: &str = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
pub(crate) const PANDOC_RELEASE: &str = "https://api.github.com/repos/jgm/pandoc/releases/latest";
/// The chromium build pdfium-render's bindings are made for (Cargo.toml feature pdfium_7881)
#[cfg(windows)]
pub(crate) const PDFIUM_URL: &str = "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7881/pdfium-win-x64.tgz";
#[cfg(target_os = "macos")]
pub(crate) const PDFIUM_URL: &str = "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7881/pdfium-mac-univ.tgz";
#[cfg(all(not(windows), not(target_os = "macos")))]
pub(crate) const PDFIUM_URL: &str = "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7881/pdfium-linux-x64.tgz";
/// The folders of LibreOffice's stable versions ("26.8.1/"); the newest one the mirrors already have is taken
#[cfg(windows)]
pub(crate) const LIBREOFFICE_STABLE: &str = "https://download.documentfoundation.org/libreoffice/stable/";
#[cfg(windows)]
pub(crate) const PLATFORM: &str = "windows";
#[cfg(target_os = "macos")]
pub(crate) const PLATFORM: &str = "macos";
#[cfg(all(not(windows), not(target_os = "macos")))]
pub(crate) const PLATFORM: &str = "linux";
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub(crate) fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    dir(app, &["Tools"])
}

pub(crate) fn on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).map(|d| d.join(exe(name))).find(|p| p.is_file())
}

/* ---------- finding the tools ---------- */

pub struct Upscaler {
    pub bin: PathBuf,
    pub models: PathBuf,
    pub source: &'static str,
}

/// Model names that have both files (.param and .bin) in a folder
pub(crate) fn models_in(dir: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<String> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            (p.extension()? == "param" && p.with_extension("bin").is_file()).then(|| p.file_stem()?.to_str().map(String::from))?
        })
        .collect();
    out.sort();
    out
}

/// Upscayl installed by the user first (per-user and per-machine installs), then Halation's own copy.
pub fn find_upscaler(app: &AppHandle) -> Option<Upscaler> {
    let mut candidates: Vec<(PathBuf, PathBuf, &'static str)> = vec![];
    if let Some(d) = std::env::var_os("HALATION_UPSCAYL") {
        let d = PathBuf::from(d);
        candidates.push((d.join("bin"), d.join("models"), "custom"));
    }
    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramW6432"] {
        if let Some(root) = std::env::var_os(var) {
            let root = PathBuf::from(root);
            let app_dir = if var == "LOCALAPPDATA" { root.join("Programs").join("Upscayl") } else { root.join("Upscayl") };
            candidates.push((app_dir.join("resources").join("bin"), app_dir.join("resources").join("models"), "installed"));
        }
    }
    if let Ok(t) = tools_dir(app) {
        candidates.push((t.join("upscayl").join("bin"), t.join("upscayl").join("models"), "downloaded"));
    }
    candidates.into_iter().find_map(|(bin_dir, models, source)| {
        let bin = bin_dir.join(exe("upscayl-bin"));
        (bin.is_file() && !models_in(&models).is_empty()).then_some(Upscaler { bin, models, source })
    })
}

pub(crate) fn find_ytdlp(app: &AppHandle) -> Option<PathBuf> {
    let own = tools_dir(app).ok()?.join(exe("yt-dlp"));
    if own.is_file() {
        return Some(own);
    }
    on_path("yt-dlp")
}

pub fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    let own = tools_dir(app).ok()?.join("ffmpeg").join(exe("ffmpeg"));
    if own.is_file() {
        return Some(own);
    }
    on_path("ffmpeg")
}

/// Pandoc: Halation's copy, then one on PATH
pub(crate) fn find_pandoc(app: &AppHandle) -> Option<PathBuf> {
    let own = tools_dir(app).ok()?.join("pandoc").join(exe("pandoc"));
    if own.is_file() {
        return Some(own);
    }
    on_path("pandoc")
}

/// LibreOffice's soffice: Halation's copy (an administrative install in Tools\libreoffice), the user's install, PATH.
/// On Windows soffice.com, the console launcher that waits for the conversion and passes its output on.
pub(crate) fn find_soffice(app: &AppHandle) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) { vec!["soffice.com".into(), "soffice.exe".into()] } else { vec!["soffice".into()] };
    let in_program = |d: &Path| names.iter().map(|n| d.join(n)).find(|p| p.is_file());
    if let Ok(t) = tools_dir(app) {
        let own = t.join("libreoffice");
        // the MSI's administrative install puts it a level or two down (…\LibreOffice\program)
        let mut stack = vec![(own, 0)];
        while let Some((d, depth)) = stack.pop() {
            if d.file_name().is_some_and(|n| n == "program") {
                if let Some(p) = in_program(&d) {
                    return Some(p);
                }
            }
            if depth < 4 {
                if let Ok(rd) = fs::read_dir(&d) {
                    stack.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).map(|p| (p, depth + 1)));
                }
            }
        }
    }
    for var in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(var) {
            if let Some(p) = in_program(&PathBuf::from(root).join("LibreOffice").join("program")) {
                return Some(p);
            }
        }
    }
    on_path("soffice").or_else(|| on_path("libreoffice"))
}

/// PDFium's library: Halation's copy (Tools\pdfium), or one named by HALATION_PDFIUM
pub(crate) fn find_pdfium(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "pdfium.dll" } else if cfg!(target_os = "macos") { "libpdfium.dylib" } else { "libpdfium.so" };
    let own = tools_dir(app).ok()?.join("pdfium").join(name);
    if own.is_file() {
        return Some(own);
    }
    std::env::var_os("HALATION_PDFIUM").map(PathBuf::from).filter(|p| p.is_file())
}

/// SPAN ch52 uses its own ncnn/Vulkan executable; Image keeps Upscayl unchanged.
pub(crate) fn find_span(app: &AppHandle) -> Option<Upscaler> {
    let mut candidates = vec![];
    if let Some(d) = std::env::var_os("HALATION_SPAN") {
        candidates.push((PathBuf::from(d), "custom"));
    }
    if let Ok(d) = tools_dir(app) {
        candidates.push((d.join("span"), "downloaded"));
    }
    candidates.into_iter().find_map(|(d, source)| {
        let bin = d.join(exe("span-ncnn-vulkan"));
        let models = d.join("models");
        let available = models_in(&models);
        (bin.is_file() && SPAN_MODELS.iter().all(|m| available.iter().any(|a| a.as_str() == *m)))
            .then_some(Upscaler { bin, models, source })
    })
}

pub(crate) fn find_ffprobe(app: &AppHandle) -> Option<PathBuf> {
    let beside = find_ffmpeg(app)?.parent()?.join(exe("ffprobe"));
    if beside.is_file() { Some(beside) } else { on_path("ffprobe") }
}

pub(crate) fn status(app: &AppHandle) -> Result<Value, String> {
    let s = |p: Option<PathBuf>| p.map(|p| p.to_string_lossy().into_owned());
    let up = find_upscaler(app).map(|u| {
        json!({ "bin": u.bin.to_string_lossy(), "models": u.models.to_string_lossy(), "available": models_in(&u.models), "source": u.source })
    });
    let stems = crate::stems::status(app);
    let mut v = json!({
        "dir": tools_dir(app)?.to_string_lossy(),
        "upscaler": up,
        "span": find_span(app).map(|u| json!({ "bin": u.bin.to_string_lossy(), "models": u.models.to_string_lossy(), "available": models_in(&u.models), "source": u.source })),
        "ffprobe": s(find_ffprobe(app)),
        "wanted": UPSCALE_MODELS,
        "ytdlp": s(find_ytdlp(app)),
        "ffmpeg": s(find_ffmpeg(app)),
        "cutout": crate::cutout::find_cutout(app),
        "rife": crate::interp::status(app),
        "pandoc": s(find_pandoc(app)),
        "libreoffice": s(find_soffice(app)),
        "pdfium": s(find_pdfium(app)),
    });
    for (id, p) in stems {
        v[id] = json!(p);
    }
    Ok(v)
}

#[tauri::command]
pub fn tools_status(app: AppHandle) -> Result<Value, String> {
    status(&app)
}

/* ---------- installing them (downloads in download.rs) ---------- */

/// Upscale needs both: the engine and the models.
pub(crate) fn install_upscaler(app: &AppHandle) -> Result<(), String> {
    install_upscayl(app)?;
    install_models(app)
}

/// upscayl-bin from the latest upscayl-ncnn release.
pub(crate) fn install_upscayl(app: &AppHandle) -> Result<(), String> {
    let root = tools_dir(app)?.join("upscayl");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if bin_dir.join(exe("upscayl-bin")).is_file() {
        return Ok(());
    }
    let release: Value = agent().get(UPSCAYL_RELEASE).call().map_err(|e| e.to_string())?.into_body().read_json().map_err(|e| e.to_string())?;
    let asset = release["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|x| {
                let n = x["name"].as_str().unwrap_or("").to_ascii_lowercase();
                n.contains(PLATFORM) && n.ends_with(".zip")
            })
        })
        .and_then(|x| x["browser_download_url"].as_str())
        .ok_or("no upscayl-bin download for this system")?
        .to_string();
    let zip_path = root.join("upscayl-bin.zip");
    fetch_to(app, "upscaler", &asset, &zip_path)?;
    let found = unzip_beside(&zip_path, &[&exe("upscayl-bin")], &bin_dir);
    let _ = fs::remove_file(&zip_path);
    found.map(|_| ())
}

/// The four models offered in the interface, the ones not there yet.
pub(crate) fn install_models(app: &AppHandle) -> Result<(), String> {
    let models = tools_dir(app)?.join("upscayl").join("models");
    fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    for m in UPSCALE_MODELS {
        for ext in ["param", "bin"] {
            let dest = models.join(format!("{m}.{ext}"));
            if !dest.is_file() {
                crate::workspace::fetch_model(app, "upscaler", &format!("{MODELS_URL}{m}.{ext}"), &dest)?;
            }
        }
    }
    Ok(())
}

/// One component: the Vulkan runner, its runtime libraries and both ch52 scales.
pub(crate) fn install_span(app: &AppHandle) -> Result<(), String> {
    let root = tools_dir(app)?.join("span");
    if root.join(exe("span-ncnn-vulkan")).is_file() && SPAN_MODELS.iter().all(|m| models_in(&root.join("models")).iter().any(|a| a.as_str() == *m)) {
        return Ok(());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let release: Value = agent().get(SPAN_RELEASE).call().map_err(|e| e.to_string())?.into_body().read_json().map_err(|e| e.to_string())?;
    let platform = if PLATFORM == "linux" { "ubuntu" } else { PLATFORM };
    let url = release["assets"].as_array().and_then(|a| a.iter().find(|x| {
        let n = x["name"].as_str().unwrap_or("").to_ascii_lowercase();
        n.contains(platform) && n.ends_with(".zip")
    })).and_then(|x| x["browser_download_url"].as_str()).ok_or("no SPAN download for this system")?;
    let archive = root.join("span.zip");
    fetch_to(app, "span", url, &archive)?;
    let result = unzip_span(&archive, &root);
    let _ = fs::remove_file(&archive);
    result
}

pub(crate) fn unzip_span(archive: &Path, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let names: Vec<String> = zip.file_names().map(String::from).collect();
    let main = exe("span-ncnn-vulkan");
    let runner = names.iter().find(|n| n.rsplit('/').next() == Some(main.as_str())).ok_or("SPAN runner is not in the download")?;
    let prefix = runner.rsplit_once('/').map(|(p, _)| format!("{p}/")).unwrap_or_default();
    for name in names.iter().filter(|n| n.starts_with(&prefix) && !n.ends_with('/')) {
        let rel = &name[prefix.len()..];
        let root_file = !rel.contains('/') && !rel.contains('\\') && rel != "." && rel != "..";
        let model_file = SPAN_MODELS.iter().any(|m| ["param", "bin"].iter().any(|e| rel == format!("models/{m}.{e}")));
        if !root_file && !model_file { continue; }
        let target = dest.join(rel);
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
        let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        if root_file { make_executable(&target); }
    }
    if !dest.join(main).is_file() || !SPAN_MODELS.iter().all(|m| models_in(&dest.join("models")).iter().any(|a| a.as_str() == *m)) {
        return Err("SPAN download must include both ch52 models".into());
    }
    Ok(())
}

pub(crate) fn install_ytdlp(app: &AppHandle) -> Result<(), String> {
    let dest = tools_dir(app)?.join(exe("yt-dlp"));
    fetch_to(app, "ytdlp", YTDLP_URL, &dest)?;
    make_executable(&dest);
    Ok(())
}

#[cfg(windows)]
pub(crate) fn install_ffmpeg(app: &AppHandle) -> Result<(), String> {
    let root = tools_dir(app)?.join("ffmpeg");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let zip_path = root.join("ffmpeg.zip");
    fetch_to(app, "ffmpeg", FFMPEG_URL, &zip_path)?;
    let found = unzip_beside(&zip_path, &["ffmpeg.exe", "ffprobe.exe"], &root);
    let _ = fs::remove_file(&zip_path);
    found.map(|_| ())
}
#[cfg(not(windows))]
pub(crate) fn install_ffmpeg(_: &AppHandle) -> Result<(), String> {
    Err("install FFmpeg with your package manager".into())
}

/// Pandoc from its latest release: the zip (Windows, macOS) or tarball (Linux) of this system, pandoc alone
pub(crate) fn install_pandoc(app: &AppHandle) -> Result<(), String> {
    let root = tools_dir(app)?.join("pandoc");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let release: Value = agent().get(PANDOC_RELEASE).call().map_err(|e| e.to_string())?.into_body().read_json().map_err(|e| e.to_string())?;
    let suffix = if cfg!(windows) { "windows-x86_64.zip" } else if cfg!(target_os = "macos") { "macOS.zip" } else { "linux-amd64.tar.gz" };
    let url = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str().unwrap_or("").ends_with(suffix)))
        .and_then(|x| x["browser_download_url"].as_str())
        .ok_or("no Pandoc download for this system")?
        .to_string();
    let archive = root.join(if suffix.ends_with(".zip") { "pandoc.zip" } else { "pandoc.tgz" });
    fetch_to(app, "pandoc", &url, &archive)?;
    let found = if suffix.ends_with(".zip") {
        unzip_beside(&archive, &[&exe("pandoc")], &root).map(|_| ())
    } else {
        untar_one(&archive, "/bin/pandoc", &root.join("pandoc"))
    };
    let _ = fs::remove_file(&archive);
    found?;
    make_executable(&root.join(exe("pandoc")));
    Ok(())
}

/// PDFium's library from pdfium-binaries (the build pdfium-render expects)
pub(crate) fn install_pdfium(app: &AppHandle) -> Result<(), String> {
    let root = tools_dir(app)?.join("pdfium");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let archive = root.join("pdfium.tgz");
    fetch_to(app, "pdfium", PDFIUM_URL, &archive)?;
    let (inside, name) = if cfg!(windows) { ("bin/pdfium.dll", "pdfium.dll") } else if cfg!(target_os = "macos") { ("lib/libpdfium.dylib", "libpdfium.dylib") } else { ("lib/libpdfium.so", "libpdfium.so") };
    let found = untar_one(&archive, inside, &root.join(name));
    let _ = fs::remove_file(&archive);
    found
}

/// LibreOffice without installing it: the official MSI unpacked by an administrative install (msiexec /a, no
/// administrator rights) into Tools\libreoffice. The newest stable version the mirrors have.
#[cfg(windows)]
pub(crate) fn install_libreoffice(app: &AppHandle) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let root = tools_dir(app)?.join("libreoffice");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let listing = agent().get(LIBREOFFICE_STABLE).call().map_err(|e| e.to_string())?.into_body().read_to_string().map_err(|e| e.to_string())?;
    let mut versions: Vec<Vec<u32>> = listing
        .split("href=\"")
        .skip(1)
        .filter_map(|h| h.split('/').next())
        .filter_map(|v| v.split('.').map(|n| n.parse().ok()).collect::<Option<Vec<u32>>>())
        .filter(|v| v.len() >= 3)
        .collect();
    versions.sort();
    versions.dedup();
    let msi = root.join("libreoffice.msi");
    let mut last = String::from("no LibreOffice version found");
    let mut got = false;
    // a version just out is not on every mirror yet (404): the one before it then
    for v in versions.iter().rev().take(3) {
        let v = v.iter().map(u32::to_string).collect::<Vec<_>>().join(".");
        let url = format!("{LIBREOFFICE_STABLE}{v}/win/x86_64/LibreOffice_{v}_Win_x86-64.msi");
        match fetch_to(app, "libreoffice", &url, &msi) {
            Ok(()) => {
                got = true;
                break;
            }
            Err(e) => last = e,
        }
    }
    if !got {
        return Err(last);
    }
    // msiexec reads PROPERTY="value" itself: the quotes go as they are
    let status = std::process::Command::new("msiexec")
        .arg("/a")
        .arg(&msi)
        .arg("/qn")
        .raw_arg(format!("TARGETDIR=\"{}\"", root.join("app").display()))
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&msi);
    if !status.success() {
        return Err(format!("msiexec ended with {}", status.code().unwrap_or(-1)));
    }
    // the administrative image also keeps a copy of the MSI
    if let Ok(rd) = fs::read_dir(root.join("app")) {
        for e in rd.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "msi")) {
            let _ = fs::remove_file(e.path());
        }
    }
    find_soffice(app).filter(|p| p.starts_with(&root)).map(|_| ()).ok_or_else(|| "LibreOffice was unpacked without soffice".into())
}
#[cfg(not(windows))]
pub(crate) fn install_libreoffice(_: &AppHandle) -> Result<(), String> {
    Err("install LibreOffice with your package manager".into())
}

/// tool: "upscaler" (engine and models) | "upscayl" | "models" | "ytdlp" | "ffmpeg" | "cutout" | "rife" | "span" | "pandoc" | "libreoffice" | "pdfium". Returns the new
/// status.
/// tool: "upscaler" (engine and models) | "upscayl" | "models" | "ytdlp" | "ffmpeg" | "cutout" | "rife" | "span" |
/// "onnxruntime" | "stems-hq4" | "stems-htdemucs". Returns the new status.
#[tauri::command]
pub async fn tool_install(app: AppHandle, tool: String) -> Result<Value, String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || match tool.as_str() {
        "upscaler" => install_upscaler(&a),
        "upscayl" => install_upscayl(&a),
        "models" => install_models(&a),
        "ytdlp" => install_ytdlp(&a),
        "ffmpeg" => install_ffmpeg(&a),
        "cutout" => crate::cutout::install_cutout(&a),
        "rife" => crate::interp::install_rife(&a),
        "span" => install_span(&a),
        "pandoc" => install_pandoc(&a),
        "libreoffice" => install_libreoffice(&a),
        "pdfium" => install_pdfium(&a),
        "onnxruntime" | "stems-hq4" | "stems-htdemucs" => crate::stems::install(&a, &tool),
        _ => Err(format!("unknown tool {tool}")),
    })
    .await
    .map_err(|e| e.to_string())??;
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_need_both_files() {
        let d = std::env::temp_dir().join(format!("halation-models-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        for f in ["a.param", "a.bin", "b.param", "c.bin"] {
            fs::write(d.join(f), b"x").unwrap();
        }
        assert_eq!(models_in(&d), vec!["a".to_string()]);
        let _ = fs::remove_dir_all(&d);
    }
}
