#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod convert;
mod cutout;
mod download;
mod encode;
mod files;
mod save_location;
mod interp;
mod framegrab;
mod library;
mod migrate;
mod openwith;
mod outfiles;
mod paths;
mod presets;
mod profile;
mod procs;
mod state;
mod sessions;
mod stems;
mod storage;
mod system;
mod tools;
mod update;
mod web;
mod window;
mod workspace;

// the helpers keep their old paths (crate::base_dir…) for tools.rs and encode.rs
pub(crate) use paths::*;
use assets::*;
use files::*;
use migrate::*;
use openwith::*;
use presets::*;
use state::*;
use system::*;
use window::*;
use std::{collections::HashMap, fs, sync::Mutex};
#[cfg(all(windows, not(feature = "preview")))]
use tauri::Emitter;
use tauri::{Manager, WindowEvent};


fn main() {
    // Halation Preview runs beside the real app and beside other previews: no single instance, its own WebView2 data
    #[cfg(all(windows, feature = "preview"))]
    paths::preview::webview_folder();
    let builder = tauri::Builder::default();
    #[cfg(all(windows, not(feature = "preview")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if queue_paths(app, argv.into_iter().skip(1)) > 0 {
            let _ = app.emit("open-files", ());
        }
        if let Ok(w) = main_window(app) {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(StateLock(Mutex::new(())))
        .manage(save_location::Destinations::default())
        .manage(sessions::Sessions::default())
        .manage(procs::Procs::default())
        .manage(framegrab::Picked::default())
        .manage(convert::Reserved::default())
        .manage(encode::Encoders::default())
        .manage(Exports(Mutex::new(HashMap::new())))
        .manage(OpenState(Mutex::new(Opened::default())))
        .manage(Closing::default())
        .manage(workspace::Workspace::default())
        .manage(update::Updates::default())
        .setup(|app| {
            let handle = app.handle();
            #[cfg(windows)]
            register_app_id(handle);
            if let Err(e) = migrate(handle) {
                eprintln!("could not import earlier data: {e}");
            }
            app.manage(Recovered(state::begin(handle)));
            workspace::begin(handle);
            queue_paths(handle, std::env::args().skip(1));
            if let Ok(win) = main_window(handle) {
                #[cfg(windows)]
                dark_title_bar(&win);
                mark_icon(&win);
                restore_window(handle, &win);
            }
            Ok(())
        })
        // Debug builds only: HALATION_SELFTEST=<file.js> runs that script in the main window once it has loaded
        // (tests/realapp.py uses it to drive the real IPC, e.g. the streaming export).
        .on_page_load(|webview, payload| {
            if cfg!(debug_assertions) && payload.event() == tauri::webview::PageLoadEvent::Finished && webview.label() == "main" {
                if let Some(js) = std::env::var_os("HALATION_SELFTEST").and_then(|f| fs::read_to_string(f).ok()) {
                    let _ = webview.eval(&js);
                }
            }
        })
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                close_requested(win, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            state_get,
            state_set,
            sessions::session_state,
            sessions::session_replace,
            sessions::session_recovery,
            sessions::session_recovery_write,
            sessions::session_discard,
            sessions::session_pick,
            sessions::session_write,
            sessions::session_read,
            sessions::session_file_put,
            sessions::session_file_read,
            sessions::session_file_reference,
            sessions::session_allow_video,
            preset_list,
            preset_stamp,
            preset_write,
            preset_delete,
            preset_rename,
            save_file,
            save_location::export_destination,
            save_location::export_completed,
            save_location::export_copy,
            export_open,
            export_write,
            export_close,
            export_abort,
            files_exist,
            open_path,
            reveal_path,
            set_progress,
            notify,
            asset_put,
            asset_get,
            asset_delete,
            font_files,
            list_fonts,
            open_folder,
            paths,
            app_info,
            legal_text,
            take_open_files,
            read_opened,
            close_ack,
            app_quit,
            memory_low,
            window_fullscreen,
            tools::tools_status,
            tools::tool_install,
            storage::tool_uninstall,
            storage::storage_report,
            storage::cache_clear,
            cutout::cutout_cache_get,
            cutout::cutout_cache_put,
            framegrab::framegrab_pick,
            interp::interp_workdir,
            interp::interp_count,
            interp::interp_clean,
            convert::convert_probe,
            convert::convert_prepare,
            convert::convert_image,
            convert::convert_pdf_page,
            convert::convert_pdf_preview,
            convert::convert_finish,
            convert::convert_discard,
            convert::convert_pick,
            convert::convert_read,
            convert::convert_reveal,
            stems::stems_separate,
            stems::stems_cancel,
            stems::stems_clean,
            stems::stems_peak,
            framegrab::framegrab_probe,
            framegrab::framegrab_write,
            framegrab::framegrab_read,
            framegrab::framegrab_cache_get,
            framegrab::framegrab_cache_put,
            procs::proc_start,
            procs::proc_kill,
            procs::proc_kill_job,
            system::sys_resources,
            workspace::workspace_lease,
            workspace::workspace_release,
            workspace::workspace_cache_get,
            workspace::workspace_cache_put,
            workspace::workspace_pin,
            workspace::workspace_report,
            workspace::workspace_clean,
            workspace::workspace_stats_get,
            workspace::workspace_stats_put,
            update::update_check,
            update::update_download,
            update::update_install,
            update::update_pending,
            update::update_page,
            web::http_text,
            web::http_bytes,
            web::spotify_artist_metrics,
            outfiles::reserve_stem,
            outfiles::temp_write,
            outfiles::read_path,
            outfiles::read_path_chunk,
            outfiles::write_path,
            outfiles::delete_paths,
            outfiles::files_with_stem,
            encode::encode_start,
            encode::encode_write,
            encode::encode_finish,
            encode::encode_abort,
            system::disk_free,
            encode::export_folder,
            encode::export_folder_remove,
            library::library_sections,
            library::library_items,
            library::library_read,
            library::library_section,
            library::library_write,
            library::library_remove,
            library::library_pack_remove,
            library::library_pick_folder,
            library::library_pick_files,
            library::library_index_get,
            library::library_index_put,
            library::library_scan,
            library::library_resolve,
            library::library_thumb_get,
            library::library_thumb_put,
            profile::profile_get,
            profile::profile_set,
            profile::profile_file_get,
            profile::profile_file_put,
            profile::profile_prune
        ])
        .run(tauri::generate_context!())
        .expect("could not start Halation");
}
