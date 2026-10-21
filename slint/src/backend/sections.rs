//! Library sections on disk (imported from the Tauri backend's `library.rs`, docs/features/library.md): the user's own
//! sections (folders of the Library root), the folders of the PC linked as sections (read where they are, never
//! copied), and the optional packs (`Packs/<pack>`, read-only). The module knows folders only; what the page keeps
//! about them (order, links, favourites) belongs to the profile, and the reference index is `crate::library`.

use super::names::{check_stem, clean_filename, ext_of, modified_ms, unique_path};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// What a section shows: pictures and videos
pub const MEDIA: [&str; 10] = [
    "png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "webm", "mov", "mp4",
];
const PACKS: &str = "Packs";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub name: String,
    pub path: PathBuf,
    /// A linked folder that disappeared is listed as missing, without an error
    pub missing: bool,
    pub count: u64,
    /// Newest change in the folder, to compare when syncing
    pub stamp: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sections {
    pub own: Vec<Section>,
    pub packs: Vec<Section>,
    pub linked: Vec<Section>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionOp<'a> {
    Create(&'a str),
    Rename {
        from: &'a str,
        to: &'a str,
    },
    /// The folder and everything it holds
    Delete(&'a str),
}

/// How many media files a folder holds and when the newest one changed
pub fn stamp(dir: &Path) -> (u64, u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let dir_modified = fs::metadata(dir).map(|m| modified_ms(&m)).unwrap_or(0);
    entries
        .flatten()
        .filter(|e| MEDIA.contains(&ext_of(&e.file_name().to_string_lossy()).as_str()))
        .filter_map(|e| e.metadata().ok().filter(|m| m.is_file()))
        .fold((0, dir_modified), |(n, t), m| {
            (n + 1, t.max(modified_ms(&m)))
        })
}

fn section(name: &str, path: &Path) -> Section {
    let present = path.is_dir();
    let (count, stamp) = if present { stamp(path) } else { (0, 0) };
    Section {
        name: name.to_owned(),
        path: path.to_owned(),
        missing: !present,
        count,
        stamp,
    }
}

fn subfolders(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

/// The sections under `root` plus the linked folders (a linked folder is named after its last component).
pub fn list(root: &Path, links: &[PathBuf]) -> Sections {
    Sections {
        own: subfolders(root)
            .iter()
            .filter(|n| *n != PACKS)
            .map(|n| section(n, &root.join(n)))
            .collect(),
        packs: subfolders(&root.join(PACKS))
            .iter()
            .map(|n| section(n, &root.join(PACKS).join(n)))
            .collect(),
        linked: links
            .iter()
            .map(|p| {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                section(&name, p)
            })
            .collect(),
    }
}

/// A path the Library may read: inside `root` or inside a linked folder (symlinks and `..` are resolved first).
pub fn readable(root: &Path, links: &[PathBuf], path: &Path) -> Result<PathBuf, String> {
    let p = path
        .canonicalize()
        .map_err(|_| "the file no longer exists".to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if p.starts_with(&root)
        || links
            .iter()
            .filter_map(|l| l.canonicalize().ok())
            .any(|l| p.starts_with(l))
    {
        Ok(p)
    } else {
        Err("path outside the Library".into())
    }
}

/// The media items of a section folder, newest first
pub fn items(dir: &Path) -> Result<Vec<Item>, String> {
    let mut out: Vec<Item> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let name = path.file_name()?.to_string_lossy().into_owned();
            MEDIA.contains(&ext_of(&name).as_str()).then(|| Item {
                path,
                name,
                size: meta.len(),
                modified: modified_ms(&meta),
            })
        })
        .collect();
    out.sort_by_key(|i| std::cmp::Reverse(i.modified));
    Ok(out)
}

/// An own section's folder: a single valid name, never the packs' folder
fn own_section(root: &Path, name: &str) -> Result<PathBuf, String> {
    check_stem(name)?;
    if name.eq_ignore_ascii_case(PACKS) {
        return Err(format!("invalid section name: {name}"));
    }
    Ok(root.join(name))
}

/// Creates, renames or deletes an own section; returns the section's new path (empty after a delete).
pub fn section_op(root: &Path, op: SectionOp<'_>) -> Result<PathBuf, String> {
    match op {
        SectionOp::Create(name) => {
            let d = own_section(root, name)?;
            if d.exists() {
                return Err("exists".into());
            }
            fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            Ok(d)
        }
        SectionOp::Rename { from, to } => {
            let d = own_section(root, from)?;
            let n = own_section(root, to)?;
            if n.exists()
                && !n
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&d.to_string_lossy())
            {
                return Err("exists".into());
            }
            fs::rename(&d, &n).map_err(|e| e.to_string())?;
            Ok(n)
        }
        SectionOp::Delete(name) => {
            let d = own_section(root, name)?;
            if d.is_dir() {
                fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
            }
            Ok(PathBuf::new())
        }
    }
}

/// Where a file written to the Library goes: an own section ("Covers") or a pack ("Packs/Grain"); the folder is created
pub fn target_dir(root: &Path, section: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = section.split('/').collect();
    let d = match parts.as_slice() {
        [PACKS, pack] => {
            check_stem(pack)?;
            root.join(PACKS).join(pack)
        }
        [name] => own_section(root, name)?,
        _ => return Err(format!("invalid section {section}")),
    };
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Bytes into a section with a free name; returns the new path
pub fn write_item(
    root: &Path,
    section: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let d = target_dir(root, section)?;
    let name = clean_filename(filename);
    if !MEDIA.contains(&ext_of(&name).as_str()) {
        return Err(format!("not a picture or video: {name}"));
    }
    let p = unique_path(&d, &name);
    fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(p)
}

/// Removes an item of an own section (a pack or a linked folder is never changed)
pub fn remove_item(root: &Path, path: &Path) -> Result<(), String> {
    let r = root.canonicalize().map_err(|e| e.to_string())?;
    let p = path
        .canonicalize()
        .map_err(|_| "the file no longer exists".to_string())?;
    if !p.starts_with(&r) || p.starts_with(r.join(PACKS)) || !p.is_file() {
        return Err("not an item of an own section".into());
    }
    fs::remove_file(p).map_err(|e| e.to_string())
}

/// Removes an installed pack
pub fn remove_pack(root: &Path, id: &str) -> Result<(), String> {
    check_stem(id)?;
    let d = root.join(PACKS).join(id);
    if d.is_dir() {
        fs::remove_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}
