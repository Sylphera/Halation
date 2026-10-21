//! The Library sections service: own sections, linked folders that persist, packs, and refusals.

use halation_app::folders::{Command, FolderStore, Kind, size_label};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static ID: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let id = ID.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("halation-folders-test-{}-{id}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
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

fn touch(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"x").unwrap();
}

fn store(t: &TestDir) -> FolderStore {
    FolderStore::load(t.path().join("library"), t.path().join("links.json"))
}

#[test]
fn create_select_rename_and_delete_an_own_section() {
    let t = TestDir::new();
    let mut s = store(&t);
    let view = s.run(Command::Create(" Covers ".to_owned()));
    assert_eq!(view.selected.as_deref(), Some("own:Covers"));
    assert_eq!(view.sections[0].kind, Kind::Own);
    assert!(view.notice.unwrap().contains("created"));

    touch(&t.path().join("library/Covers/a.png"));
    touch(&t.path().join("library/Covers/notes.txt"));
    let view = s.run(Command::Select("own:Covers".to_owned()));
    assert_eq!(view.items.len(), 1);
    assert_eq!(view.sections[0].count, 1);

    let dup = s.run(Command::Create("Covers".to_owned()));
    assert!(dup.notice.unwrap().contains("already exists"));

    let view = s.run(Command::Rename {
        id: "own:Covers".to_owned(),
        to: "Posters".to_owned(),
    });
    assert_eq!(view.selected.as_deref(), Some("own:Posters"));
    assert_eq!(view.items.len(), 1);

    let view = s.run(Command::Delete("own:Posters".to_owned()));
    assert!(view.sections.is_empty());
    assert!(view.selected.is_none() && view.items.is_empty());
    assert!(!t.path().join("library/Posters").exists());
}

#[test]
fn invalid_names_and_the_packs_folder_are_refused() {
    let t = TestDir::new();
    let mut s = store(&t);
    for bad in ["", "..", "a/b", "Packs"] {
        let view = s.run(Command::Create(bad.to_owned()));
        assert!(view.notice.is_some(), "{bad:?} is refused");
        assert!(view.sections.is_empty());
    }
}

#[test]
fn packs_are_listed_and_read_only() {
    let t = TestDir::new();
    touch(&t.path().join("library/Packs/Grain/g.webp"));
    let mut s = store(&t);
    let view = s.run(Command::Select("pack:Grain".to_owned()));
    assert_eq!(view.sections[0].kind, Kind::Pack);
    assert_eq!(view.items.len(), 1);
    let view = s.run(Command::Delete("pack:Grain".to_owned()));
    assert!(view.notice.unwrap().contains("own sections"));
    assert!(t.path().join("library/Packs/Grain/g.webp").exists());
}

#[test]
fn linked_folders_persist_are_never_copied_and_unlinking_keeps_files() {
    let t = TestDir::new();
    let photos = t.path().join("Photos");
    touch(&photos.join("p.jpg"));
    {
        let mut s = store(&t);
        let view = s.run(Command::Link(photos.clone()));
        assert_eq!(view.sections[0].kind, Kind::Linked);
        assert_eq!(view.sections[0].name, "Photos");
        assert_eq!(view.items.len(), 1);
        let again = s.run(Command::Link(photos.clone()));
        assert!(again.notice.unwrap().contains("already linked"));
        assert_eq!(again.sections.len(), 1);
    }
    let mut s = store(&t);
    let view = s.run(Command::Refresh);
    assert_eq!(view.sections.len(), 1, "the link survives a restart");
    let id = view.sections[0].id.clone();
    let view = s.run(Command::Unlink(id));
    assert!(view.sections.is_empty());
    assert!(photos.join("p.jpg").exists());
    assert!(
        !t.path().join("library/Photos").exists(),
        "nothing was copied"
    );
}

#[test]
fn the_library_folder_cannot_be_linked_and_a_missing_link_is_listed_missing() {
    let t = TestDir::new();
    let mut s = store(&t);
    s.run(Command::Create("Covers".to_owned()));
    let view = s.run(Command::Link(t.path().join("library/Covers")));
    assert!(view.notice.unwrap().contains("cannot be linked"));
    let view = s.run(Command::Link(t.path().join("library")));
    assert!(view.notice.unwrap().contains("cannot be linked"));

    let gone = t.path().join("Gone");
    fs::create_dir_all(&gone).unwrap();
    s.run(Command::Link(gone.clone()));
    fs::remove_dir_all(&gone).unwrap();
    let view = s.run(Command::Refresh);
    assert!(
        view.sections
            .iter()
            .any(|r| r.kind == Kind::Linked && r.missing)
    );
}

#[test]
fn a_damaged_links_file_is_kept_and_nothing_overwrites_it() {
    let t = TestDir::new();
    fs::write(t.path().join("links.json"), b"{ not json").unwrap();
    let other = t.path().join("Other");
    fs::create_dir_all(&other).unwrap();
    let mut s = store(&t);
    let view = s.run(Command::Link(other));
    assert!(view.notice.unwrap().contains("read-only"));
    assert_eq!(
        fs::read(t.path().join("links.json")).unwrap(),
        b"{ not json"
    );
}

#[test]
fn sizes_read_naturally() {
    assert_eq!(size_label(12), "12 B");
    assert_eq!(size_label(2048), "2 KB");
    assert_eq!(size_label(5 * 1024 * 1024 + 300_000), "5.3 MB");
}
