use halation_app::catalog::{self, TOOLS};
use halation_app::library::{
    LibraryEntry, LibraryError, LibraryLoad, LibraryModel, LibraryStore, SaveCompletion,
    load_index, scan_reference, write_index,
};
use halation_app::motion;
use halation_app::navigation::{Navigation, Page};
use halation_app::profile::{DiagnosticScene, Profile, ProfileError, parse_args, resolve_root};
use halation_app::theme::{self, TEXT_PAIRS, Tone};
use halation_core::atomic_file::write_atomic_new;
use halation_core::jobs::{JobRequest, JobsError, JobsService};
use halation_core::settings::{
    MAX_SETTINGS_BYTES, Settings, SettingsError, SettingsRead, SettingsStore, read_settings,
};
use slint::Model;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

static TEST_ID: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let id = TEST_ID.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("halation-slint-test-{}-{id}", std::process::id()));
        fs::create_dir_all(&path).expect("create isolated test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn entry(id: &str, path: &str, name: &str, missing: bool) -> LibraryEntry {
    LibraryEntry {
        id: id.to_owned(),
        path: path.to_owned(),
        display_name: name.to_owned(),
        missing,
        added_at: 1,
    }
}

#[test]
fn profile_precedence_and_argument_parsing_are_explicit() {
    let cli = PathBuf::from("C:/isolated/cli");
    let resolved = resolve_root(
        Some(cli.clone()),
        Some(OsString::from("C:/isolated/env")),
        Some(OsString::from("C:/Users/test/AppData/Local")),
    )
    .unwrap();
    assert_eq!(resolved, cli);

    let from_env = resolve_root(
        None,
        Some(OsString::from("C:/isolated/env")),
        Some(OsString::from("C:/Users/test/AppData/Local")),
    )
    .unwrap();
    assert_eq!(from_env, PathBuf::from("C:/isolated/env"));

    let default = resolve_root(
        None,
        None,
        Some(OsString::from("C:/Users/test/AppData/Local")),
    )
    .unwrap();
    assert_eq!(
        default,
        PathBuf::from("C:/Users/test/AppData/Local/Halation/slint-beta")
    );

    let options = parse_args([
        "--profile-root".to_owned(),
        "C:/test-profile".to_owned(),
        "--print-profile".to_owned(),
        "--diagnostic-scene".to_owned(),
        "cycle".to_owned(),
    ])
    .unwrap();
    assert_eq!(options.profile_root, Some(PathBuf::from("C:/test-profile")));
    assert!(options.print_profile);
    assert_eq!(options.diagnostic_scene, Some(DiagnosticScene::Cycle));
    assert_eq!(
        parse_args(["--diagnostic-scene=empty".to_owned()])
            .unwrap()
            .diagnostic_scene,
        Some(DiagnosticScene::Empty)
    );
    assert_eq!(
        parse_args(["--diagnostic-scene".to_owned(), "home".to_owned()])
            .unwrap()
            .diagnostic_scene,
        Some(DiagnosticScene::Home)
    );
    assert!(matches!(
        parse_args(["--diagnostic-scene=continuous".to_owned()]),
        Err(ProfileError::InvalidDiagnosticScene(_))
    ));
    assert!(matches!(
        parse_args(["--diagnostic-scene".to_owned()]),
        Err(ProfileError::MissingValue(value)) if value == "--diagnostic-scene"
    ));
    assert_eq!(
        parse_args(["--profile-root".to_owned()]),
        Err(ProfileError::MissingValue("--profile-root".to_owned()))
    );
    assert!(matches!(
        parse_args(["--profile-root=".to_owned()]),
        Err(ProfileError::EmptyPath)
    ));
    assert!(matches!(
        resolve_root(None, None, None),
        Err(ProfileError::NoLocalAppData)
    ));
}

#[test]
fn profile_paths_are_confined_to_the_explicit_root() {
    let temp = TestDir::new();
    let profile = Profile::at(temp.path());
    assert_eq!(profile.settings_path(), temp.path().join("settings.json"));
    assert_eq!(profile.library_path(), temp.path().join("library.json"));
    assert!(profile.ensure().is_ok());
}

#[test]
fn create_new_atomic_write_never_overwrites_an_existing_path() {
    let temp = TestDir::new();
    let target = temp.path().join("settings.json");
    let foreign = b"external settings change";
    fs::write(&target, foreign).unwrap();

    let error = write_atomic_new(&target, b"defaults").unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read(&target).unwrap(), foreign);

    let new_target = temp.path().join("new/settings.json");
    write_atomic_new(&new_target, b"defaults").unwrap();
    assert_eq!(fs::read(new_target).unwrap(), b"defaults");
}

#[test]
fn settings_missing_file_defaults_then_atomic_save_reopens() {
    let temp = TestDir::new();
    let path = temp.path().join("profile/settings.json");
    assert_eq!(read_settings(&path), SettingsRead::Missing);

    let mut store = SettingsStore::load(&path);
    assert_eq!(store.current(), &Settings::default());
    assert!(!store.is_locked());

    let next = Settings {
        reduced_motion: true,
        library_limit: 3_000,
        ..Settings::default()
    };
    store.save(next.clone()).unwrap();
    assert_eq!(store.current(), &next);
    assert_eq!(
        read_settings(&path),
        SettingsRead::Loaded(Box::new(next.clone()))
    );

    let reopened = SettingsStore::load(&path);
    assert_eq!(reopened.current(), &next);
    assert!(!reopened.is_locked());
}

#[test]
fn failed_settings_write_keeps_old_memory_and_disk_snapshot() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    let mut store = SettingsStore::load(&path);
    let old = Settings {
        reduced_motion: false,
        library_limit: 1_500,
        ..Settings::default()
    };
    store.save(old.clone()).unwrap();
    let mut store = SettingsStore::load(&path);
    let attempted = Settings {
        reduced_motion: true,
        ..old.clone()
    };

    let result = store.save_with(attempted, |_path, _bytes| {
        Err(io::Error::other("injected write failure"))
    });
    assert!(matches!(result, Err(SettingsError::Io(_))));
    assert_eq!(store.current(), &old);
    assert!(store.error().is_some());
    assert_eq!(read_settings(&path), SettingsRead::Loaded(Box::new(old)));
}

#[test]
fn invalid_or_corrupt_settings_fail_closed_until_explicit_reset() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    fs::write(&path, b"{ broken").unwrap();

    let mut store = SettingsStore::load(&path);
    assert!(store.is_locked());
    assert!(matches!(
        store.save(Settings::default()),
        Err(SettingsError::Locked(_))
    ));
    store.reset().unwrap();
    assert!(!store.is_locked());
    assert_eq!(store.current(), &Settings::default());
    assert_eq!(read_settings(&path), SettingsRead::Loaded(Box::default()));
    assert!(fs::read_dir(temp.path()).unwrap().any(|item| {
        item.unwrap()
            .file_name()
            .to_string_lossy()
            .contains("reset-")
    }));

    let invalid_path = temp.path().join("invalid.json");
    let invalid = Settings {
        library_limit: 99,
        ..Settings::default()
    };
    fs::write(&invalid_path, serde_json::to_vec(&invalid).unwrap()).unwrap();
    assert!(matches!(
        read_settings(&invalid_path),
        SettingsRead::Corrupt(_)
    ));
}

#[test]
fn failed_settings_reset_preserves_live_corrupt_bytes_and_backup() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    let corrupt = b"{ corrupt but preserved";
    fs::write(&path, corrupt).unwrap();

    let mut store = SettingsStore::load(&path);
    assert!(store.is_locked());
    let result = store
        .reset_with(|_path, _defaults| Err(io::Error::other("injected defaults write failure")));

    assert!(matches!(result, Err(SettingsError::Io(_))));
    assert!(store.is_locked());
    assert_eq!(store.current(), &Settings::default());
    assert!(store.error().unwrap().contains("reset failed"));
    assert_eq!(fs::read(&path).unwrap(), corrupt);

    let backup = fs::read_dir(temp.path())
        .unwrap()
        .map(Result::unwrap)
        .map(|item| item.path())
        .find(|candidate| {
            candidate
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains("reset-")
        })
        .expect("corrupt settings backup remains available");
    assert_eq!(fs::read(backup).unwrap(), corrupt);
}

#[test]
fn failed_settings_reset_preserves_valid_memory_and_live_bytes() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    let previous = Settings {
        reduced_motion: true,
        library_limit: 1_700,
        ..Settings::default()
    };
    let previous_bytes = serde_json::to_vec_pretty(&previous).unwrap();
    fs::write(&path, &previous_bytes).unwrap();

    let mut store = SettingsStore::load(&path);
    assert!(!store.is_locked());
    assert_eq!(store.current(), &previous);
    let result =
        store.reset_with(|_path, _defaults| Err(io::Error::other("injected reset failure")));

    assert!(matches!(result, Err(SettingsError::Io(_))));
    assert!(store.is_locked());
    assert_eq!(store.current(), &previous);
    assert!(store.error().unwrap().contains("reset failed"));
    assert_eq!(fs::read(&path).unwrap(), previous_bytes);
}

#[test]
fn failed_settings_reset_never_overwrites_a_foreign_live_path() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    let previous = Settings {
        reduced_motion: false,
        library_limit: 1_400,
        ..Settings::default()
    };
    let previous_bytes = serde_json::to_vec_pretty(&previous).unwrap();
    let foreign_bytes = b"external settings replacement";
    fs::write(&path, &previous_bytes).unwrap();

    let mut store = SettingsStore::load(&path);
    let result = store.reset_with(|live_path, _defaults| {
        // Simulate an outside replacement between backup creation and a failed write.
        fs::write(live_path, foreign_bytes)?;
        Err(io::Error::other("injected race/write failure"))
    });

    assert!(matches!(result, Err(SettingsError::Io(_))));
    assert!(store.is_locked());
    assert_eq!(store.current(), &previous);
    assert_eq!(fs::read(&path).unwrap(), foreign_bytes);
    assert!(store.error().unwrap().contains("reset failed"));
    let backup = fs::read_dir(temp.path())
        .unwrap()
        .map(Result::unwrap)
        .map(|item| item.path())
        .find(|candidate| {
            candidate
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains("reset-")
        })
        .expect("pre-reset bytes remain in the backup");
    assert_eq!(fs::read(backup).unwrap(), previous_bytes);
}

#[test]
fn oversized_settings_are_rejected_and_values_are_bounded() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    fs::write(&path, vec![b' '; MAX_SETTINGS_BYTES as usize + 1]).unwrap();
    let store = SettingsStore::load(&path);
    assert!(store.is_locked());
    assert!(store.error().unwrap().contains("limit"));

    let invalid = Settings {
        library_limit: 5_001,
        ..Settings::default()
    };
    assert!(matches!(invalid.validate(), Err(SettingsError::Invalid(_))));
}

#[test]
fn catalog_has_eleven_entries_and_library_and_converter_are_available() {
    assert_eq!(TOOLS.len(), 11);
    assert_eq!(TOOLS.iter().filter(|tool| tool.available).count(), 2);
    assert!(catalog::tool("converter").unwrap().available);
    assert!(catalog::tool("library").unwrap().available);
    assert!(!catalog::tool("downloader").unwrap().available);
    assert!(catalog::activation_notice("downloader").contains("not available"));
    assert_eq!(
        TOOLS
            .iter()
            .map(|tool| tool.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        TOOLS.len()
    );
}

#[test]
fn navigation_same_target_is_a_noop_and_all_pages_round_trip() {
    let mut navigation = Navigation::default();
    assert_eq!(navigation.current(), Page::Home);
    assert!(!navigation.select(Page::Home));
    assert!(navigation.select(Page::Library));
    assert!(!navigation.select(Page::Library));
    assert!(navigation.select(Page::Jobs));
    assert!(navigation.select(Page::Settings));
    for page in Page::ALL {
        assert_eq!(Page::from_index(page.index()), Some(page));
    }
    assert_eq!(Page::from_index(-1), None);
}

#[test]
fn reduced_motion_resolves_deterministically_to_zero_duration() {
    use std::time::Duration;
    let normal = motion::tokens(false);
    let reduced = motion::tokens(true);
    // Short motion, about as fast as the pointer: nothing over 120 ms (a spring settles later, in about 1.5 times its
    // period)
    for d in [
        normal.hover_in,
        normal.hover_out,
        normal.release,
        normal.glide,
        normal.trail,
        normal.fade,
        normal.panel,
    ] {
        assert!(d > Duration::ZERO && d <= Duration::from_millis(120));
    }
    assert!(normal.hover_in < normal.hover_out, "fast in, soft out");
    assert!(normal.glide < normal.trail, "a moving pill stretches");
    assert!(normal.press_scale < 100.0);
    // The dock's light keeps the original strip's 320 ms reveal (docs/features/motion.md §4.4), longer than the rest
    assert_eq!(normal.dock_light, Duration::from_millis(320));
    for d in [
        reduced.hover_in,
        reduced.hover_out,
        reduced.release,
        reduced.glide,
        reduced.trail,
        reduced.fade,
        reduced.panel,
        reduced.dock_light,
    ] {
        assert_eq!(d, Duration::ZERO);
    }
    assert_eq!(reduced.press_scale, 100.0, "nothing scales");
    assert_eq!(
        reduced.tip_wait, normal.tip_wait,
        "a tooltip's wait is not motion"
    );
}

/// The cost rules of docs/features/motion.md §2, read from the UI's sources: every animation takes its duration from
/// the `Motion` tokens (or is instant), none waits with `delay` or repeats, none fades a container's `opacity`, and only
/// the sidebar animates a size
#[test]
fn every_animation_follows_the_motion_cost_rules() {
    fn files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                files(&path, out);
            } else if path.extension().is_some_and(|e| e == "slint") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    files(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ui"),
        &mut paths,
    );
    assert!(!paths.is_empty());
    let mut broken = Vec::new();
    for path in paths {
        let source = std::fs::read_to_string(&path).unwrap();
        for (n, line) in source.lines().enumerate() {
            let line = line.trim();
            if line.starts_with("//") {
                continue;
            }
            let at = format!("{}:{}", path.file_name().unwrap().to_string_lossy(), n + 1);
            if line.contains("delay:") || line.contains("iteration-count") {
                broken.push(format!("{at}: waits or repeats"));
            }
            // Slint 1.18: the shorthand with animated axes binds neither axis, so the element scales to 0 under Skia
            if line.starts_with("transform-scale:") {
                broken.push(format!("{at}: transform-scale shorthand, set -x and -y"));
            }
            let Some(rest) = line.strip_prefix("animate ") else {
                continue;
            };
            let properties = rest.split('{').next().unwrap_or_default();
            let body = rest.split('{').nth(1).unwrap_or_default();
            // `hover-lead` is the hover pill's glide, set from `Motion.glide` and the pointer's pace
            if !body.contains("Motion.") && !body.contains("root.hover-lead") {
                broken.push(format!("{at}: duration not from Motion"));
            }
            if !body.contains("Curve.ease") && !body.contains("spring(0)") {
                broken.push(format!("{at}: curve not Curve.ease or spring(0)"));
            }
            if properties.contains("opacity") {
                broken.push(format!("{at}: animates opacity"));
            }
            let sizes = properties
                .split(',')
                .map(str::trim)
                .any(|p| p == "width" || p == "height");
            if sizes || (properties.trim() != "side" && properties.contains("side")) {
                broken.push(format!("{at}: animates a size"));
            }
        }
    }
    assert!(broken.is_empty(), "{broken:#?}");
}

#[test]
fn applied_theme_text_pairs_meet_wcag_contrast_threshold() {
    for (name, foreground, background) in TEXT_PAIRS {
        assert!(
            theme::contrast_ratio(foreground, background) >= 4.5,
            "{name} contrast was {}",
            theme::contrast_ratio(foreground, background)
        );
    }
}

#[test]
fn every_theme_and_accent_hue_meets_wcag_contrast() {
    assert_eq!(theme::colours(Tone::Silver, None), theme::SILVER);
    for tone in [Tone::Silver, Tone::Gold] {
        let hues = std::iter::once(None).chain((0..360).step_by(5).map(Some));
        for hue in hues {
            let colours = theme::colours(tone, hue);
            for (name, foreground, background) in theme::text_pairs(&colours) {
                let ratio = theme::contrast_ratio(foreground, background);
                assert!(
                    ratio >= 4.5,
                    "{tone:?} {hue:?}: {name} contrast was {ratio}"
                );
            }
        }
    }
}

#[test]
fn library_model_maps_filtered_rows_without_filesystem_access() {
    let model = LibraryModel::new(10);
    let mut store = LibraryStore::new("unused/library.json", model.clone());
    store.apply_load(LibraryLoad::Loaded(vec![
        entry("a", "Z:/not-real/ambient.wav", "Ambient.wav", true),
        entry("b", "Z:/not-real/portrait.png", "Portrait.png", false),
    ]));
    assert_eq!(model.row_count(), 2);
    model.set_query("PORTRAIT");
    assert_eq!(model.row_count(), 1);
    let row = model.row_data(0).unwrap();
    assert_eq!(row.id.as_str(), "b");
    assert_eq!(row.name.as_str(), "Portrait.png");
    assert_eq!(row.path.as_str(), "Z:/not-real/portrait.png");
    assert!(!row.missing);
    assert_eq!(model.visible_indices(), vec![1]);
    assert_eq!(model.missing_count(), 1);
}

#[test]
fn library_bounds_and_duplicate_paths_are_enforced() {
    let model = LibraryModel::new(1);
    let mut store = LibraryStore::new("unused/library.json", model.clone());
    let existing = entry("a", "C:/ref/a.wav", "a.wav", false);
    store.apply_load(LibraryLoad::Loaded(vec![existing.clone()]));
    assert!(matches!(
        store.stage_add_entries(vec![entry("b", "c:/REF/A.wav", "A.wav", false)]),
        Err(LibraryError::Duplicate)
    ));
    assert!(matches!(
        store.stage_add_entries(vec![entry("c", "C:/ref/c.wav", "c.wav", false)]),
        Err(LibraryError::Full { limit: 1 })
    ));
    assert_eq!(model.entries(), vec![existing]);
}

#[test]
fn library_add_remove_never_deletes_original_and_reopens_persisted_index() {
    let temp = TestDir::new();
    let source = temp.path().join("source.wav");
    fs::write(&source, b"synthetic test content").unwrap();
    let index_path = temp.path().join("profile/library.json");
    let model = LibraryModel::new(10);
    let mut store = LibraryStore::new(&index_path, model.clone());
    store.apply_load(LibraryLoad::Missing);

    let added = scan_reference(&source).unwrap();
    model.set_query("source");
    let save = store.stage_add_entries(vec![added.clone()]).unwrap();
    assert!(store.busy());
    assert!(store.committed().is_empty());
    assert!(
        model.is_empty(),
        "candidate must remain private while saving"
    );
    assert_eq!(model.row_count(), 0);
    assert!(model.recent_entries(3).is_empty());
    write_index(&save.path, &save.entries).unwrap();
    assert_eq!(
        store.finish_save(save.generation, Ok(())),
        SaveCompletion::Committed
    );
    assert!(!store.busy());
    assert_eq!(store.committed().len(), 1);
    assert_eq!(model.len(), 1);
    assert_eq!(model.row_count(), 1, "commit reapplies the active filter");
    assert_eq!(model.recent_entries(3)[0].id, added.id);
    assert!(source.exists());

    let reopened_model = LibraryModel::new(10);
    let mut reopened = LibraryStore::new(&index_path, reopened_model.clone());
    reopened.apply_load(load_index(&index_path, 10));
    assert_eq!(reopened_model.entries().len(), 1);
    assert_eq!(reopened_model.entries()[0].display_name, "source.wav");
    assert!(!reopened_model.entries()[0].missing);

    let remove = reopened.stage_remove_reference(&added.id).unwrap();
    assert_eq!(reopened.committed().len(), 1);
    assert_eq!(reopened_model.len(), 1, "remove is private until commit");
    assert_eq!(reopened_model.recent_entries(3).len(), 1);
    assert!(reopened.busy());
    assert!(
        reopened
            .stage_add_entries(vec![entry(
                "concurrent",
                "Z:/concurrent.wav",
                "concurrent.wav",
                true
            )])
            .is_err()
    );
    assert!(
        source.exists(),
        "removing a reference must not delete its source"
    );
    write_index(&remove.path, &remove.entries).unwrap();
    assert_eq!(
        reopened.finish_save(remove.generation, Ok(())),
        SaveCompletion::Committed
    );
    assert!(reopened.committed().is_empty());
    assert!(reopened_model.is_empty());
    assert!(reopened_model.recent_entries(3).is_empty());
    assert!(
        matches!(load_index(&index_path, 10), LibraryLoad::Loaded(entries) if entries.is_empty())
    );
}

#[test]
fn failed_add_and_remove_saves_keep_disk_and_visible_committed_snapshot() {
    let temp = TestDir::new();
    let model = LibraryModel::new(10);
    let initial = entry("committed", "Z:/committed.wav", "committed.wav", true);
    let index_path = temp.path().join("library.json");
    write_index(&index_path, std::slice::from_ref(&initial)).unwrap();
    let disk_before = fs::read(&index_path).unwrap();
    let mut store = LibraryStore::new(&index_path, model.clone());
    store.apply_load(LibraryLoad::Loaded(vec![initial.clone()]));
    model.set_query("committed");

    let request = store
        .stage_add_entries(vec![entry("new", "Z:/new.wav", "new.wav", true)])
        .unwrap();
    assert!(store.busy());
    assert_eq!(store.committed(), std::slice::from_ref(&initial));
    assert_eq!(model.entries(), vec![initial.clone()]);
    assert_eq!(model.len(), 1);
    assert_eq!(model.row_count(), 1);
    assert_eq!(model.recent_entries(3), vec![initial.clone()]);
    assert!(matches!(
        store.stage_remove_reference("committed"),
        Err(LibraryError::Busy)
    ));
    assert_eq!(
        store.finish_save(request.generation, Err("injected disk error".to_owned())),
        SaveCompletion::Failed
    );
    assert!(!store.busy());
    assert_eq!(store.committed(), std::slice::from_ref(&initial));
    assert_eq!(model.entries(), vec![initial.clone()]);
    assert_eq!(fs::read(&index_path).unwrap(), disk_before);
    assert_eq!(store.error(), Some("injected disk error"));

    let request = store.stage_remove_reference("committed").unwrap();
    assert_eq!(store.committed(), std::slice::from_ref(&initial));
    assert_eq!(model.entries(), vec![initial.clone()]);
    assert_eq!(model.row_count(), 1);
    assert!(matches!(
        store.stage_add_entries(vec![entry("other", "Z:/other.wav", "other.wav", true)]),
        Err(LibraryError::Busy)
    ));
    assert_eq!(
        store.finish_save(
            request.generation,
            Err("injected remove failure".to_owned())
        ),
        SaveCompletion::Failed
    );
    assert_eq!(model.entries(), vec![initial]);
    assert_eq!(fs::read(&index_path).unwrap(), disk_before);
}

#[test]
fn stale_library_save_result_is_ignored_and_generations_advance() {
    let temp = TestDir::new();
    let model = LibraryModel::new(5);
    let mut store = LibraryStore::new(temp.path().join("library.json"), model.clone());
    let committed = entry("old", "Z:/old.wav", "old.wav", true);
    store.apply_load(LibraryLoad::Loaded(vec![committed.clone()]));
    let candidate = entry("new", "Z:/new.wav", "new.wav", true);
    let first = store.stage_add_entries(vec![candidate]).unwrap();
    assert_eq!(model.entries(), vec![committed.clone()]);
    assert_eq!(
        store.finish_save(first.generation + 1, Ok(())),
        SaveCompletion::Stale
    );
    assert!(store.busy());
    assert_eq!(model.entries(), vec![committed]);
    assert_eq!(
        store.finish_save(first.generation, Ok(())),
        SaveCompletion::Committed
    );
    let second = store
        .stage_remove_reference("new")
        .expect("new candidate is committed after the matching callback");
    assert!(second.generation > first.generation);
    assert_eq!(model.len(), 2);
}

#[test]
fn corrupt_and_oversized_library_indexes_fail_closed() {
    let temp = TestDir::new();
    let corrupt_path = temp.path().join("corrupt.json");
    fs::write(&corrupt_path, b"{ invalid").unwrap();
    let model = LibraryModel::new(10);
    let mut store = LibraryStore::new(&corrupt_path, model.clone());
    let load = load_index(&corrupt_path, 10);
    assert!(matches!(load, LibraryLoad::Corrupt(_)));
    store.apply_load(load);
    assert!(!store.writable());
    assert!(
        store
            .stage_add_entries(vec![entry("x", "Z:/never.wav", "never.wav", true)])
            .is_err()
    );
    assert!(store.stage_remove_reference("x").is_err());
    assert!(model.is_empty());

    let large_path = temp.path().join("large.json");
    fs::write(&large_path, vec![b' '; 4 * 1024 * 1024 + 1]).unwrap();
    assert!(matches!(
        load_index(&large_path, 10),
        LibraryLoad::Corrupt(_)
    ));
}

#[test]
fn library_writer_rejects_oversized_serialized_indexes() {
    let temp = TestDir::new();
    let path = temp.path().join("profile/library.json");
    let oversized = entry(
        "large",
        "Z:/not-real.wav",
        &"x".repeat(4 * 1024 * 1024),
        true,
    );
    let error = write_index(&path, &[oversized]).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(!path.exists());
}

#[test]
fn metadata_refresh_updates_cached_rows_only() {
    let model = LibraryModel::new(5);
    let mut store = LibraryStore::new("unused/library.json", model.clone());
    store.apply_load(LibraryLoad::Loaded(vec![entry(
        "x",
        "Z:/gone.wav",
        "gone.wav",
        false,
    )]));
    model.apply_missing(&[("x".to_owned(), true)]);
    assert!(model.row_data(0).unwrap().missing);
    assert_eq!(model.missing_count(), 1);
}

#[test]
fn jobs_are_empty_and_submission_is_rejected_without_side_effects() {
    let jobs = JobsService::default();
    assert!(jobs.jobs().is_empty());
    assert!(
        jobs.submit(JobRequest {
            tool: "converter".to_owned(),
            description: "synthetic test request".to_owned(),
        })
        .is_err_and(|error| error == JobsError::NoEngine)
    );
    assert!(jobs.jobs().is_empty());
    assert!(jobs.capability().contains("disconnected"));
}

#[test]
fn finite_library_worker_returns_ack_without_ui_or_external_processes() {
    let temp = TestDir::new();
    let index = temp.path().join("library.json");
    let entries = vec![entry("x", "Z:/not-real.wav", "not-real.wav", true)];
    let worker_path = index.clone();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::Builder::new()
        .name("test-library-save".to_owned())
        .spawn(move || {
            let result = write_index(&worker_path, &entries).map_err(|error| error.to_string());
            tx.send(result).expect("test receiver remains alive");
        })
        .unwrap();
    assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap().is_ok());
    worker.join().expect("finite worker completed");
    assert!(matches!(load_index(&index, 10), LibraryLoad::Loaded(_)));
}

#[test]
fn settings_page_values_change_one_at_a_time_and_stay_bounded() {
    let base = Settings::default();
    let next = base.with_pref("dock-mode", "2").unwrap();
    assert_eq!(next.dock_mode, 2);
    assert!(!next.with_pref("show-dock", "0").unwrap().show_dock);
    assert_eq!(base.with_pref("artist", "  Nova ").unwrap().artist, "Nova");
    assert!(
        base.with_pref("dock-mode", "3").is_err(),
        "a choice past the list"
    );
    assert!(base.with_pref("budget", "x").is_err());
    assert!(base.with_pref("show-dock", "maybe").is_err());
    assert!(base.with_pref("no-such-setting", "1").is_err());
    assert!(base.with_pref("artist", &"a".repeat(301)).is_err());
    // Themes: Silver by default, Gold, an accent hue or the theme's own (360)
    assert_eq!((base.theme, base.accent_hue), (0, 360));
    assert_eq!(base.with_pref("theme", "1").unwrap().theme, 1);
    assert!(base.with_pref("theme", "2").is_err(), "no third theme");
    let hued = base.with_pref("accent-hue", "150").unwrap();
    assert_eq!(hued.accent_hue, 150);
    assert_eq!(hued.with_pref("accent-hue", "360").unwrap().accent_hue, 360);
    assert!(base.with_pref("accent-hue", "361").is_err());
    assert!(base.with_pref("accent-hue", "-5").is_err());

    let off = base.with_tool("grade", false).unwrap();
    assert!(!off.tool_enabled("grade"));
    assert!(off.tool_enabled("upscale"));
    let on = off.with_tool("grade", true).unwrap();
    assert!(on.tool_enabled("grade"));
    assert_eq!(on.disabled_tools, Vec::<String>::new());
}

#[test]
fn an_older_settings_file_loads_with_the_new_values_at_their_defaults() {
    let temp = TestDir::new();
    let path = temp.path().join("settings.json");
    fs::write(
        &path,
        br#"{"schema_version":1,"reduced_motion":true,"library_limit":1500}"#,
    )
    .unwrap();
    let SettingsRead::Loaded(settings) = read_settings(&path) else {
        panic!("an older file must load");
    };
    assert!(settings.reduced_motion);
    assert_eq!(settings.library_limit, 1500);
    assert!(settings.show_dock);
    assert_eq!(settings.dock_mode, 1);
    assert_eq!(settings.video_template, "{title}");
}

#[test]
fn settings_search_finds_the_section_that_holds_the_words() {
    assert_eq!(catalog::settings_section("Dock"), Some(0));
    assert_eq!(catalog::settings_section("open window"), Some(1));
    assert_eq!(catalog::settings_section("ffmpeg"), Some(5));
    assert_eq!(catalog::settings_section("accent colour"), Some(1));
    assert_eq!(catalog::settings_section("changelog"), Some(7));
    assert_eq!(catalog::settings_section("   "), None);
    assert_eq!(catalog::settings_section("zzz"), None);
}

#[test]
fn media_kind_names_files_by_extension() {
    use halation_app::library::media_kind;
    assert_eq!(media_kind("C:/Music/Night Drive.FLAC"), "Audio");
    assert_eq!(media_kind("cover-final.png"), "Image");
    assert_eq!(media_kind("teaser.mp4"), "Video");
    assert_eq!(media_kind("notes.txt"), "File");
    assert_eq!(media_kind("no-extension"), "File");
}
