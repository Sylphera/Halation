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

/// Longest text a settings field keeps (artist name, profile links, name templates)
pub const MAX_TEXT: usize = 300;

/// Settings of the beta. Fields missing from an older file take their defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Settings {
    pub schema_version: u32,
    pub reduced_motion: bool,
    pub library_limit: usize,
    /// 0 English, 1 Spanish
    pub language: u8,
    pub show_dock: bool,
    pub notify: bool,
    /// 0 compact (icons only), 1 expand when needed, 2 keep open
    pub dock_mode: u8,
    pub dock_activity: bool,
    /// 0 as I left it, 1 maximized, 2 full screen
    pub open_window: u8,
    pub artist: String,
    pub youtube: String,
    pub spotify: String,
    pub soundcloud: String,
    pub instagram: String,
    pub tiktok: String,
    /// 0 ask every time, 1 the Halation folder
    pub save_mode: u8,
    pub video_template: String,
    pub image_template: String,
    /// 0 quiet, 1 balanced, 2 fast
    pub processing: u8,
    pub use_gpu: bool,
    /// 0 auto, 1 processor only
    pub vocal_device: u8,
    /// 0 auto, else that many
    pub cpu_jobs: u8,
    pub gpu_jobs: u8,
    pub downloads: u8,
    /// 0 keep working, 1 pause queued jobs
    pub minimized: u8,
    /// Index into 2, 4, 8, 16, 32 GB
    pub budget: u8,
    /// 0 ask when Halation opens, 1 only in Activity, 2 never by itself
    pub updates: u8,
    pub whats_new: bool,
    /// Ids of the tools turned off in Settings > Tools
    pub disabled_tools: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            reduced_motion: false,
            library_limit: DEFAULT_LIBRARY_LIMIT,
            language: 0,
            show_dock: true,
            notify: true,
            dock_mode: 1,
            dock_activity: true,
            open_window: 0,
            artist: String::new(),
            youtube: String::new(),
            spotify: String::new(),
            soundcloud: String::new(),
            instagram: String::new(),
            tiktok: String::new(),
            save_mode: 0,
            video_template: "{title}".to_owned(),
            image_template: "{title}".to_owned(),
            processing: 1,
            use_gpu: true,
            vocal_device: 0,
            cpu_jobs: 0,
            gpu_jobs: 0,
            downloads: 0,
            minimized: 0,
            budget: 2,
            updates: 0,
            whats_new: true,
            disabled_tools: Vec::new(),
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
        let choices = [
            ("language", self.language, 1),
            ("dock_mode", self.dock_mode, 2),
            ("open_window", self.open_window, 2),
            ("save_mode", self.save_mode, 1),
            ("processing", self.processing, 2),
            ("vocal_device", self.vocal_device, 1),
            ("cpu_jobs", self.cpu_jobs, 4),
            ("gpu_jobs", self.gpu_jobs, 2),
            ("downloads", self.downloads, 4),
            ("minimized", self.minimized, 1),
            ("budget", self.budget, 4),
            ("updates", self.updates, 2),
        ];
        if let Some((name, value, max)) = choices.iter().find(|(_, value, max)| value > max) {
            return Err(SettingsError::Invalid(format!(
                "{name} must be at most {max}, got {value}"
            )));
        }
        let texts = [
            &self.artist,
            &self.youtube,
            &self.spotify,
            &self.soundcloud,
            &self.instagram,
            &self.tiktok,
            &self.video_template,
            &self.image_template,
        ];
        if texts.iter().any(|text| text.chars().count() > MAX_TEXT) {
            return Err(SettingsError::Invalid(format!(
                "text settings keep at most {MAX_TEXT} characters"
            )));
        }
        if self.disabled_tools.len() > 32 || self.disabled_tools.iter().any(|id| id.len() > 64) {
            return Err(SettingsError::Invalid(
                "disabled_tools holds at most 32 short ids".to_owned(),
            ));
        }
        Ok(())
    }

    /// A copy with one setting changed from the Settings page: `key` names it, `value` is "0"/"1" for switches,
    /// the index for choices and the text for fields. The result is validated.
    pub fn with_pref(&self, key: &str, value: &str) -> Result<Settings, SettingsError> {
        let mut next = self.clone();
        let flag = || match value {
            "1" | "true" => Ok(true),
            "0" | "false" => Ok(false),
            _ => Err(SettingsError::Invalid(format!("{key} expects on or off"))),
        };
        let choice = || {
            value
                .trim()
                .parse::<u8>()
                .map_err(|_| SettingsError::Invalid(format!("{key} expects a choice")))
        };
        let text = || value.trim().to_owned();
        match key {
            "reduce-motion" => next.reduced_motion = flag()?,
            "language" => next.language = choice()?,
            "show-dock" => next.show_dock = flag()?,
            "notify" => next.notify = flag()?,
            "dock-mode" => next.dock_mode = choice()?,
            "dock-activity" => next.dock_activity = flag()?,
            "open-window" => next.open_window = choice()?,
            "artist" => next.artist = text(),
            "youtube" => next.youtube = text(),
            "spotify" => next.spotify = text(),
            "soundcloud" => next.soundcloud = text(),
            "instagram" => next.instagram = text(),
            "tiktok" => next.tiktok = text(),
            "save-mode" => next.save_mode = choice()?,
            "video-template" => next.video_template = text(),
            "image-template" => next.image_template = text(),
            "processing" => next.processing = choice()?,
            "use-gpu" => next.use_gpu = flag()?,
            "vocal-device" => next.vocal_device = choice()?,
            "cpu-jobs" => next.cpu_jobs = choice()?,
            "gpu-jobs" => next.gpu_jobs = choice()?,
            "downloads" => next.downloads = choice()?,
            "minimized" => next.minimized = choice()?,
            "budget" => next.budget = choice()?,
            "updates" => next.updates = choice()?,
            "whats-new" => next.whats_new = flag()?,
            _ => return Err(SettingsError::Invalid(format!("unknown setting {key}"))),
        }
        next.validate()?;
        Ok(next)
    }

    /// A copy with a tool turned on or off in Settings > Tools
    pub fn with_tool(&self, id: &str, enabled: bool) -> Result<Settings, SettingsError> {
        let mut next = self.clone();
        next.disabled_tools.retain(|tool| tool != id);
        if !enabled {
            next.disabled_tools.push(id.to_owned());
        }
        next.validate()?;
        Ok(next)
    }

    pub fn tool_enabled(&self, id: &str) -> bool {
        !self.disabled_tools.iter().any(|tool| tool == id)
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
    Loaded(Box<Settings>),
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
            Ok(()) => SettingsRead::Loaded(Box::new(settings)),
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
                current: *settings,
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
