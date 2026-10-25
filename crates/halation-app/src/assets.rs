//! The app's files beside the executable, in `assets\` (Java, 2026-10-21: assets ship apart from the exe, installer
//! only): the mark and wordmark, the icons, the typefaces (Schibsted Grotesk, Italiana), and Home's backdrop loop. `build.rs` copies
//! the crate's `assets/` there for development builds. A missing file is reported to the user and logged; the app still
//! runs without it.

use crate::theme::Tone;
use crate::ui::{AppWindow, Assets};
use slint::{ComponentHandle, Image};
use std::path::{Path, PathBuf};

/// Where the app's files are: `HALATION_ASSETS` when set (reviews and tests), else `assets` next to the executable
pub fn locate() -> PathBuf {
    if let Some(dir) = std::env::var_os("HALATION_ASSETS") {
        return PathBuf::from(dir);
    }
    std::env::current_exe()
        .ok()
        .map(|exe| beside_executable(&exe))
        .unwrap_or_else(|| PathBuf::from("assets"))
}

/// Cargo runs test binaries from `target/<profile>/deps/`, while `build.rs`
/// stages assets at `target/<profile>/assets/` for the real app executable.
/// Find that sibling *only for test-binary locations*, preserving installed
/// app resolution and the explicit HALATION_ASSETS override.
fn beside_executable(exe: &Path) -> PathBuf {
    let Some(dir) = exe.parent() else {
        return PathBuf::from("assets");
    };
    if dir.file_name().is_some_and(|name| name == "deps")
        && let Some(profile_dir) = dir.parent()
    {
        let sibling = profile_dir.join("assets");
        if sibling.is_dir() {
            return sibling;
        }
    }
    dir.join("assets")
}

/// Every icon the interface names, as files `icons/<name>.svg`
const ICONS: [&str; 29] = [
    "chevron-down",
    "circle-help",
    "convert",
    "cover",
    "download",
    "eraser",
    "external-link",
    "file-text",
    "folder-open",
    "framegrab",
    "globe",
    "grade",
    "house",
    "interp",
    "keyboard",
    "library",
    "panel-left-close",
    "panel-left-open",
    "refresh-cw",
    "removebg",
    "rotate-ccw",
    "save",
    "search",
    "settings",
    "upload",
    "upscale",
    "visualizer",
    "vocal",
    "warning",
];

fn set_icon(assets: &Assets<'_>, name: &str, image: Image) {
    match name {
        "chevron-down" => assets.set_icon_chevron_down(image),
        "circle-help" => assets.set_icon_circle_help(image),
        "convert" => assets.set_icon_convert(image),
        "cover" => assets.set_icon_cover(image),
        "download" => assets.set_icon_download(image),
        "eraser" => assets.set_icon_eraser(image),
        "external-link" => assets.set_icon_external_link(image),
        "file-text" => assets.set_icon_file_text(image),
        "folder-open" => assets.set_icon_folder_open(image),
        "framegrab" => assets.set_icon_framegrab(image),
        "globe" => assets.set_icon_globe(image),
        "grade" => assets.set_icon_grade(image),
        "house" => assets.set_icon_house(image),
        "interp" => assets.set_icon_interp(image),
        "keyboard" => assets.set_icon_keyboard(image),
        "library" => assets.set_icon_library(image),
        "panel-left-close" => assets.set_icon_panel_left_close(image),
        "panel-left-open" => assets.set_icon_panel_left_open(image),
        "refresh-cw" => assets.set_icon_refresh_cw(image),
        "removebg" => assets.set_icon_removebg(image),
        "rotate-ccw" => assets.set_icon_rotate_ccw(image),
        "save" => assets.set_icon_save(image),
        "search" => assets.set_icon_search(image),
        "settings" => assets.set_icon_settings(image),
        "upload" => assets.set_icon_upload(image),
        "upscale" => assets.set_icon_upscale(image),
        "visualizer" => assets.set_icon_visualizer(image),
        "vocal" => assets.set_icon_vocal(image),
        "warning" => assets.set_icon_warning(image),
        _ => {}
    }
}

/// Files the app needs, relative to the assets folder
pub fn required() -> Vec<String> {
    let mut files: Vec<String> = [
        "halation-mark.png",
        "halation-app-icon.png",
        "halation-wordmark.svg",
        "halation-wordmark-glow.png",
        "drop-outline.svg",
        "drape-still.jpg",
        "drape-loop.mp4",
        "drape-tint.bin",
        "fonts/SchibstedGrotesk.ttf",
        "fonts/Italiana.ttf",
    ]
    .iter()
    .map(|file| (*file).to_owned())
    .collect();
    files.extend(ICONS.iter().map(|name| format!("icons/{name}.svg")));
    files
}

/// The required files missing from `dir`
pub fn missing(dir: &Path) -> Vec<String> {
    required()
        .into_iter()
        .filter(|file| !dir.join(file).is_file())
        .collect()
}

/// The typefaces the interface uses, in `fonts/`
pub const FONTS: [&str; 2] = ["SchibstedGrotesk.ttf", "Italiana.ttf"];

/// Registers the typefaces with Slint's font collection; it must run before the window is created
pub fn register_fonts(dir: &Path) -> Result<(), String> {
    let mut collection = slint::fontique_011::shared_collection();
    for file in FONTS {
        let path = dir.join("fonts").join(file);
        let bytes = std::fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        let blob = slint::fontique_011::fontique::Blob::new(std::sync::Arc::new(bytes));
        if collection.register_fonts(blob, None).is_empty() {
            return Err(format!("{}: not a usable font", path.display()));
        }
    }
    Ok(())
}

/// Loads the images into the interface's `Assets` global; files that are missing or unreadable stay empty
pub fn apply(ui: &AppWindow, dir: &Path, tone: Tone) {
    let assets = ui.global::<Assets>();
    let load = |file: &str| Image::load_from_path(&dir.join(file)).unwrap_or_default();
    assets.set_mark(load("halation-mark.png"));
    assets.set_app_icon(load("halation-app-icon.png"));
    assets.set_wordmark(load("halation-wordmark.svg"));
    assets.set_wordmark_glow(load("halation-wordmark-glow.png"));
    assets.set_drop_outline(load("drop-outline.svg"));
    // Generated, not a file: a standard static grain
    assets.set_grain(Image::from_rgba8(crate::backdrop::grain_tile()));
    assets.set_still(still(dir, tone));
    for name in ICONS {
        set_icon(&assets, name, load(&format!("icons/{name}.svg")));
    }
}

/// Home's still frame in the theme's colour (docs/features/themes.md): the recorded file in Silver, recoloured like
/// the loop in Gold; empty when the file is missing or unreadable
pub fn still(dir: &Path, tone: Tone) -> Image {
    let image = Image::load_from_path(&dir.join("drape-still.jpg")).unwrap_or_default();
    if tone == Tone::Silver {
        return image;
    }
    let byte = |value: f32| value.round().clamp(0.0, 255.0) as u8;
    if let Some(mut pixels) = image.to_rgb8() {
        for pixel in pixels.make_mut_slice() {
            let [r, g, b] = tone.drape(f32::from(pixel.r), f32::from(pixel.g), f32::from(pixel.b));
            (pixel.r, pixel.g, pixel.b) = (byte(r), byte(g), byte(b));
        }
        return Image::from_rgb8(pixels);
    }
    if let Some(mut pixels) = image.to_rgba8() {
        for pixel in pixels.make_mut_slice() {
            let [r, g, b] = tone.drape(f32::from(pixel.r), f32::from(pixel.g), f32::from(pixel.b));
            (pixel.r, pixel.g, pixel.b) = (byte(r), byte(g), byte(b));
        }
        return Image::from_rgba8(pixels);
    }
    image
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_crate_ships_every_required_file() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
        assert_eq!(missing(&dir), Vec::<String>::new());
    }

    #[test]
    fn a_test_binary_finds_staged_assets_without_changing_installed_paths() {
        let root =
            std::env::temp_dir().join(format!("halation-assets-check-{}", std::process::id()));
        let profile = root.join("debug");
        let assets = profile.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        let exe = profile.join("deps").join("unit-tests.exe");
        assert_eq!(beside_executable(&exe), assets);
        assert_eq!(
            beside_executable(&profile.join("halation-slint.exe")),
            assets
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_empty_folder_reports_every_file() {
        let dir = std::env::temp_dir().join(format!("halation-no-assets-{}", std::process::id()));
        assert_eq!(missing(&dir).len(), required().len());
    }
}
