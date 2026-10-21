//! Library sections on disk: own sections, linked folders, packs and path checks.

use halation_app::backend::{
    names::unique_path,
    sections::{self, SectionOp},
};
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
        let path = std::env::temp_dir().join(format!(
            "halation-sections-test-{}-{id}",
            std::process::id()
        ));
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

fn touch(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

#[test]
fn own_sections_packs_and_linked_folders_are_listed_apart() {
    let t = TestDir::new();
    let root = t.path().join("Library");
    touch(&root.join("Covers/a.png"), b"x");
    touch(&root.join("Covers/notes.txt"), b"x");
    touch(&root.join("Packs/Grain/g.webp"), b"x");
    let linked = t.path().join("Photos");
    touch(&linked.join("p.jpg"), b"x");
    let gone = t.path().join("Gone");

    let listed = sections::list(&root, &[linked.clone(), gone.clone()]);
    assert_eq!(listed.own.len(), 1);
    assert_eq!(listed.own[0].name, "Covers");
    assert_eq!(listed.own[0].count, 1, "only media files count");
    assert_eq!(listed.packs[0].name, "Grain");
    assert_eq!(listed.linked[0].name, "Photos");
    assert!(!listed.linked[0].missing);
    assert!(listed.linked[1].missing && listed.linked[1].count == 0);
}

#[test]
fn sections_are_created_renamed_and_deleted_with_valid_names_only() {
    let t = TestDir::new();
    let root = t.path().join("Library");
    fs::create_dir_all(&root).unwrap();
    let created = sections::section_op(&root, SectionOp::Create("Covers")).unwrap();
    assert!(created.is_dir());
    assert_eq!(
        sections::section_op(&root, SectionOp::Create("Covers")),
        Err("exists".into())
    );
    assert!(sections::section_op(&root, SectionOp::Create("Packs")).is_err());
    assert!(sections::section_op(&root, SectionOp::Create("../escape")).is_err());
    assert!(sections::section_op(&root, SectionOp::Create("")).is_err());
    let renamed = sections::section_op(
        &root,
        SectionOp::Rename {
            from: "Covers",
            to: "Thumbs",
        },
    )
    .unwrap();
    assert!(renamed.is_dir() && !created.exists());
    sections::section_op(&root, SectionOp::Create("Other")).unwrap();
    assert_eq!(
        sections::section_op(
            &root,
            SectionOp::Rename {
                from: "Thumbs",
                to: "Other"
            }
        ),
        Err("exists".into())
    );
    sections::section_op(&root, SectionOp::Delete("Thumbs")).unwrap();
    assert!(!renamed.exists());
}

#[test]
fn items_are_media_only_and_newest_first() {
    let t = TestDir::new();
    let dir = t.path().join("S");
    touch(&dir.join("old.png"), b"1");
    touch(&dir.join("doc.txt"), b"1");
    std::thread::sleep(std::time::Duration::from_millis(30));
    touch(&dir.join("new.MP4"), b"12");
    let items = sections::items(&dir).unwrap();
    let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["new.MP4", "old.png"]);
    assert_eq!(items[0].size, 2);
}

#[test]
fn writes_get_a_free_name_and_only_media_is_accepted() {
    let t = TestDir::new();
    let root = t.path().join("Library");
    let first = sections::write_item(&root, "Covers", "cover.png", b"a").unwrap();
    let second = sections::write_item(&root, "Covers", "cover.png", b"b").unwrap();
    assert_eq!(first.file_name().unwrap(), "cover.png");
    assert_eq!(second.file_name().unwrap(), "cover (2).png");
    assert_eq!(fs::read(&second).unwrap(), b"b");
    assert!(sections::write_item(&root, "Covers", "x.exe", b"a").is_err());
    assert!(sections::write_item(&root, "A/B/C", "x.png", b"a").is_err());
    let pack = sections::write_item(&root, "Packs/Grain", "g.png", b"a").unwrap();
    assert!(pack.starts_with(root.join("Packs").join("Grain")));
    assert_eq!(unique_path(&root, "nothing.png"), root.join("nothing.png"));
}

#[test]
fn reading_is_limited_to_the_root_and_linked_folders() {
    let t = TestDir::new();
    let root = t.path().join("Library");
    let linked = t.path().join("Photos");
    let outside = t.path().join("Elsewhere");
    touch(&root.join("S/a.png"), b"x");
    touch(&linked.join("p.png"), b"x");
    touch(&outside.join("o.png"), b"x");
    let links = [linked.clone()];
    assert!(sections::readable(&root, &links, &root.join("S/a.png")).is_ok());
    assert!(sections::readable(&root, &links, &linked.join("p.png")).is_ok());
    assert!(sections::readable(&root, &links, &outside.join("o.png")).is_err());
    let escape = root.join("S").join("..").join("..").join("Elsewhere/o.png");
    assert!(sections::readable(&root, &links, &escape).is_err());
    assert_eq!(
        sections::readable(&root, &links, &root.join("S/missing.png")),
        Err("the file no longer exists".into())
    );
}

#[test]
fn removal_only_touches_items_of_own_sections() {
    let t = TestDir::new();
    let root = t.path().join("Library");
    let linked = t.path().join("Photos");
    let own = sections::write_item(&root, "Covers", "a.png", b"x").unwrap();
    let pack = sections::write_item(&root, "Packs/Grain", "g.png", b"x").unwrap();
    touch(&linked.join("p.png"), b"x");
    assert!(sections::remove_item(&root, &pack).is_err());
    assert!(sections::remove_item(&root, &linked.join("p.png")).is_err());
    assert!(pack.exists() && linked.join("p.png").exists());
    sections::remove_item(&root, &own).unwrap();
    assert!(!own.exists());
    sections::remove_pack(&root, "Grain").unwrap();
    assert!(!pack.exists());
    assert!(sections::remove_pack(&root, "../x").is_err());
}
