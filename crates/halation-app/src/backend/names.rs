//! File-name rules shared by the backend modules (imported from the Tauri backend's `paths.rs`): what a valid Windows
//! file name is, a free name next to an existing one, an extension, a modification time in milliseconds.

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Letters, digits, `-` and `_` only, at most 56 characters
pub fn safe_id(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(56)
        .collect()
}

/// Any text becomes a valid Windows file name.
pub fn file_stem(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"\/:*?"<>|"#.contains(c) {
                '-'
            } else {
                c
            }
        })
        .take(120)
        .collect();
    let mut s = mapped.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() {
        s = "untitled".into();
    }
    if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        s.push('_');
    }
    s
}

/// `Ok` only when the name is already a valid file name as it is
pub fn check_stem(name: &str) -> Result<(), String> {
    if file_stem(name) == name {
        Ok(())
    } else {
        Err(format!("invalid file name: {name}"))
    }
}

/// A valid file name that keeps the extension.
pub fn clean_filename(name: &str) -> String {
    let ext = ext_of(name);
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let stem = file_stem(if stem.is_empty() { "halation" } else { stem });
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{}", safe_id(&ext))
    }
}

/// "name.ext", or "name (2).ext", "name (3).ext"… if it already exists.
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let first = dir.join(filename);
    if !first.exists() {
        return first;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

pub fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_characters_and_reserved_names_become_valid() {
        assert_eq!(file_stem("a/b:c*d"), "a-b-c-d");
        assert_eq!(file_stem("  name. . "), "name");
        assert_eq!(file_stem(""), "untitled");
        assert_eq!(file_stem("con"), "con_");
        assert!(check_stem("Covers").is_ok());
        assert!(check_stem("../x").is_err());
    }

    #[test]
    fn filenames_keep_a_clean_extension() {
        assert_eq!(clean_filename("my:photo.PNG"), "my-photo.png");
        assert_eq!(clean_filename("noext"), "noext");
        assert_eq!(ext_of("a.b.JPEG"), "jpeg");
    }
}
