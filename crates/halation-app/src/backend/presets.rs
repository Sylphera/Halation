//! Presets and looks: one `.json` per preset in a folder (imported from the Tauri backend's `presets.rs`).
//! The caller gives the folder (`Presets/Visualizer`, `Presets/Grade`…); the module lists, fingerprints, writes,
//! deletes and renames or copies the files. Writes are atomic and names must be valid file names as they are.

use super::names::{check_stem, ext_of, modified_ms};
use crate::atomic_file::write_atomic;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preset {
    pub name: String,
    pub content: String,
    pub modified: u64,
}

pub struct PresetStore {
    dir: PathBuf,
}

impl PresetStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        check_stem(name)?;
        Ok(self.dir.join(format!("{name}.json")))
    }

    /// (name, path, metadata) of every preset file, sorted by name; a missing folder is an empty list
    fn entries(&self) -> Result<Vec<(String, PathBuf, fs::Metadata)>, String> {
        let read = match fs::read_dir(&self.dir) {
            Ok(read) => read,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        let mut out = Vec::new();
        for entry in read.flatten() {
            let path = entry.path();
            if ext_of(&path.to_string_lossy()) != "json" {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
                continue;
            };
            if meta.is_file() {
                out.push((name, path, meta));
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(out)
    }

    /// Every readable preset; a file that cannot be read as text is skipped
    pub fn list(&self) -> Result<Vec<Preset>, String> {
        Ok(self
            .entries()?
            .into_iter()
            .filter_map(|(name, path, meta)| {
                let content = fs::read_to_string(path).ok()?;
                Some(Preset {
                    name,
                    content: content.trim_start_matches('\u{feff}').to_owned(),
                    modified: modified_ms(&meta),
                })
            })
            .collect())
    }

    /// Cheap fingerprint of the folder: changes when a preset is added, removed or edited
    pub fn stamp(&self) -> Result<String, String> {
        Ok(self
            .entries()?
            .iter()
            .map(|(n, _, m)| format!("{n}:{}:{}", modified_ms(m), m.len()))
            .collect::<Vec<_>>()
            .join("|"))
    }

    pub fn write(&self, name: &str, content: &str) -> Result<(), String> {
        let path = self.path(name)?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        write_atomic(&path, content.as_bytes()).map_err(|e| e.to_string())
    }

    /// `Ok(false)` when there was nothing to delete
    pub fn delete(&self, name: &str) -> Result<bool, String> {
        let path = self.path(name)?;
        if !path.exists() {
            return Ok(false);
        }
        fs::remove_file(path)
            .map(|()| true)
            .map_err(|e| e.to_string())
    }

    /// Renames `from` to `to`, or copies it when `copy` is set; never overwrites another preset
    pub fn rename(&self, from: &str, to: &str, copy: bool) -> Result<(), String> {
        let (src, dst) = (self.path(from)?, self.path(to)?);
        if !src.exists() {
            return Err(format!("\"{from}\" no longer exists"));
        }
        // Changing only the case of a name is a rename of the same file on a case-insensitive disk
        let same_file = !copy && from.eq_ignore_ascii_case(to);
        if dst.exists() && !same_file {
            return Err(format!("\"{to}\" already exists"));
        }
        if copy {
            fs::copy(&src, &dst).map(|_| ()).map_err(|e| e.to_string())
        } else {
            fs::rename(&src, &dst).map_err(|e| e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> (PresetStore, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("halation-presets-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        (PresetStore::new(dir.join("Grade")), dir)
    }

    #[test]
    fn a_missing_folder_is_an_empty_list_and_writing_creates_it() {
        let (s, root) = store("missing");
        assert!(s.list().unwrap().is_empty());
        assert_eq!(s.stamp().unwrap(), "");
        s.write("Warm", "{\"a\":1}").unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(
            (all[0].name.as_str(), all[0].content.as_str()),
            ("Warm", "{\"a\":1}")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn listing_is_sorted_ignores_other_files_and_strips_a_bom() {
        let (s, root) = store("list");
        s.write("b", "2").unwrap();
        s.write("a", "1").unwrap();
        fs::write(s.dir().join("notes.txt"), "x").unwrap();
        fs::create_dir_all(s.dir().join("folder.json")).unwrap();
        fs::write(s.dir().join("c.json"), "\u{feff}3").unwrap();
        let names: Vec<_> = s
            .list()
            .unwrap()
            .into_iter()
            .map(|p| (p.name, p.content))
            .collect();
        assert_eq!(
            names,
            vec![
                ("a".to_owned(), "1".to_owned()),
                ("b".to_owned(), "2".to_owned()),
                ("c".to_owned(), "3".to_owned())
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_stamp_changes_when_a_preset_is_added_edited_or_removed() {
        let (s, root) = store("stamp");
        s.write("a", "1").unwrap();
        let one = s.stamp().unwrap();
        s.write("a", "12345").unwrap();
        let edited = s.stamp().unwrap();
        assert_ne!(one, edited);
        s.write("b", "1").unwrap();
        assert_ne!(edited, s.stamp().unwrap());
        assert!(s.delete("b").unwrap());
        assert_eq!(edited, s.stamp().unwrap());
        assert!(!s.delete("b").unwrap(), "nothing left to delete");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn names_that_are_not_valid_file_names_are_refused() {
        let (s, root) = store("names");
        for bad in ["", "../x", "a/b"] {
            assert!(s.write(bad, "x").is_err(), "{bad:?}");
            assert!(s.delete(bad).is_err(), "{bad:?}");
        }
        assert!(s.rename("a", "../b", false).is_err());
        assert!(!root.join("x.json").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_and_copy_never_overwrite_and_a_case_change_is_allowed() {
        let (s, root) = store("rename");
        s.write("one", "1").unwrap();
        s.write("two", "2").unwrap();
        assert!(
            s.rename("one", "two", false)
                .unwrap_err()
                .contains("already exists")
        );
        assert!(s.rename("one", "two", true).is_err());
        assert!(
            s.rename("ghost", "x", false)
                .unwrap_err()
                .contains("no longer exists")
        );
        s.rename("one", "three", true).unwrap();
        assert_eq!(s.list().unwrap().len(), 3);
        s.rename("three", "Three", false).unwrap();
        let names: Vec<_> = s.list().unwrap().into_iter().map(|p| p.name).collect();
        assert!(names.contains(&"Three".to_owned()) && !names.contains(&"three".to_owned()));
        fs::remove_dir_all(root).unwrap();
    }
}
