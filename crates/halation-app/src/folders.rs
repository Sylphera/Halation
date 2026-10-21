//! The Library's sections as the page sees them: the user's own sections, folders of the PC linked as sections and
//! the optional packs (`backend::sections`), plus the list of linked folders the profile remembers (`links.json`).
//! Every command returns a fresh view; the controller runs commands off the UI thread. The reference index
//! (`crate::library`) is separate and untouched.

use crate::atomic_file::write_atomic;
use crate::backend::sections::{self, Item, SectionOp, Sections};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const LINKS_VERSION: u32 = 1;
/// A section shows at most this many items; the rest is counted, not listed
pub const ITEM_LIMIT: usize = 500;

#[derive(Serialize, Deserialize)]
struct LinksFile {
    version: u32,
    links: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Own,
    Linked,
    Pack,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Own => "own",
            Self::Linked => "linked",
            Self::Pack => "pack",
        }
    }
}

/// A section as a list row. `id` is `own:<name>` / `pack:<name>` / `linked:<path>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionEntry {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub count: u64,
    pub missing: bool,
}

#[derive(Debug, Clone)]
pub enum Command {
    Refresh,
    Select(String),
    Create(String),
    Rename { id: String, to: String },
    Delete(String),
    Link(PathBuf),
    Unlink(String),
}

#[derive(Debug, Clone, Default)]
pub struct View {
    pub sections: Vec<SectionEntry>,
    pub selected: Option<String>,
    pub items: Vec<Item>,
    /// Items beyond `ITEM_LIMIT` in the selected section
    pub hidden_items: u64,
    pub notice: Option<String>,
}

pub struct FolderStore {
    root: PathBuf,
    links_path: PathBuf,
    links: Vec<PathBuf>,
    selected: Option<String>,
    /// The links file could not be read: links stay empty and are never overwritten
    links_error: Option<String>,
}

fn entries(listed: &Sections, links: &[PathBuf]) -> Vec<SectionEntry> {
    let own = listed.own.iter().map(|s| SectionEntry {
        id: format!("own:{}", s.name),
        name: s.name.clone(),
        kind: Kind::Own,
        count: s.count,
        missing: s.missing,
    });
    let linked = listed
        .linked
        .iter()
        .zip(links)
        .map(|(s, path)| SectionEntry {
            id: format!("linked:{}", path.display()),
            name: s.name.clone(),
            kind: Kind::Linked,
            count: s.count,
            missing: s.missing,
        });
    let packs = listed.packs.iter().map(|s| SectionEntry {
        id: format!("pack:{}", s.name),
        name: s.name.clone(),
        kind: Kind::Pack,
        count: s.count,
        missing: s.missing,
    });
    own.chain(linked).chain(packs).collect()
}

impl FolderStore {
    pub fn load(root: PathBuf, links_path: PathBuf) -> Self {
        let (links, links_error) = match std::fs::read(&links_path) {
            Ok(bytes) => match serde_json::from_slice::<LinksFile>(&bytes) {
                Ok(file) if file.version == LINKS_VERSION => (file.links, None),
                Ok(file) => (
                    Vec::new(),
                    Some(format!("unsupported links file version {}", file.version)),
                ),
                Err(error) => (Vec::new(), Some(format!("links file is damaged: {error}"))),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Vec::new(), None),
            Err(error) => (Vec::new(), Some(format!("could not read links: {error}"))),
        };
        Self {
            root,
            links_path,
            links,
            selected: None,
            links_error,
        }
    }

    fn save_links(&self) -> Result<(), String> {
        if let Some(error) = &self.links_error {
            return Err(format!("links are read-only: {error}"));
        }
        let file = LinksFile {
            version: LINKS_VERSION,
            links: self.links.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
        write_atomic(&self.links_path, &bytes).map_err(|e| e.to_string())
    }

    fn dir_of(&self, id: &str) -> Option<PathBuf> {
        let (kind, rest) = id.split_once(':')?;
        match kind {
            "own" => Some(self.root.join(rest)),
            "pack" => Some(self.root.join("Packs").join(rest)),
            "linked" => self
                .links
                .iter()
                .find(|p| p.to_string_lossy() == rest)
                .cloned(),
            _ => None,
        }
    }

    fn apply(&mut self, command: Command) -> Result<Option<String>, String> {
        match command {
            Command::Refresh => Ok(None),
            Command::Select(id) => {
                self.selected = Some(id);
                Ok(None)
            }
            Command::Create(name) => {
                let name = name.trim();
                sections::section_op(&self.root, SectionOp::Create(name))
                    .map_err(|e| describe(&e, name))?;
                self.selected = Some(format!("own:{name}"));
                Ok(Some(format!("Section “{name}” created.")))
            }
            Command::Rename { id, to } => {
                let from = id
                    .strip_prefix("own:")
                    .ok_or("only your own sections can be renamed")?;
                let to = to.trim();
                sections::section_op(&self.root, SectionOp::Rename { from, to })
                    .map_err(|e| describe(&e, to))?;
                self.selected = Some(format!("own:{to}"));
                Ok(Some("Section renamed.".to_owned()))
            }
            Command::Delete(id) => {
                let name = id
                    .strip_prefix("own:")
                    .ok_or("only your own sections can be deleted")?;
                sections::section_op(&self.root, SectionOp::Delete(name))?;
                if self.selected.as_deref() == Some(id.as_str()) {
                    self.selected = None;
                }
                Ok(Some(format!(
                    "Section “{name}” and its files were deleted."
                )))
            }
            Command::Link(path) => {
                if !path.is_dir() {
                    return Err("that is not a folder".to_owned());
                }
                let path = path.canonicalize().map_err(|e| e.to_string())?;
                let root = self
                    .root
                    .canonicalize()
                    .unwrap_or_else(|_| self.root.clone());
                if path.starts_with(&root) || root.starts_with(&path) {
                    return Err(
                        "the Library folder and its sections cannot be linked as a folder"
                            .to_owned(),
                    );
                }
                if self.links.contains(&path) {
                    return Err("that folder is already linked".to_owned());
                }
                self.links.push(path.clone());
                if let Err(error) = self.save_links() {
                    self.links.pop();
                    return Err(error);
                }
                self.selected = Some(format!("linked:{}", path.display()));
                Ok(Some(
                    "Folder linked. Its files stay where they are.".to_owned(),
                ))
            }
            Command::Unlink(id) => {
                let dir = self
                    .dir_of(&id)
                    .filter(|_| id.starts_with("linked:"))
                    .ok_or("that folder is not linked")?;
                let before = self.links.clone();
                self.links.retain(|p| *p != dir);
                if let Err(error) = self.save_links() {
                    self.links = before;
                    return Err(error);
                }
                if self.selected.as_deref() == Some(id.as_str()) {
                    self.selected = None;
                }
                Ok(Some(
                    "Folder unlinked. Nothing on disk was changed.".to_owned(),
                ))
            }
        }
    }

    /// Runs a command and describes the result; blocking disk work, to be called off the UI thread.
    pub fn run(&mut self, command: Command) -> View {
        let notice = match self.apply(command) {
            Ok(notice) => notice,
            Err(error) => Some(error),
        };
        let listed = sections::list(&self.root, &self.links);
        let rows = entries(&listed, &self.links);
        if let Some(id) = &self.selected
            && !rows.iter().any(|r| &r.id == id)
        {
            self.selected = None;
        }
        let (items, hidden_items) = match self.selected.as_deref().and_then(|id| self.dir_of(id)) {
            Some(dir) if dir.is_dir() => {
                let mut all = sections::items(&dir).unwrap_or_default();
                let hidden = all.len().saturating_sub(ITEM_LIMIT) as u64;
                all.truncate(ITEM_LIMIT);
                (all, hidden)
            }
            _ => (Vec::new(), 0),
        };
        View {
            sections: rows,
            selected: self.selected.clone(),
            items,
            hidden_items,
            notice: notice.or_else(|| self.links_error.clone()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Turns the backend's terse errors into a sentence for the notice
fn describe(error: &str, name: &str) -> String {
    if error == "exists" {
        format!("A section called “{name}” already exists.")
    } else {
        error.to_owned()
    }
}

/// "1.4 MB" style size for a row
pub fn size_label(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.0} KB", b / KB)
    } else if b < KB * KB * KB {
        format!("{:.1} MB", b / (KB * KB))
    } else {
        format!("{:.1} GB", b / (KB * KB * KB))
    }
}
