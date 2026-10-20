use crate::atomic_file::{write_atomic, write_atomic_new};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
pub const MIN_LIBRARY_LIMIT: usize = 100;
pub const MAX_LIBRARY_LIMIT: usize = 5_000;
pub const DEFAULT_LIBRARY_LIMIT: usize = 2_000;

static RESET_BACKUP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u32,
    pub reduced_motion: bool,
    pub library_limit: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            reduced_motion: false,
            library_limit: DEFAULT_LIBRARY_LIMIT,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), SettingsError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(SettingsError::Invalid(format!(
                "unsupported schema version {} (expected {SCHEMA_VERSION})",
                self.schema_version
            )));
        }
        if !(MIN_LIBRARY_LIMIT..=MAX_LIBRARY_LIMIT).contains(&self.library_limit) {
            return Err(SettingsError::Invalid(format!(
                "library_limit must be between {MIN_LIBRARY_LIMIT} and {MAX_LIBRARY_LIMIT}"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    Io(String),
    Corrupt(String),
    Locked(String),
    Invalid(String),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(f, "settings I/O error: {message}"),
            Self::Corrupt(message) => write!(f, "settings data is corrupt: {message}"),
            Self::Locked(message) => write!(f, "settings are locked: {message}"),
            Self::Invalid(message) => write!(f, "invalid settings: {message}"),
        }
    }
}

impl std::error::Error for SettingsError {}

impl From<io::Error> for SettingsError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsRead {
    Missing,
    Loaded(Settings),
    Corrupt(String),
}

pub fn read_settings(path: &Path) -> SettingsRead {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return SettingsRead::Missing,
        Err(error) => return SettingsRead::Corrupt(error.to_string()),
    };
    if metadata.len() > MAX_SETTINGS_BYTES {
        return SettingsRead::Corrupt(format!(
            "file is {} bytes; the limit is {MAX_SETTINGS_BYTES}",
            metadata.len()
        ));
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => return SettingsRead::Corrupt(error.to_string()),
    };
    match serde_json::from_slice::<Settings>(&bytes) {
        Ok(settings) => match settings.validate() {
            Ok(()) => SettingsRead::Loaded(settings),
            Err(error) => SettingsRead::Corrupt(error.to_string()),
        },
        Err(error) => SettingsRead::Corrupt(error.to_string()),
    }
}

#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
    current: Settings,
    locked: bool,
    error: Option<String>,
}

impl SettingsStore {
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        match read_settings(&path) {
            SettingsRead::Missing => Self {
                path,
                current: Settings::default(),
                locked: false,
                error: None,
            },
            SettingsRead::Loaded(settings) => Self {
                path,
                current: settings,
                locked: false,
                error: None,
            },
            SettingsRead::Corrupt(message) => Self {
                path,
                current: Settings::default(),
                locked: true,
                error: Some(message),
            },
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn current(&self) -> &Settings {
        &self.current
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// Persist a new settings value. The in-memory value changes only after a successful write.
    pub fn save(&mut self, next: Settings) -> Result<(), SettingsError> {
        self.save_with(next, write_atomic)
    }

    /// Testable persistence hook. `writer` receives the final path and bytes.
    pub fn save_with<F>(&mut self, next: Settings, writer: F) -> Result<(), SettingsError>
    where
        F: FnOnce(&Path, &[u8]) -> io::Result<()>,
    {
        if self.locked {
            return Err(SettingsError::Locked(
                self.error
                    .clone()
                    .unwrap_or_else(|| "reset is required".to_owned()),
            ));
        }
        next.validate()?;
        let bytes = serde_json::to_vec_pretty(&next)
            .map_err(|error| SettingsError::Io(error.to_string()))?;
        writer(&self.path, &bytes).map_err(|error| {
            let message = error.to_string();
            self.error = Some(message.clone());
            SettingsError::Io(message)
        })?;
        self.current = next;
        self.error = None;
        Ok(())
    }

    /// Move the current file to a same-directory backup, then atomically write defaults.
    pub fn reset(&mut self) -> Result<(), SettingsError> {
        self.reset_with(write_atomic_new)
    }

    /// Testable writer hook for the reset transaction and its failure recovery.
    pub fn reset_with<F>(&mut self, writer: F) -> Result<(), SettingsError>
    where
        F: FnOnce(&Path, &[u8]) -> io::Result<()>,
    {
        let defaults = Settings::default();
        let bytes = serde_json::to_vec_pretty(&defaults).map_err(|error| {
            let message = error.to_string();
            self.locked = true;
            self.error = Some(message.clone());
            SettingsError::Io(message)
        })?;

        let backup = match fs::symlink_metadata(&self.path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let backup = match self.unique_reset_backup_path() {
                    Ok(path) => path,
                    Err(error) => {
                        let message = format!("could not allocate settings backup: {error}");
                        self.locked = true;
                        self.error = Some(message.clone());
                        return Err(SettingsError::Io(message));
                    }
                };
                if let Err(error) = fs::rename(&self.path, &backup) {
                    let message = format!("could not preserve settings before reset: {error}");
                    self.locked = true;
                    self.error = Some(message.clone());
                    return Err(SettingsError::Io(message));
                }
                Some(backup)
            }
            Ok(_) => {
                let message =
                    "settings path is not a regular file; reset did not replace it".to_owned();
                self.locked = true;
                self.error = Some(message.clone());
                return Err(SettingsError::Io(message));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => {
                let message = format!("could not inspect settings before reset: {error}");
                self.locked = true;
                self.error = Some(message.clone());
                return Err(SettingsError::Io(message));
            }
        };

        if let Some(backup_path) = backup.as_ref() {
            match fs::symlink_metadata(&self.path) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Ok(_) => {
                    let message = format!(
                        "settings path changed during reset; it was not overwritten and the original is preserved at {}",
                        backup_path.display()
                    );
                    self.locked = true;
                    self.error = Some(message.clone());
                    return Err(SettingsError::Io(message));
                }
                Err(error) => {
                    let message = format!(
                        "could not verify the settings path before reset; original remains at {}: {error}",
                        backup_path.display()
                    );
                    self.locked = true;
                    self.error = Some(message.clone());
                    return Err(SettingsError::Io(message));
                }
            }
        }

        if let Err(error) = writer(&self.path, &bytes) {
            let message = match backup {
                Some(path) => {
                    let recovery = match fs::symlink_metadata(&self.path) {
                        Err(path_error) if path_error.kind() == io::ErrorKind::NotFound => {
                            match fs::hard_link(&path, &self.path) {
                                Ok(()) => format!(
                                    "the previous file was restored and its backup remains at {}",
                                    path.display()
                                ),
                                Err(restore_error) => format!(
                                    "the live path remains absent; the original is preserved at {} (restore failed: {restore_error})",
                                    path.display()
                                ),
                            }
                        }
                        Ok(_) => format!(
                            "the live path changed during reset and was not overwritten; the original is preserved at {}",
                            path.display()
                        ),
                        Err(path_error) => format!(
                            "could not inspect the live path after failure; the original is preserved at {} ({path_error})",
                            path.display()
                        ),
                    };
                    format!("reset failed; defaults were not committed; {recovery}: {error}")
                }
                None => format!("reset failed; defaults were not committed: {error}"),
            };
            // Keep ordinary writes locked after reset failure so a concurrent filesystem change
            // cannot be overwritten by a later UI edit.
            self.locked = true;
            self.error = Some(message.clone());
            return Err(SettingsError::Io(message));
        }

        self.current = defaults;
        self.locked = false;
        self.error = None;
        Ok(())
    }

    fn unique_reset_backup_path(&self) -> io::Result<PathBuf> {
        let file_name = self
            .path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_else(|| "settings.json".into());
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);

        for _ in 0..16 {
            let counter = RESET_BACKUP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let backup = self
                .path
                .with_file_name(format!("{file_name}.reset-{stamp}-{counter}"));
            match fs::symlink_metadata(&backup) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(backup),
                Ok(_) => continue,
                Err(error) => return Err(error),
            }
        }

        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique settings backup name",
        ))
    }
}
