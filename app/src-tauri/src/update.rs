//! The updater (docs/UPDATES.md): Tauri's updater plugin reads `latest.json` of the public releases
//! (Sylphera/Halation), the setup is downloaded and its signature checked against the key in tauri.conf.json, and it
//! runs either now ("Save session & restart": the session stays for recovery and the app opens again) or when the
//! app is closed by hand ("Install on close"). The portable copy only learns that a version exists; the page opens
//! the release for a manual download.

use crate::*;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The release page of a version, for the portable copy and the notes' "View on GitHub".
const RELEASES: &str = "https://github.com/Sylphera/Halation/releases/tag/v";

#[derive(Default)]
pub(crate) struct Updates {
    /// the update the last check found (what `update_download` fetches)
    found: Mutex<Option<Update>>,
    /// the downloaded, verified setup waiting to run
    ready: Mutex<Option<PathBuf>>,
    /// the setup runs as the app quits; `true`: and Halation opens again afterwards
    run_on_quit: Mutex<Option<bool>>,
}

/// An installed copy has the uninstaller beside it; the portable executable runs alone.
pub(crate) fn installed() -> bool {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf))
        .is_some_and(|d| d.join(crate::tools::exe("uninstall")).is_file())
}

/// The setup's arguments: passive (a progress bar only), an update (no shortcuts or WebView2 setup again), and
/// `/R` to start Halation when it is done.
fn setup_args(restart: bool) -> Vec<&'static str> {
    let mut args = vec!["/P", "/UPDATE"];
    if restart { args.push("/R"); }
    args
}

/// Checks the public releases. `None`: this is the newest version (or the Preview, which never updates).
#[tauri::command]
pub(crate) async fn update_check(app: AppHandle, updates: State<'_, Updates>) -> Result<Option<Value>, String> {
    if cfg!(feature = "preview") { return Ok(None); }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        *hold(&updates.found) = None;
        return Ok(None);
    };
    let info = json!({
        "version": update.version,
        "current": update.current_version,
        "notes": update.body.clone().unwrap_or_default(),
        "date": update.date.map(|d| d.unix_timestamp() * 1000),
        "page": format!("{RELEASES}{}", update.version),
        "portable": !installed(),
    });
    *hold(&updates.found) = Some(update);
    Ok(Some(info))
}

/// Downloads the setup the last check found and checks its signature; "update-progress" {done, total} while it
/// arrives. The file waits in the temporary folder until it runs.
#[tauri::command]
pub(crate) async fn update_download(app: AppHandle, updates: State<'_, Updates>) -> Result<String, String> {
    if !installed() { return Err("portable".into()); }
    let update = hold(&updates.found).clone().ok_or("no update was found")?;
    let mut done = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                let _ = app.emit("update-progress", json!({ "done": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let folder = std::env::temp_dir().join("Halation-update");
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file = folder.join(format!("Halation_{}_x64-setup.exe", file_stem(&update.version)));
    fs::write(&file, bytes).map_err(|e| e.to_string())?;
    *hold(&updates.ready) = Some(file);
    Ok(update.version)
}

/// "Save session & restart" (`restart`): the work stays for recovery, the app quits and the setup opens it again.
/// "Install on close": nothing happens now; the setup runs when the app is closed by hand.
#[tauri::command]
pub(crate) fn update_install(app: AppHandle, updates: State<'_, Updates>, restart: bool) -> Result<(), String> {
    if hold(&updates.ready).is_none() { return Err("the update is not downloaded".into()); }
    *hold(&updates.run_on_quit) = Some(restart);
    if restart { crate::window::quit(&app, false); }
    Ok(())
}

/// Whether a downloaded update waits for the app to close.
#[tauri::command]
pub(crate) fn update_pending(updates: State<'_, Updates>) -> bool {
    hold(&updates.run_on_quit).is_some()
}

/// Opens a version's release page in the browser (the portable copy downloads it there).
#[tauri::command]
pub(crate) fn update_page(version: String) -> Result<(), String> {
    if !valid_version(&version) { return Err(format!("not a version: {version}")); }
    let url = format!("{RELEASES}{version}");
    spawn_explorer(&[url.as_ref()])
}

fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 32 && v.starts_with(|c: char| c.is_ascii_digit()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Called as the app quits: runs the waiting setup, if any.
pub(crate) fn on_quit(app: &AppHandle) {
    let updates = app.state::<Updates>();
    let Some(restart) = *hold(&updates.run_on_quit) else { return };
    let Some(file) = hold(&updates.ready).clone() else { return };
    if let Err(e) = std::process::Command::new(&file).args(setup_args(restart)).spawn() {
        eprintln!("could not start the update: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_setup_runs_passive_as_an_update_and_restarts_only_when_asked() {
        assert_eq!(setup_args(false), ["/P", "/UPDATE"]);
        assert_eq!(setup_args(true), ["/P", "/UPDATE", "/R"]);
    }

    #[test]
    fn only_a_version_reaches_the_release_page() {
        assert!(valid_version("1.2.0") && valid_version("1.2.0-beta.1"));
        assert!(!valid_version("") && !valid_version("../x") && !valid_version("1.2.0&calc") && !valid_version("v1.2.0"));
    }
}
