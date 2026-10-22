//! One destination policy for user exports (imported from the Tauri backend's `save_location.rs`; docs/features/save-location.md).
//! Temporary and cache writes never go through here. The save dialog becomes a `SavePicker` the caller provides, and the
//! two facts the policy remembers (last manual folder, whether the Halation-folder explanation was shown) are an
//! `ExportLocation` the caller persists. Tauri state, settings and the `Documents\Halation` layout stay out: the caller
//! gives the base folder of the managed mode.

use super::names::{clean_filename, ext_of, file_stem};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveMode {
    /// A save dialog for every export
    AskEveryTime,
    /// Exports go to a folder Halation manages, under a free name
    HalationFolder,
}

impl SaveMode {
    /// The names the Tauri app stored (`saveMode`), plus its older aliases
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "ask-every-time" | "ask" => Some(Self::AskEveryTime),
            "halation-folder" | "direct" => Some(Self::HalationFolder),
            _ => None,
        }
    }
}

/// What the policy remembers between exports; the caller stores it with the rest of the profile
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ExportLocation {
    pub last_manual_directory: Option<PathBuf>,
    pub folder_explanation_shown: bool,
}

/// The save dialog: where the user wants `name`, starting in `start`, or `None` if they cancelled
pub trait SavePicker {
    fn pick(&self, name: &str, start: Option<&Path>) -> Option<PathBuf>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Completion {
    /// The first time this path was reported complete
    pub fresh: bool,
    /// The file went to Halation's own folder
    pub managed: bool,
    /// The one-time explanation of the Halation folder should be shown now
    pub explain: bool,
}

#[derive(Debug, Default)]
pub struct Destinations {
    /// Destinations handed out and whether the user chose them by hand
    granted: HashMap<PathBuf, bool>,
    completed: HashSet<PathBuf>,
}

impl Destinations {
    /// A path is writable by an export only if it was handed out (or lies in a folder that was)
    pub fn allows(&self, path: &Path) -> bool {
        if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
            return false;
        }
        self.granted
            .keys()
            .any(|p| path == p || p.is_dir() && path.starts_with(p))
    }

    /// Chooses where an export called `name` goes. `Ok(None)` means the user cancelled the dialog.
    /// `base` is the managed folder (already the right one for the kind of output); `subfolder` nests below it.
    pub fn resolve(
        &mut self,
        mode: SaveMode,
        base: &Path,
        name: &str,
        subfolder: Option<&str>,
        location: &ExportLocation,
        picker: &dyn SavePicker,
    ) -> Result<Option<PathBuf>, String> {
        let name = clean_filename(name);
        let manual = mode == SaveMode::AskEveryTime;
        let chosen = if manual {
            let start = location
                .last_manual_directory
                .as_deref()
                .filter(|p| p.is_dir());
            picker.pick(&name, start)
        } else {
            let mut dir = base.to_path_buf();
            if let Some(subfolder) = subfolder {
                for part in subfolder
                    .split(['/', '\\'])
                    .filter(|p| !p.is_empty() && *p != "." && *p != "..")
                {
                    dir.push(file_stem(part));
                }
            }
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = available_path(&dir, &name, &self.granted);
            // Reserved at once so two exports started together never get the same name
            self.granted.insert(path.clone(), false);
            Some(path)
        };
        if let Some(path) = &chosen {
            self.granted.insert(path.clone(), manual);
            self.completed.remove(path);
        }
        Ok(chosen)
    }

    /// Call after the tool wrote the final output: only then the folder is remembered.
    pub fn complete(
        &mut self,
        path: &Path,
        location: &mut ExportLocation,
    ) -> Result<Completion, String> {
        if !path.is_file() && !path.is_dir() {
            return Err("the export was not created".to_owned());
        }
        let stale = Completion {
            fresh: false,
            managed: false,
            explain: false,
        };
        let Some(manual) = self.granted.get(path).copied() else {
            return Ok(stale);
        };
        if self.completed.contains(path) {
            return Ok(stale);
        }
        if manual {
            let parent = path.parent().ok_or("invalid export path")?;
            location.last_manual_directory = Some(parent.to_path_buf());
        }
        let explain = !manual && !location.folder_explanation_shown;
        if explain {
            location.folder_explanation_shown = true;
        }
        self.completed.insert(path.to_path_buf());
        Ok(Completion {
            fresh: true,
            managed: !manual,
            explain,
        })
    }

    /// Copies a finished file to a destination that was handed out; nothing else may be written.
    pub fn copy_to(&self, source: &Path, destination: &Path) -> Result<(), String> {
        if !self.allows(destination) {
            return Err("destination was not selected".to_owned());
        }
        fs::copy(source, destination)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// "name.ext", or "name (2).ext", "name (3).ext"… skipping files on disk and names already reserved
fn available_path(dir: &Path, name: &str, reserved: &HashMap<PathBuf, bool>) -> PathBuf {
    let source = Path::new(name);
    let stem = source
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let ext = match ext_of(name) {
        e if e.is_empty() => String::new(),
        _ => source
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default(),
    };
    std::iter::once(dir.join(name))
        .chain((2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))))
        .find(|p| !p.exists() && !reserved.contains_key(p))
        .expect("unbounded name candidates")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Picker {
        answer: Option<PathBuf>,
        seen: RefCell<Vec<(String, Option<PathBuf>)>>,
    }

    impl SavePicker for Picker {
        fn pick(&self, name: &str, start: Option<&Path>) -> Option<PathBuf> {
            self.seen
                .borrow_mut()
                .push((name.to_owned(), start.map(Path::to_path_buf)));
            self.answer.clone()
        }
    }

    fn picker(answer: Option<PathBuf>) -> Picker {
        Picker {
            answer,
            seen: RefCell::default(),
        }
    }

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("halation-dest-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reservations_do_not_collide_before_the_writer_starts() {
        let dir = temp("reserve");
        let mut d = Destinations::default();
        let none = picker(None);
        let loc = ExportLocation::default();
        let a = d
            .resolve(
                SaveMode::HalationFolder,
                &dir,
                "cover.png",
                None,
                &loc,
                &none,
            )
            .unwrap()
            .unwrap();
        let b = d
            .resolve(
                SaveMode::HalationFolder,
                &dir,
                "cover.png",
                None,
                &loc,
                &none,
            )
            .unwrap()
            .unwrap();
        assert_eq!(a, dir.join("cover.png"));
        assert_eq!(b, dir.join("cover (2).png"));
        fs::write(dir.join("cover (3).png"), b"x").unwrap();
        let c = d
            .resolve(
                SaveMode::HalationFolder,
                &dir,
                "cover.png",
                None,
                &loc,
                &none,
            )
            .unwrap()
            .unwrap();
        assert_eq!(c, dir.join("cover (4).png"));
        assert!(none.seen.borrow().is_empty(), "managed mode never asks");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn subfolders_are_cleaned_and_cannot_climb_out() {
        let dir = temp("sub");
        let mut d = Destinations::default();
        let p = d
            .resolve(
                SaveMode::HalationFolder,
                &dir,
                "a.png",
                Some("../Frames/ok:name"),
                &ExportLocation::default(),
                &picker(None),
            )
            .unwrap()
            .unwrap();
        assert_eq!(p, dir.join("Frames").join("ok-name").join("a.png"));
        assert!(p.parent().unwrap().is_dir());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_dialog_starts_in_the_last_folder_and_cancelling_grants_nothing() {
        let dir = temp("ask");
        let mut d = Destinations::default();
        let loc = ExportLocation {
            last_manual_directory: Some(dir.clone()),
            folder_explanation_shown: false,
        };
        let cancelled = picker(None);
        assert_eq!(
            d.resolve(
                SaveMode::AskEveryTime,
                &dir,
                "x*y.mp4",
                None,
                &loc,
                &cancelled
            )
            .unwrap(),
            None
        );
        assert_eq!(
            cancelled.seen.borrow()[0],
            ("x-y.mp4".to_owned(), Some(dir.clone()))
        );
        assert!(!d.allows(&dir.join("x-y.mp4")));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_granted_absolute_paths_without_parent_steps_are_writable() {
        let dir = temp("allow");
        let mut d = Destinations::default();
        let target = dir.join("out.png");
        let pick = picker(Some(target.clone()));
        d.resolve(
            SaveMode::AskEveryTime,
            &dir,
            "out.png",
            None,
            &ExportLocation::default(),
            &pick,
        )
        .unwrap();
        assert!(d.allows(&target));
        assert!(!d.allows(&dir.join("other.png")));
        assert!(!d.allows(&dir.join("..").join("out.png")));
        assert!(!d.allows(Path::new("out.png")));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn completion_remembers_the_manual_folder_and_explains_the_managed_one_once() {
        let dir = temp("complete");
        let mut d = Destinations::default();
        let mut loc = ExportLocation::default();
        let none = picker(None);

        let managed = d
            .resolve(SaveMode::HalationFolder, &dir, "m.png", None, &loc, &none)
            .unwrap()
            .unwrap();
        assert!(d.complete(&managed, &mut loc).is_err(), "no file yet");
        fs::write(&managed, b"x").unwrap();
        let done = d.complete(&managed, &mut loc).unwrap();
        assert_eq!(
            done,
            Completion {
                fresh: true,
                managed: true,
                explain: true
            }
        );
        assert!(loc.folder_explanation_shown && loc.last_manual_directory.is_none());
        assert!(
            !d.complete(&managed, &mut loc).unwrap().fresh,
            "reported once"
        );

        let second = d
            .resolve(SaveMode::HalationFolder, &dir, "m.png", None, &loc, &none)
            .unwrap()
            .unwrap();
        fs::write(&second, b"x").unwrap();
        assert!(
            !d.complete(&second, &mut loc).unwrap().explain,
            "explained once"
        );

        let sub = dir.join("chosen");
        fs::create_dir_all(&sub).unwrap();
        let manual_path = sub.join("by-hand.png");
        let pick = picker(Some(manual_path.clone()));
        d.resolve(
            SaveMode::AskEveryTime,
            &dir,
            "by-hand.png",
            None,
            &loc,
            &pick,
        )
        .unwrap();
        fs::write(&manual_path, b"x").unwrap();
        let done = d.complete(&manual_path, &mut loc).unwrap();
        assert!(done.fresh && !done.managed);
        assert_eq!(loc.last_manual_directory, Some(sub));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn copies_only_to_granted_destinations() {
        let dir = temp("copy");
        let mut d = Destinations::default();
        let src = dir.join("src.txt");
        fs::write(&src, b"hello").unwrap();
        assert!(d.copy_to(&src, &dir.join("loose.txt")).is_err());
        let target = dir.join("dest.txt");
        let pick = picker(Some(target.clone()));
        d.resolve(
            SaveMode::AskEveryTime,
            &dir,
            "dest.txt",
            None,
            &ExportLocation::default(),
            &pick,
        )
        .unwrap();
        d.copy_to(&src, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"hello");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mode_names_match_what_the_tauri_app_stored() {
        assert_eq!(SaveMode::parse("ask"), Some(SaveMode::AskEveryTime));
        assert_eq!(SaveMode::parse("direct"), Some(SaveMode::HalationFolder));
        assert_eq!(SaveMode::parse("later"), None);
    }
}
