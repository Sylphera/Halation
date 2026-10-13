//! The artist profile (name, avatar, banner and latest releases per platform) and the Cover Test's feed of
//! platform content. The profile is the user's: `Settings\Profile` (profile.json + its WebP images). The feed is
//! a cache: `Tools\cache\covertest` (Settings → Storage, "Clear caches"). The pages read and parse the web; this
//! module only keeps the files.

use crate::*;
use serde_json::Value;
use std::{collections::HashSet, fs, path::PathBuf};
use tauri::{ipc::Response, AppHandle};

pub(crate) fn feed_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::tools::tools_dir(app)?.join("cache").join("covertest"))
}

fn area_dir(app: &AppHandle, area: &str) -> Result<PathBuf, String> {
    match area {
        "profile" => dir(app, &["Settings", "Profile"]),
        "references" => dir(app, &["Settings", "Profile", "References"]),
        "feed" => feed_dir(app),
        _ => Err(format!("unknown area: {area}")),
    }
}

/// File names: letters, digits, "-", "_" and one extension of .webp, .json or .jpg.
fn valid_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty() && safe_id(stem) == stem && matches!(ext, "webp" | "json" | "jpg")
}

fn file_in(app: &AppHandle, area: &str, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("invalid file name".into());
    }
    Ok(area_dir(app, area)?.join(name))
}

/// A file of the profile or the feed, or nothing (an empty answer)
#[tauri::command]
pub fn profile_file_get(app: AppHandle, area: String, name: String) -> Result<Response, String> {
    Ok(Response::new(fs::read(file_in(&app, &area, &name)?).unwrap_or_default()))
}

/// Writes a file of the profile or the feed (headers x-area, x-name; body: the bytes)
#[tauri::command]
pub fn profile_file_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let p = file_in(&app, &header(&request, "x-area"), &header(&request, "x-name"))?;
    fs::create_dir_all(p.parent().ok_or("invalid path")?).map_err(|e| e.to_string())?;
    write_atomic(&p, raw_body(&request)?)
}

/// Removes the files of an area (only those starting with `prefix`, when given) that `keep` does not name; returns
/// the bytes those files keep.
#[tauri::command]
pub fn profile_prune(app: AppHandle, area: String, keep: Vec<String>, prefix: Option<String>) -> Result<u64, String> {
    let d = area_dir(&app, &area)?;
    let prefix = prefix.unwrap_or_default();
    let keep: HashSet<String> = keep.into_iter().collect();
    let mut total = 0;
    for e in fs::read_dir(&d).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if !p.is_file() || !name.starts_with(&prefix) {
            continue;
        }
        if keep.contains(&name) {
            total += crate::storage::size_of(&p);
        } else {
            let _ = fs::remove_file(&p);
        }
    }
    Ok(total)
}

/// profile.json, or null before the first profile
#[tauri::command]
pub fn profile_get(app: AppHandle) -> Result<Value, String> {
    Ok(read_json(&area_dir(&app, "profile")?.join("profile.json")).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn profile_set(app: AppHandle, profile: Value) -> Result<(), String> {
    if !profile.is_object() {
        return Err("the profile must be an object".into());
    }
    let p = area_dir(&app, "profile")?.join("profile.json");
    write_atomic(&p, serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_cannot_leave_the_folder() {
        for ok in ["youtube-avatar.webp", "feed-youtube.json", "yt-r-dQw4w9WgXcQ.webp", "a.jpg"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", ".webp", "../x.webp", "a/b.webp", "a.png", "a b.webp", "a.webp.exe", "x"] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(!valid_name(&format!("{}.webp", "x".repeat(57))));
    }
}
