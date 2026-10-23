//! Halation's logic without a user interface: jobs and the process engine, the Library's index and sections, settings,
//! presets, export destinations and atomic files. Nothing here depends on Slint or on Tauri; much of it is imported from
//! the Tauri app's Rust backend and adapted (docs/SLINT_BACKEND_IMPORT.md). The app (`halation-app`) depends on this
//! crate, never the other way round.

#![deny(unsafe_code)]

pub mod artist_profile;
pub mod atomic_file;
pub mod components;
pub mod convert;
pub mod destinations;
pub mod engine;
pub mod folders;
pub mod framegrab;
pub mod jobs;
pub mod library;
pub mod names;
pub mod playback;
pub mod presets;
pub mod process;
pub mod queue;
pub mod sections;
pub mod settings;
