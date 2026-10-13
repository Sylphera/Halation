//! Frame rate ×AI (the interp tool): rife-ncnn-vulkan, a downloaded component in Tools\rife (the program, its
//! libraries and the rife-v4.6 model, the one that makes any number of frames), and the work folder of a job,
//! Tools\temp\interp-<n> with the frames FFmpeg took out of the video (in) and the ones RIFE made (out).
//! The page runs both programs through procs.rs and counts the frames made for its progress.

use crate::{download::*, paths::*, tools::*};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

/// The model used: RIFE 4.6 takes any time step, so ×2, ×4 and a target frame rate all work with it.
pub const RIFE_MODEL: &str = "rife-v4.6";
pub(crate) const RIFE_RELEASE: &str = "https://api.github.com/repos/nihui/rife-ncnn-vulkan/releases/latest";

/* ---------- finding and installing RIFE ---------- */

pub struct Rife {
    pub bin: PathBuf,
    pub model: PathBuf,
    pub source: &'static str,
}

pub(crate) fn rife_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("rife"))
}

fn model_ok(d: &Path) -> bool {
    d.join("flownet.param").is_file() && d.join("flownet.bin").is_file()
}

/// A folder with the program and the model: HALATION_RIFE first (a build of the user's own), then Halation's copy.
pub fn find_rife(app: &AppHandle) -> Option<Rife> {
    let mut candidates: Vec<(PathBuf, &'static str)> = vec![];
    if let Some(d) = std::env::var_os("HALATION_RIFE") {
        candidates.push((PathBuf::from(d), "custom"));
    }
    if let Ok(d) = rife_dir(app) {
        candidates.push((d, "downloaded"));
    }
    candidates.into_iter().find_map(|(d, source)| {
        let bin = d.join(exe("rife-ncnn-vulkan"));
        let model = d.join(RIFE_MODEL);
        (bin.is_file() && model_ok(&model)).then_some(Rife { bin, model, source })
    })
}

pub(crate) fn status(app: &AppHandle) -> Option<Value> {
    find_rife(app).map(|r| serde_json::json!({ "bin": r.bin.to_string_lossy(), "model": r.model.to_string_lossy(), "source": r.source }))
}

/// The release's names say "ubuntu" where Halation says "linux".
fn release_platform() -> &'static str {
    if PLATFORM == "linux" {
        "ubuntu"
    } else {
        PLATFORM
    }
}

/// rife-ncnn-vulkan from the latest release: the program with the files beside it, and the one model used.
pub(crate) fn install_rife(app: &AppHandle) -> Result<(), String> {
    let root = rife_dir(app)?;
    if root.join(exe("rife-ncnn-vulkan")).is_file() && model_ok(&root.join(RIFE_MODEL)) {
        return Ok(());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let release: Value = agent().get(RIFE_RELEASE).call().map_err(|e| e.to_string())?.into_body().read_json().map_err(|e| e.to_string())?;
    let asset = release["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|x| {
                let n = x["name"].as_str().unwrap_or("").to_ascii_lowercase();
                n.contains(release_platform()) && n.ends_with(".zip")
            })
        })
        .and_then(|x| x["browser_download_url"].as_str())
        .ok_or("no rife-ncnn-vulkan download for this system")?
        .to_string();
    let zip_path = root.join("rife-ncnn-vulkan.zip");
    fetch_to(app, "rife", &asset, &zip_path)?;
    let found = unzip_rife(&zip_path, &root);
    let _ = fs::remove_file(&zip_path);
    found
}

/// From the release's zip: the files in the program's folder, and the model's folder (the other models stay out).
pub(crate) fn unzip_rife(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let names: Vec<String> = zip.file_names().map(String::from).collect();
    let main_name = exe("rife-ncnn-vulkan");
    let main = names
        .iter()
        .find(|n| n.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case(&main_name)))
        .ok_or_else(|| format!("{main_name} is not in the download"))?;
    let folder = main.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
    let model = format!("{RIFE_MODEL}/");
    for name in names.iter().filter(|n| n.starts_with(&folder) && !n.ends_with('/')) {
        let rel = &name[folder.len()..];
        let keep = !rel.contains('/') || rel.strip_prefix(&model).is_some_and(|f| !f.contains('/'));
        if !keep {
            continue;
        }
        let target = dest.join(rel);
        if let Some(p) = target.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
        let mut bytes = vec![];
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
        if !rel.contains('/') {
            make_executable(&target);
        }
    }
    if !model_ok(&dest.join(RIFE_MODEL)) {
        return Err(format!("{RIFE_MODEL} is not in the download"));
    }
    Ok(())
}

/* ---------- a job's work folder ---------- */

fn temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::workspace::temp_root(app)
}

/// A work folder of the tool inside the workspace's temp: a job's lease (j_<n>) or interp-<n>; an error for any other path.
pub(crate) fn work_folder(temp: &Path, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if p.parent() != Some(temp) || !(name.starts_with("interp-") || name.starts_with("j_")) || !crate::workspace::valid_key(name) {
        return Err("not a work folder of Frame rate".into());
    }
    Ok(p)
}

/// A new work folder with its two subfolders, "in" and "out": the job's own (its lease) or a new one. Returns its path.
#[tauri::command]
pub fn interp_workdir(app: AppHandle, job: Option<String>) -> Result<String, String> {
    let temp = temp_dir(&app)?;
    if let Some(job) = job.filter(|j| j.starts_with("j_") && crate::workspace::valid_key(j)) {
        let d = temp.join(job);
        for sub in ["in", "out"] {
            fs::create_dir_all(d.join(sub)).map_err(|e| e.to_string())?;
        }
        return Ok(d.to_string_lossy().into_owned());
    }
    let mut n = now_ms();
    let d = loop {
        let d = temp.join(format!("interp-{n}"));
        if !d.exists() {
            break d;
        }
        n += 1;
    };
    for sub in ["in", "out"] {
        fs::create_dir_all(d.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(d.to_string_lossy().into_owned())
}

/// Frames (.png) in a subfolder ("in" or "out") of a work folder: the progress of a job.
#[tauri::command]
pub fn interp_count(app: AppHandle, dir: String, sub: String) -> Result<usize, String> {
    if sub != "in" && sub != "out" {
        return Err(format!("unknown folder {sub}"));
    }
    let d = work_folder(&temp_dir(&app)?, &dir)?.join(sub);
    Ok(fs::read_dir(d).map(|rd| rd.flatten().filter(|e| ext_of(&e.file_name().to_string_lossy()) == "png").count()).unwrap_or(0))
}

/// Deletes a work folder and everything in it.
#[tauri::command]
pub fn interp_clean(app: AppHandle, dir: String) -> Result<(), String> {
    let d = work_folder(&temp_dir(&app)?, &dir)?;
    if d.is_dir() {
        fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn unzip_keeps_the_program_and_one_model() {
        let d = std::env::temp_dir().join(format!("halation-rife-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let zp = d.join("r.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            let main = format!("pkg/{}", exe("rife-ncnn-vulkan"));
            for (n, c) in [
                (main.as_str(), "1"),
                ("pkg/vcomp140.dll", "2"),
                ("pkg/rife-v4.6/flownet.param", "3"),
                ("pkg/rife-v4.6/flownet.bin", "4"),
                ("pkg/rife-anime/flownet.bin", "5"),
                ("pkg/rife-v4.6/extra/x", "6"),
            ] {
                z.start_file(n, o).unwrap();
                z.write_all(c.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        let out = d.join("out");
        unzip_rife(&zp, &out).unwrap();
        assert!(out.join(exe("rife-ncnn-vulkan")).is_file());
        assert!(out.join("vcomp140.dll").is_file());
        assert!(model_ok(&out.join(RIFE_MODEL)));
        assert!(!out.join("rife-anime").exists());
        assert!(!out.join(RIFE_MODEL).join("extra").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn only_work_folders_in_temp() {
        let temp = std::env::temp_dir().join("halation-temp");
        let ok = temp.join("interp-12");
        assert_eq!(work_folder(&temp, &ok.to_string_lossy()).unwrap(), ok);
        assert!(work_folder(&temp, &temp.join("other").to_string_lossy()).is_err());
        assert!(work_folder(&temp, &temp.join("interp-1").join("in").to_string_lossy()).is_err());
        assert!(work_folder(&temp, &temp.parent().unwrap().join("interp-1").to_string_lossy()).is_err());
    }
}
