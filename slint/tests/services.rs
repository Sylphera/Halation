use halation_slint::catalog::{self, TOOLS};
use halation_slint::jobs::{JobRequest, JobsError, JobsService};
use halation_slint::library::{
    LibraryEntry, LibraryError, LibraryLoad, LibraryModel, LibraryStore, load_index, write_index,
};
use halation_slint::motion;
use halation_slint::navigation::{Navigation, Page};
use halation_slint::profile::{Profile, ProfileError, parse_args, resolve_root};
use halation_slint::settings::{
    MAX_SETTINGS_BYTES, Settings, SettingsError, SettingsRead, SettingsStore, read_settings,
};
use halation_slint::theme::{self, TEXT_PAIRS};
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
    ])
    .unwrap();
    assert_eq!(options.profile_root, Some(PathBuf::from("C:/test-profile")));
    assert!(options.print_profile);
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
    assert_eq!(read_settings(&path), SettingsRead::Loaded(next.clone()));

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
    assert_eq!(read_settings(&path), SettingsRead::Loaded(old));
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
    assert_eq!(
        read_settings(&path),
        SettingsRead::Loaded(Settings::default())
    );
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
fn catalog_has_eleven_entries_and_only_library_is_available() {
    assert_eq!(TOOLS.len(), 11);
    assert_eq!(TOOLS.iter().filter(|tool| tool.available).count(), 1);
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
    assert_eq!(motion::duration_ms(false), 160);
    assert_eq!(motion::duration_ms(true), 0);
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
fn library_model_maps_filtered_rows_without_filesystem_access() {
    let model = LibraryModel::new(10);
    model.replace_entries(vec![
        entry("a", "Z:/not-real/ambient.wav", "Ambient.wav", true),
        entry("b", "Z:/not-real/portrait.png", "Portrait.png", false),
    ]);
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
    model
        .add_entry(entry("a", "C:/ref/a.wav", "a.wav", false))
        .unwrap();
    assert_eq!(
        model.add_entry(entry("b", "c:/REF/A.wav", "A.wav", false)),
        Err(LibraryError::Duplicate)
    );
    assert!(matches!(
        model.add_entry(entry("c", "C:/ref/c.wav", "c.wav", false)),
        Err(LibraryError::Full { limit: 1 })
    ));
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

    let added = store.add_reference(&source).unwrap();
    let save = store.begin_save().unwrap();
    write_index(&save.path, &save.entries).unwrap();
    assert!(store.finish_save(save.generation, Ok(())));
    assert!(source.exists());

    let reopened_model = LibraryModel::new(10);
    let mut reopened = LibraryStore::new(&index_path, reopened_model.clone());
    reopened.apply_load(load_index(&index_path, 10));
    assert_eq!(reopened_model.entries().len(), 1);
    assert_eq!(reopened_model.entries()[0].display_name, "source.wav");
    assert!(!reopened_model.entries()[0].missing);

    reopened.remove_reference(&added.id).unwrap();
    assert!(
        source.exists(),
        "removing a reference must not delete its source"
    );
    let save = reopened.begin_save().unwrap();
    write_index(&save.path, &save.entries).unwrap();
    assert!(reopened.finish_save(save.generation, Ok(())));
    assert!(
        matches!(load_index(&index_path, 10), LibraryLoad::Loaded(entries) if entries.is_empty())
    );
}

#[test]
fn failed_library_save_rolls_back_to_committed_snapshot() {
    let temp = TestDir::new();
    let model = LibraryModel::new(10);
    let initial = entry("committed", "Z:/committed.wav", "committed.wav", true);
    let mut store = LibraryStore::new(temp.path().join("library.json"), model.clone());
    store.apply_load(LibraryLoad::Loaded(vec![initial.clone()]));
    model
        .add_entry(entry("new", "Z:/new.wav", "new.wav", true))
        .unwrap();
    let request = store.begin_save().unwrap();
    assert!(store.busy());
    assert!(store.finish_save(request.generation, Err("injected disk error".to_owned())));
    assert!(!store.busy());
    assert_eq!(model.entries(), vec![initial]);
    assert_eq!(store.error(), Some("injected disk error"));
}

#[test]
fn stale_library_save_result_is_ignored_and_generations_advance() {
    let temp = TestDir::new();
    let mut store = LibraryStore::new(temp.path().join("library.json"), LibraryModel::new(5));
    let first = store.begin_save().unwrap();
    assert!(!store.finish_save(first.generation + 1, Ok(())));
    assert!(store.busy());
    assert!(store.finish_save(first.generation, Ok(())));
    let second = store.begin_save().unwrap();
    assert!(second.generation > first.generation);
    store.cancel_pending();
    assert!(!store.busy());
    assert!(!store.finish_save(second.generation, Ok(())));
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
    assert!(store.begin_save().is_err());
    assert!(
        store
            .add_reference(&temp.path().join("never-read.wav"))
            .is_err()
    );
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
    model.replace_entries(vec![entry("x", "Z:/gone.wav", "gone.wav", false)]);
    model.apply_missing(&[("x".to_owned(), true)]);
    assert!(model.row_data(0).unwrap().missing);
    assert_eq!(model.missing_count(), 1);
}

#[test]
fn jobs_are_empty_and_submission_is_rejected_without_side_effects() {
    let mut jobs = JobsService::default();
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
