//! "Open with": files passed on the command line, queued for the page.

use crate::paths::*;
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::Mutex,
};
use tauri::{
    ipc::Response,
    AppHandle, Manager, State,
};

pub(crate) const OPENABLE_EXT: [&str; 14] = [
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus",
];
/// Files received through "Open with": pending delivery and allowed to be read.
#[derive(Default)]
pub(crate) struct Opened {
    pub(crate) queue: Vec<PathBuf>,
    pub(crate) allowed: HashSet<PathBuf>,
}
pub(crate) struct OpenState(pub(crate) Mutex<Opened>);

/* ---------- "Open with" ---------- */

pub(crate) fn queue_paths<I: IntoIterator<Item = String>>(app: &AppHandle, args: I) -> usize {
    let st = app.state::<OpenState>();
    let mut o = hold(&st.0);
    let mut n = 0;
    for a in args {
        let p = PathBuf::from(&a);
        if p.is_file() && OPENABLE_EXT.contains(&ext_of(&a).as_str()) {
            let p = p.canonicalize().unwrap_or(p);
            o.allowed.insert(p.clone());
            o.queue.push(p);
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub(crate) fn take_open_files(st: State<'_, OpenState>) -> Vec<String> {
    hold(&st.0).queue.drain(..).map(|p| p.to_string_lossy().into_owned()).collect()
}

#[tauri::command]
pub(crate) fn read_opened(st: State<'_, OpenState>, path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !hold(&st.0).allowed.contains(&p) {
        return Err("file not allowed".into());
    }
    Ok(Response::new(fs::read(p).map_err(|e| e.to_string())?))
}
