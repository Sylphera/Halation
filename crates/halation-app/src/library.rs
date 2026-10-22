//! The Library list as a Slint model over the reference index of `halation_core::library`, and the store that keeps the
//! model and the index file in step.

pub use halation_core::library::*;

use crate::ui::LibraryRow;
use slint::{Model, ModelNotify, ModelTracker, SharedString};
use std::any::Any;
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

fn row_from_entry(entry: &LibraryEntry) -> LibraryRow {
    LibraryRow {
        id: SharedString::from(entry.id.as_str()),
        name: SharedString::from(entry.display_name.as_str()),
        path: SharedString::from(entry.path.as_str()),
        missing: entry.missing,
        kind: SharedString::from(media_kind(&entry.path)),
    }
}

/// The kind of media a path holds, by its extension, as the Workspace's file list names it
pub fn media_kind(path: &str) -> &'static str {
    let extension = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "avif" | "heic" => {
            "Image"
        }
        "wav" | "mp3" | "flac" | "ogg" | "opus" | "m4a" | "aac" | "aiff" | "aif" | "wma" => "Audio",
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "wmv" => "Video",
        _ => "File",
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

    pub fn recent_matches(&self, signature: &[(String, String)], limit: usize) -> bool {
        let entries = self.entries.borrow();
        let count = entries.len().min(limit);
        count == signature.len()
            && entries
                .iter()
                .rev()
                .take(count)
                .zip(signature.iter())
                .all(|(entry, (id, name))| entry.id == *id && entry.display_name == *name)
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

    fn replace_entries(&self, entries: Vec<LibraryEntry>) {
        *self.entries.borrow_mut() = entries;
        self.rebuild();
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

    /// Build an isolated candidate for an add batch without changing the visible model.
    pub fn stage_add_entries(
        &mut self,
        additions: Vec<LibraryEntry>,
    ) -> Result<SaveRequest, LibraryError> {
        self.ensure_available()?;
        if additions.is_empty() {
            return Err(LibraryError::Invalid("no references to add".to_owned()));
        }
        let mut candidate = self.committed.clone();
        for entry in additions {
            if entry.id.is_empty() || entry.path.is_empty() || entry.display_name.is_empty() {
                return Err(LibraryError::Invalid(
                    "a reference has an empty id, path or name".to_owned(),
                ));
            }
            if candidate
                .iter()
                .any(|existing| existing.path.eq_ignore_ascii_case(&entry.path))
            {
                return Err(LibraryError::Duplicate);
            }
            if candidate.iter().any(|existing| existing.id == entry.id) {
                return Err(LibraryError::Invalid(format!(
                    "duplicate reference id {}",
                    entry.id
                )));
            }
            if candidate.len() >= self.model.limit() {
                return Err(LibraryError::Full {
                    limit: self.model.limit(),
                });
            }
            candidate.push(entry);
        }
        Ok(self.begin_candidate(candidate))
    }

    /// Build an isolated removal candidate without changing the visible model.
    pub fn stage_remove_reference(&mut self, id: &str) -> Result<SaveRequest, LibraryError> {
        self.ensure_available()?;
        let mut candidate = self.committed.clone();
        let Some(index) = candidate.iter().position(|entry| entry.id == id) else {
            return Err(LibraryError::NotFound);
        };
        candidate.remove(index);
        Ok(self.begin_candidate(candidate))
    }

    fn ensure_available(&self) -> Result<(), LibraryError> {
        if !self.writable {
            return Err(LibraryError::NotWritable);
        }
        if self.pending.is_some() {
            return Err(LibraryError::Busy);
        }
        Ok(())
    }

    fn begin_candidate(&mut self, entries: Vec<LibraryEntry>) -> SaveRequest {
        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        self.pending = Some(PendingSave {
            generation,
            entries: entries.clone(),
        });
        SaveRequest {
            generation,
            path: self.path.clone(),
            entries,
        }
    }

    /// Publish the candidate only after persistence succeeds.
    pub fn finish_save(&mut self, generation: u64, result: Result<(), String>) -> SaveCompletion {
        let Some(pending) = self.pending.as_ref() else {
            return SaveCompletion::Stale;
        };
        if pending.generation != generation {
            return SaveCompletion::Stale;
        }
        let Some(pending) = self.pending.take() else {
            return SaveCompletion::Stale;
        };
        match result {
            Ok(()) => {
                self.committed = pending.entries;
                self.model.replace_entries(self.committed.clone());
                self.error = None;
                SaveCompletion::Committed
            }
            Err(message) => {
                self.error = Some(message);
                SaveCompletion::Failed
            }
        }
    }
}
