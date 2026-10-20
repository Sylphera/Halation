use crate::atomic_file::write_atomic;
use crate::ui::LibraryRow;
use serde::{Deserialize, Serialize};
use slint::{Model, ModelNotify, ModelTracker, SharedString};
use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;
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

fn row_from_entry(entry: &LibraryEntry) -> LibraryRow {
    LibraryRow {
        id: SharedString::from(entry.id.as_str()),
        name: SharedString::from(entry.display_name.as_str()),
        path: SharedString::from(entry.path.as_str()),
        missing: entry.missing,
    }
}

/// Slint model over the bounded reference collection.
///
/// `visible` is a precomputed row-to-entry map: `row_data` never filters, scans or touches the
/// filesystem. Missing metadata is cached in each entry.
pub struct LibraryModel {
    entries: RefCell<Vec<LibraryEntry>>,
    visible: RefCell<Vec<usize>>,
    query: RefCell<String>,
    limit: Cell<usize>,
    notify: ModelNotify,
}

impl LibraryModel {
    pub fn new(limit: usize) -> Rc<Self> {
        Rc::new(Self {
            entries: RefCell::new(Vec::new()),
            visible: RefCell::new(Vec::new()),
            query: RefCell::new(String::new()),
            limit: Cell::new(limit.clamp(1, MAX_LIMIT)),
            notify: ModelNotify::default(),
        })
    }

    pub fn limit(&self) -> usize {
        self.limit.get()
    }

    pub fn set_limit(&self, limit: usize) {
        self.limit.set(limit.clamp(1, MAX_LIMIT));
    }

    pub fn entries(&self) -> Vec<LibraryEntry> {
        self.entries.borrow().clone()
    }

    pub fn recent_entries(&self, limit: usize) -> Vec<LibraryEntry> {
        self.entries
            .borrow()
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn query(&self) -> String {
        self.query.borrow().clone()
    }

    pub fn missing_count(&self) -> usize {
        self.entries
            .borrow()
            .iter()
            .filter(|entry| entry.missing)
            .count()
    }

    pub fn visible_indices(&self) -> Vec<usize> {
        self.visible.borrow().clone()
    }

    pub fn replace_entries(&self, entries: Vec<LibraryEntry>) {
        *self.entries.borrow_mut() = entries;
        self.rebuild();
    }

    /// Add a reference. Duplicates are compared case-insensitively on the stored path.
    pub fn add_entry(&self, entry: LibraryEntry) -> Result<(), LibraryError> {
        {
            let mut entries = self.entries.borrow_mut();
            if entries
                .iter()
                .any(|existing| existing.path.eq_ignore_ascii_case(&entry.path))
            {
                return Err(LibraryError::Duplicate);
            }
            if entries.len() >= self.limit.get() {
                return Err(LibraryError::Full {
                    limit: self.limit.get(),
                });
            }
            entries.push(entry);
        }
        self.rebuild();
        Ok(())
    }

    pub fn remove_reference(&self, id: &str) -> bool {
        let removed = {
            let mut entries = self.entries.borrow_mut();
            let before = entries.len();
            entries.retain(|entry| entry.id != id);
            entries.len() != before
        };
        if removed {
            self.rebuild();
        }
        removed
    }

    pub fn set_query(&self, query: &str) {
        if self.query.borrow().as_str() == query {
            return;
        }
        *self.query.borrow_mut() = query.to_owned();
        self.rebuild();
    }

    pub fn apply_missing(&self, updates: &[(String, bool)]) {
        let mut changed = false;
        {
            let mut entries = self.entries.borrow_mut();
            for (id, missing) in updates {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == *id)
                    && entry.missing != *missing
                {
                    entry.missing = *missing;
                    changed = true;
                }
            }
        }
        if changed {
            self.notify.reset();
        }
    }

    fn rebuild(&self) {
        let entries = self.entries.borrow();
        let query = self.query.borrow().to_lowercase();
        let visible: Vec<usize> = entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                query.is_empty()
                    || entry.display_name.to_lowercase().contains(&query)
                    || entry.path.to_lowercase().contains(&query)
            })
            .map(|(index, _)| index)
            .collect();
        drop(entries);
        *self.visible.borrow_mut() = visible;
        self.notify.reset();
    }
}

impl Model for LibraryModel {
    type Data = LibraryRow;

    fn row_count(&self) -> usize {
        self.visible.borrow().len()
    }

    fn row_data(&self, row: usize) -> Option<Self::Data> {
        let entry_index = *self.visible.borrow().get(row)?;
        let entries = self.entries.borrow();
        entries.get(entry_index).map(row_from_entry)
    }

    fn model_tracker(&self) -> &dyn ModelTracker {
        &self.notify
    }

    fn as_any(&self) -> &dyn Any {
        self
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

#[derive(Debug)]
struct PendingSave {
    generation: u64,
    entries: Vec<LibraryEntry>,
}

pub struct LibraryStore {
    path: PathBuf,
    model: Rc<LibraryModel>,
    committed: Vec<LibraryEntry>,
    pending: Option<PendingSave>,
    next_generation: u64,
    writable: bool,
    error: Option<String>,
}

impl LibraryStore {
    pub fn new(path: impl Into<PathBuf>, model: Rc<LibraryModel>) -> Self {
        Self {
            path: path.into(),
            model,
            committed: Vec::new(),
            pending: None,
            next_generation: 0,
            writable: true,
            error: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn model(&self) -> &Rc<LibraryModel> {
        &self.model
    }

    pub fn committed(&self) -> &[LibraryEntry] {
        &self.committed
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn writable(&self) -> bool {
        self.writable
    }

    pub fn busy(&self) -> bool {
        self.pending.is_some()
    }

    pub fn apply_load(&mut self, load: LibraryLoad) {
        match load {
            LibraryLoad::Missing => {
                self.model.replace_entries(Vec::new());
                self.committed.clear();
                self.writable = true;
                self.error = None;
            }
            LibraryLoad::Loaded(entries) => {
                self.committed.clone_from(&entries);
                self.model.replace_entries(entries);
                self.writable = true;
                self.error = None;
            }
            LibraryLoad::Corrupt(message) => {
                // Fail closed: keep whatever is already loaded and refuse ordinary writes.
                self.writable = false;
                self.error = Some(message);
            }
        }
    }

    pub fn add_reference(&mut self, path: &Path) -> Result<LibraryEntry, LibraryError> {
        if !self.writable {
            return Err(LibraryError::NotWritable);
        }
        if self.pending.is_some() {
            return Err(LibraryError::Busy);
        }
        let entry = scan_reference(path)?;
        self.add_scanned_entry(entry.clone())?;
        Ok(entry)
    }

    /// Add metadata already collected by a bounded worker. This method does no filesystem I/O.
    pub fn add_scanned_entry(&mut self, entry: LibraryEntry) -> Result<(), LibraryError> {
        if !self.writable {
            return Err(LibraryError::NotWritable);
        }
        if self.pending.is_some() {
            return Err(LibraryError::Busy);
        }
        self.model.add_entry(entry)?;
        self.error = None;
        Ok(())
    }

    pub fn remove_reference(&mut self, id: &str) -> Result<(), LibraryError> {
        if !self.writable {
            return Err(LibraryError::NotWritable);
        }
        if self.pending.is_some() {
            return Err(LibraryError::Busy);
        }
        if self.model.remove_reference(id) {
            self.error = None;
            Ok(())
        } else {
            Err(LibraryError::NotFound)
        }
    }

    pub fn begin_save(&mut self) -> Result<SaveRequest, LibraryError> {
        if !self.writable {
            return Err(LibraryError::NotWritable);
        }
        if self.pending.is_some() {
            return Err(LibraryError::Busy);
        }
        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        let entries = self.model.entries();
        self.pending = Some(PendingSave {
            generation,
            entries: entries.clone(),
        });
        Ok(SaveRequest {
            generation,
            path: self.path.clone(),
            entries,
        })
    }

    /// Apply a completed save. Returns `false` for a stale generation.
    pub fn finish_save(&mut self, generation: u64, result: Result<(), String>) -> bool {
        let Some(pending) = self.pending.take() else {
            return false;
        };
        if pending.generation != generation {
            self.pending = Some(pending);
            return false;
        }
        match result {
            Ok(()) => {
                self.committed = pending.entries;
                self.error = None;
            }
            Err(message) => {
                self.model.replace_entries(self.committed.clone());
                self.error = Some(message);
            }
        }
        true
    }

    pub fn cancel_pending(&mut self) {
        self.pending = None;
    }
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
