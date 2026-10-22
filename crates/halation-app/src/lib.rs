#![deny(unsafe_code)]

// The logic lives in halation-core; these names keep the app's paths short
pub use halation_core::{folders, jobs, settings};

pub mod app;
pub mod assets;
pub mod backdrop;
pub mod catalog;
mod converter;
pub mod library;
pub mod motion;
pub mod navigation;
pub mod profile;
#[cfg(feature = "diag-screenshot")]
pub mod screenshot;
pub mod theme;

pub mod ui {
    slint::include_modules!();
}

pub const APP_NAME: &str = "Halation";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const BUILD_SHA: &str = env!("HALATION_BUILD_SHA");

pub fn build_label() -> String {
    format!("{APP_NAME} native beta · v{APP_VERSION} · {BUILD_SHA}")
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    app::run()
}
