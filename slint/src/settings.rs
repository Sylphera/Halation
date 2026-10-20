use crate::atomic_file::write_atomic;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SETTINGS_BYTES: u64 = 64 * 1024;
pub const MIN_LIBRARY_LIMIT: usize = 100;
pub const MAX_LIBRARY_LIMIT: usize = 5_000;
pub const DEFAULT_LIBRARY_LIMIT: usize = 2_000;

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

    /// Archive a corrupt/settings file (if present) and write defaults.
    pub fn reset(&mut self) -> Result<(), SettingsError> {
        if self.path.exists() {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let archive = self.path.with_file_name(format!(
                "{}.reset-{stamp}",
                self.path
                    .file_name()
                    .map(|name| name.to_string_lossy())
                    .unwrap_or_else(|| "settings.json".into())
            ));
            fs::rename(&self.path, &archive)?;
        }
        let defaults = Settings::default();
        let bytes =
            serde_json::to_vec_pretty(&defaults).map_err(|e| SettingsError::Io(e.to_string()))?;
        write_atomic(&self.path, &bytes)?;
        self.current = defaults;
        self.locked = false;
        self.error = None;
        Ok(())
    }
}
