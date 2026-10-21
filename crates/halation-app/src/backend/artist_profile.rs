//! The artist profile (name, avatar, banner, latest releases per platform) and the feed cache of platform content
//! (imported from the Tauri backend's `profile.rs`). The profile is the user's data (`profile.json` and its images);
//! the feed is a cache that can be cleared. This module only keeps the files; reading or parsing the web is not its
//! job. The caller gives the three folders; file names are restricted so nothing can leave them.

use super::names::safe_id;
use crate::atomic_file::write_atomic;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Area {
    Profile,
    References,
    Feed,
}

pub struct ArtistFiles {
    profile: PathBuf,
    references: PathBuf,
    feed: PathBuf,
}

/// File names: letters, digits, "-", "_" and one extension of .webp, .json or .jpg
pub fn valid_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty() && safe_id(stem) == stem && matches!(ext, "webp" | "json" | "jpg")
}

/// Bytes of a file, or of everything inside a folder (links are not followed)
pub fn size_of(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(path)
        .map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum())
        .unwrap_or(0)
}

impl ArtistFiles {
    /// `profile` holds `profile.json`; `references` is normally below it; `feed` is the clearable cache
    pub fn new(profile: PathBuf, references: PathBuf, feed: PathBuf) -> Self {
        Self {
            profile,
            references,
            feed,
        }
    }

    fn dir(&self, area: Area) -> &Path {
        match area {
            Area::Profile => &self.profile,
            Area::References => &self.references,
            Area::Feed => &self.feed,
        }
    }

    fn file(&self, area: Area, name: &str) -> Result<PathBuf, String> {
        if !valid_name(name) {
            return Err("invalid file name".to_owned());
        }
        Ok(self.dir(area).join(name))
    }

    /// A file of the profile or the feed, or nothing (empty) when it does not exist
    pub fn get(&self, area: Area, name: &str) -> Result<Vec<u8>, String> {
        Ok(fs::read(self.file(area, name)?).unwrap_or_default())
    }

    pub fn put(&self, area: Area, name: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.file(area, name)?;
        fs::create_dir_all(self.dir(area)).map_err(|e| e.to_string())?;
        write_atomic(&path, bytes).map_err(|e| e.to_string())
    }

    /// Removes the files of an area (only those starting with `prefix`) that `keep` does not name; returns the bytes
    /// of the files that stay.
    pub fn prune(&self, area: Area, keep: &[String], prefix: &str) -> Result<u64, String> {
        let keep: HashSet<&str> = keep.iter().map(String::as_str).collect();
        let mut total = 0;
        for entry in fs::read_dir(self.dir(area)).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if !path.is_file() || !name.starts_with(prefix) {
                continue;
            }
            if keep.contains(name.as_str()) {
                total += size_of(&path);
            } else {
                // A file that cannot be removed now is pruned the next time; it is only cache or an old image
                let _ = fs::remove_file(&path);
            }
        }
        Ok(total)
    }

    /// `profile.json`, or `None` before the first profile (a damaged file also reads as none)
    pub fn profile(&self) -> Option<Value> {
        let bytes = fs::read(self.profile.join("profile.json")).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn set_profile(&self, profile: &Value) -> Result<(), String> {
        if !profile.is_object() {
            return Err("the profile must be an object".to_owned());
        }
        fs::create_dir_all(&self.profile).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
        write_atomic(&self.profile.join("profile.json"), text.as_bytes()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn files(tag: &str) -> (ArtistFiles, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("halation-artist-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let profile = root.join("Profile");
        (
            ArtistFiles::new(
                profile.clone(),
                profile.join("References"),
                root.join("feed"),
            ),
            root,
        )
    }

    #[test]
    fn file_names_cannot_leave_the_folder() {
        for ok in [
            "youtube-avatar.webp",
            "feed-youtube.json",
            "yt-r-dQw4w9WgXcQ.webp",
            "a.jpg",
        ] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in [
            "",
            ".webp",
            "../x.webp",
            "a/b.webp",
            "a.png",
            "a b.webp",
            "a.webp.exe",
            "x",
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(!valid_name(&format!("{}.webp", "x".repeat(57))));
    }

    #[test]
    fn put_and_get_round_trip_and_a_missing_file_is_empty() {
        let (f, root) = files("roundtrip");
        assert!(f.get(Area::Feed, "feed-a.json").unwrap().is_empty());
        f.put(Area::Feed, "feed-a.json", b"{}").unwrap();
        assert_eq!(f.get(Area::Feed, "feed-a.json").unwrap(), b"{}");
        assert!(f.put(Area::Feed, "../escape.json", b"x").is_err());
        assert!(f.get(Area::Profile, "a.png").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prune_removes_unnamed_files_with_the_prefix_and_reports_what_stays() {
        let (f, root) = files("prune");
        f.put(Area::References, "yt-r-one.webp", b"1234").unwrap();
        f.put(Area::References, "yt-r-two.webp", b"12").unwrap();
        f.put(Area::References, "sc-r-three.webp", b"123456")
            .unwrap();
        let kept = f
            .prune(Area::References, &["yt-r-one.webp".to_owned()], "yt-r-")
            .unwrap();
        assert_eq!(kept, 4);
        assert!(!root.join("Profile/References/yt-r-two.webp").exists());
        assert!(
            root.join("Profile/References/sc-r-three.webp").exists(),
            "other prefixes are left alone"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_profile_is_an_object_kept_atomically() {
        let (f, root) = files("profile");
        assert!(f.profile().is_none());
        assert!(f.set_profile(&json!([1])).is_err());
        f.set_profile(&json!({"name": "Artist"})).unwrap();
        assert_eq!(f.profile().unwrap()["name"], "Artist");
        fs::write(root.join("Profile/profile.json"), b"{ damaged").unwrap();
        assert!(f.profile().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
