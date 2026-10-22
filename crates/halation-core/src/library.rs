//! The Library's reference index: entries (files the user added, never copied), the bounded JSON index on disk, its
//! validation and errors. The list the interface shows is built on top of this in the app (`LibraryModel`).

use crate::atomic_file::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const INDEX_SCHEMA_VERSION: u32 = 1;
pub const MAX_INDEX_BYTES: u64 = 4 * 1024 * 1024;
pub const DEFAULT_LIMIT: usize = 2_000;
pub const MAX_LIMIT: usize = 5_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LibraryEntry {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub missing: bool,
    pub added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LibraryIndex {
    schema_version: u32,
    entries: Vec<LibraryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LibraryError {
    Io(String),
    Duplicate,
    Full { limit: usize },
    NotWritable,
    Busy,
    NotFound,
    NotAFile,
    Invalid(String),
}

impl fmt::Display for LibraryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(f, "library I/O error: {message}"),
            Self::Duplicate => write!(f, "that file is already in the library"),
            Self::Full { limit } => {
                write!(
                    f,
                    "the library limit of {limit} references has been reached"
                )
            }
            Self::NotWritable => write!(f, "the library index is not writable"),
            Self::Busy => write!(f, "a library save is already pending"),
            Self::NotFound => write!(f, "the library reference was not found"),
            Self::NotAFile => write!(f, "the selected path is not a file"),
            Self::Invalid(message) => write!(f, "invalid library data: {message}"),
        }
    }
}

impl std::error::Error for LibraryError {}

impl From<io::Error> for LibraryError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LibraryLoad {
    Missing,
    Loaded(Vec<LibraryEntry>),
    Corrupt(String),
}

#[derive(Debug, Clone)]
pub struct SaveRequest {
    pub generation: u64,
    pub path: PathBuf,
    pub entries: Vec<LibraryEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveCompletion {
    Committed,
    Failed,
    Stale,
}

pub fn scan_reference(path: &Path) -> Result<LibraryEntry, LibraryError> {
    let absolute = std::path::absolute(path)?;
    let metadata = fs::metadata(&absolute)?;
    if !metadata.is_file() {
        return Err(LibraryError::NotAFile);
    }
    let display_name = absolute
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or(LibraryError::NotAFile)?;
    let path_string = absolute.to_string_lossy().into_owned();
    Ok(LibraryEntry {
        id: format!("{:016x}", fnv1a(path_string.as_bytes())),
        path: path_string,
        display_name,
        missing: false,
        added_at: now_secs(),
    })
}

/// Load and validate the bounded index, then refresh missing metadata. Run this off the GUI thread.
pub fn load_index(path: &Path, limit: usize) -> LibraryLoad {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return LibraryLoad::Missing,
        Err(error) => return LibraryLoad::Corrupt(error.to_string()),
    };
    if metadata.len() > MAX_INDEX_BYTES {
        return LibraryLoad::Corrupt(format!(
            "index is {} bytes; the limit is {MAX_INDEX_BYTES}",
            metadata.len()
        ));
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => return LibraryLoad::Corrupt(error.to_string()),
    };
    let index = match serde_json::from_slice::<LibraryIndex>(&bytes) {
        Ok(index) => index,
        Err(error) => return LibraryLoad::Corrupt(error.to_string()),
    };
    if index.schema_version != INDEX_SCHEMA_VERSION {
        return LibraryLoad::Corrupt(format!(
            "unsupported schema version {} (expected {INDEX_SCHEMA_VERSION})",
            index.schema_version
        ));
    }
    if index.entries.len() > limit {
        return LibraryLoad::Corrupt(format!(
            "index has {} entries; the profile limit is {limit}",
            index.entries.len()
        ));
    }
    let mut ids = HashSet::with_capacity(index.entries.len());
    for entry in &index.entries {
        if entry.id.is_empty() || entry.path.is_empty() || entry.display_name.is_empty() {
            return LibraryLoad::Corrupt("an entry has an empty id, path or name".to_owned());
        }
        if !ids.insert(entry.id.as_str()) {
            return LibraryLoad::Corrupt(format!("duplicate entry id {}", entry.id));
        }
    }
    let entries = index
        .entries
        .into_iter()
        .map(|mut entry| {
            entry.missing = !Path::new(&entry.path).is_file();
            entry
        })
        .collect();
    LibraryLoad::Loaded(entries)
}

pub fn write_index(path: &Path, entries: &[LibraryEntry]) -> io::Result<()> {
    if entries.len() > MAX_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("index has more than {MAX_LIMIT} entries"),
        ));
    }
    let index = LibraryIndex {
        schema_version: INDEX_SCHEMA_VERSION,
        entries: entries.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&index).map_err(io::Error::other)?;
    if bytes.len() as u64 > MAX_INDEX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("serialized index exceeds the {MAX_INDEX_BYTES}-byte limit"),
        ));
    }
    write_atomic(path, &bytes)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
