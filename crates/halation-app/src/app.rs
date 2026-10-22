use crate::catalog;
use crate::folders::{Command as FolderCommand, FolderStore, View as FolderView, size_label};
use crate::jobs::{JobEntry, JobsService};
use crate::library::{
    LibraryEntry, LibraryLoad, LibraryModel, LibraryStore, SaveCompletion, SaveRequest, load_index,
    scan_reference, write_index,
};
use crate::motion;
use crate::navigation::{Navigation, Page};
use crate::profile::{LaunchOptions, Profile};
use crate::settings::{Settings, SettingsStore};
use crate::theme;
use crate::ui::{
    AppWindow, ComponentRow, FolderRow, ItemRow, JobRow, Prefs, RecentItem, SectionRow, Theme,
    ToolItem,
};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel, Weak};
use std::cell::RefCell;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

const HELP: &str = "\
Halation native beta (Rust + Slint + Skia)

Usage: halation-slint [OPTIONS]

Options:
  --profile-root <DIR>   Use an isolated profile root (also HALATION_SLINT_PROFILE)
  --diagnostic-scene <SCENE> Run a bounded native memory scenario (empty, home, cycle)
  --print-profile        Print the resolved profile root and exit
  --version, -V          Print version and build identity
  --help, -h             Show this help
";
const MAX_DROPPED_FILES: usize = 32;

#[derive(Default)]
struct AsyncInbox {
    load: Option<(u64, LibraryLoad)>,
    save: Option<(u64, Result<(), String>)>,
    references: Option<(u64, Vec<Result<LibraryEntry, String>>)>,
    folders: Option<FolderView>,
}

fn lock_inbox(inbox: &Mutex<AsyncInbox>) -> MutexGuard<'_, AsyncInbox> {
    // Inbox updates are simple owned-value moves. Recover the lock instead of leaving the UI busy.
    inbox
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

struct Services {
    profile: Profile,
    settings: SettingsStore,
    library: LibraryStore,
    jobs: JobsService,
    folders: Arc<Mutex<FolderStore>>,
    folders_busy: bool,
    folders_loaded: bool,
    folders_view: FolderView,
    sections_model: Rc<VecModel<SectionRow>>,
    section_items_model: Rc<VecModel<ItemRow>>,
    nav: Navigation,
    notice: String,
    library_loaded: bool,
    load_generation: u64,
    reference_generation: u64,
    reference_busy: bool,
    inbox: Arc<Mutex<AsyncInbox>>,
    tools_model: Rc<VecModel<ToolItem>>,
    active_tools_model: Rc<VecModel<ToolItem>>,
    jobs_model: Rc<VecModel<JobRow>>,
    recent_model: Rc<VecModel<RecentItem>>,
    recent_cache: RefCell<Vec<(String, String)>>,
    backdrop: Rc<BackdropPlayer>,
}

pub(crate) struct Controller {
    weak: Weak<AppWindow>,
    services: Rc<RefCell<Services>>,
    diagnostic_timer: RefCell<Option<Rc<slint::Timer>>>,
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let options = crate::profile::parse_args(std::env::args().skip(1))?;
    if options.help {
        println!("{HELP}");
        return Ok(());
    }
    if options.print_version {
        println!("{}", crate::build_label());
        return Ok(());
    }
    #[cfg(feature = "diag-screenshot")]
    if let Some(spec) = options.screenshot.clone() {
        return crate::screenshot::run(spec);
    }
    let profile = Profile::resolve(&options)?;
    if options.print_profile {
        println!("{}", profile.root().display());
        return Ok(());
    }
    profile.ensure()?;
    log_line(&profile, "starting native beta");

    let renderer = select_renderer()?;
    log_line(&profile, &format!("renderer requested: {renderer}"));

    let assets = crate::assets::locate();
    if let Err(error) = crate::assets::register_fonts(&assets) {
        log_line(&profile, &format!("font not registered: {error}"));
    }
    let window = AppWindow::new()?;
    let log_profile = profile.clone();
    if options.diagnostic_scene == Some(crate::profile::DiagnosticScene::Empty) {
        window.set_diagnostic_scene(0);
        log_line(&log_profile, "diagnostic scene: empty renderer window");
        log_line(&log_profile, "window created (empty diagnostic scene)");
        window
            .run()
            .map_err(|error| format!("event loop failed: {error}"))?;
        log_line(&log_profile, "event loop finished");
        return Ok(());
    }

    let diagnostic_cycle = options.diagnostic_scene == Some(crate::profile::DiagnosticScene::Cycle);
    // Diagnostic scenes keep the fixed size their measurements expect
    let place_window = options.diagnostic_scene.is_none();
    let controller = Controller::new(window.as_weak(), profile, options)?;
    controller.install(diagnostic_cycle);
    // The native window exists only once shown, so it is placed after `show`
    window
        .show()
        .map_err(|error| format!("could not show the window: {error}"))?;
    if place_window {
        // "As I left it" has no stored size in the beta yet, so it opens maximized like "Maximized". The platform
        // window is created inside the event loop, so the request is queued to run there.
        let fullscreen = controller.services.borrow().settings.current().open_window == 2;
        let weak = window.as_weak();
        slint::Timer::single_shot(std::time::Duration::from_millis(300), move || {
            if let Some(window) = weak.upgrade() {
                if fullscreen {
                    window.window().set_fullscreen(true);
                } else {
                    window.window().set_maximized(true);
                }
            }
        });
    }
    log_line(&log_profile, "window created");

    slint::run_event_loop().map_err(|error| format!("event loop failed: {error}"))?;
    // A closed window ends the loop; hiding it again is harmless
    let _ = window.hide();
    controller.shutdown();
    log_line(&log_profile, "event loop finished");
    Ok(())
}

impl Controller {
    /// Closing the window: every job process still running stops with it.
    pub(crate) fn shutdown(&self) {
        self.services.borrow().jobs.shutdown();
    }

    pub(crate) fn new(
        weak: Weak<AppWindow>,
        profile: Profile,
        _options: LaunchOptions,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let settings = SettingsStore::load(profile.settings_path());
        let library_model = LibraryModel::new(settings.current().library_limit);
        let library = LibraryStore::new(profile.library_path(), library_model);

        let tools = tool_items(settings.current());
        let jobs_model = Rc::new(VecModel::from(Vec::<JobRow>::new()));
        let jobs_weak = weak.clone();
        let jobs = JobsService::new(move || {
            // Called from engine threads. A closed window is a normal lifecycle end.
            let _ = jobs_weak.upgrade_in_event_loop(|ui| ui.invoke_jobs_changed());
        });
        let folders = Arc::new(Mutex::new(FolderStore::load(
            profile.sections_root(),
            profile.links_path(),
        )));

        let backdrop = Rc::new(BackdropPlayer::new(
            weak.clone(),
            &crate::assets::locate(),
            theme_of(settings.current()).0,
        ));
        Ok(Self {
            weak,
            diagnostic_timer: RefCell::new(None),
            services: Rc::new(RefCell::new(Services {
                profile,
                settings,
                library,
                jobs,
                folders,
                folders_busy: false,
                folders_loaded: false,
                folders_view: FolderView::default(),
                sections_model: Rc::new(VecModel::default()),
                section_items_model: Rc::new(VecModel::default()),
                nav: Navigation::default(),
                notice: String::new(),
                library_loaded: false,
                load_generation: 0,
                reference_generation: 0,
                reference_busy: false,
                inbox: Arc::new(Mutex::new(AsyncInbox::default())),
                active_tools_model: Rc::new(VecModel::from(active_tools(&tools))),
                tools_model: Rc::new(VecModel::from(tools)),
                jobs_model,
                recent_model: Rc::new(VecModel::default()),
                recent_cache: RefCell::new(Vec::new()),
                backdrop,
            })),
        })
    }

    pub(crate) fn install(&self, diagnostic_cycle: bool) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let (tone, hue) = theme_of(self.services.borrow().settings.current());
        apply_theme(&ui, &theme::colours(tone, hue));
        let assets = crate::assets::locate();
        crate::assets::apply(&ui, &assets, tone);
        // Home shows the loop's first frame until the decoder delivers
        ui.set_backdrop(ui.global::<crate::ui::Assets>().get_still());
        let missing = crate::assets::missing(&assets);
        if !missing.is_empty() {
            let mut s = self.services.borrow_mut();
            log_line(
                &s.profile,
                &format!(
                    "assets missing in {}: {}",
                    assets.display(),
                    missing.join(", ")
                ),
            );
            s.notice = format!(
                "Some of Halation's files are missing ({}). Reinstall Halation to restore them.",
                missing.join(", ")
            );
        }
        ui.set_build_label(SharedString::from(crate::build_label()));
        ui.set_profile_path(SharedString::from(
            self.services
                .borrow()
                .profile
                .root()
                .to_string_lossy()
                .into_owned(),
        ));

        {
            let services = self.services.borrow();
            ui.set_tools(ModelRc::from(services.tools_model.clone()));
            ui.set_active_tools(ModelRc::from(services.active_tools_model.clone()));
            ui.set_components(ModelRc::new(VecModel::from(
                catalog::COMPONENTS
                    .iter()
                    .map(|(name, size)| ComponentRow {
                        name: SharedString::from(*name),
                        size: SharedString::from(*size),
                    })
                    .collect::<Vec<_>>(),
            )));
            ui.set_folders(ModelRc::new(VecModel::from(folder_rows(&services.profile))));
            ui.set_app_size(SharedString::from(
                std::env::current_exe()
                    .and_then(std::fs::metadata)
                    .map(|meta| size_label(meta.len()))
                    .unwrap_or_default(),
            ));
            ui.set_jobs(ModelRc::from(services.jobs_model.clone()));
            ui.set_recent(ModelRc::from(services.recent_model.clone()));
            ui.set_library_rows(ModelRc::from(services.library.model().clone()));
            ui.set_jobs_capability(SharedString::from(services.jobs.capability()));
            ui.set_sections(ModelRc::from(services.sections_model.clone()));
            ui.set_section_items(ModelRc::from(services.section_items_model.clone()));
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_navigate(move |page| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                if let Some(page) = Page::from_index(page)
                    && s.nav.select(page)
                {
                    s.notice.clear();
                    if page == Page::Settings {
                        measure_storage(&s.profile, &weak);
                    }
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_set_pref(move |key, value| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let next = match s.settings.current().with_pref(key.as_str(), value.as_str()) {
                    Ok(next) => next,
                    Err(error) => {
                        s.notice = format!("Could not change that setting: {error}");
                        refresh(&ui, &s);
                        return;
                    }
                };
                match s.settings.save(next) {
                    Ok(()) => {
                        let current = s.settings.current();
                        match key.as_str() {
                            "language" if current.language == 1 => {
                                s.notice = "Saved. The beta is in English only for now.".to_owned();
                            }
                            "open-window" => {
                                s.notice =
                                    "Saved. It applies the next time the beta opens.".to_owned();
                            }
                            _ => {}
                        }
                    }
                    Err(error) => {
                        s.notice = format!("Could not save settings: {error}");
                        log_line(&s.profile, &format!("settings save failed: {error}"));
                    }
                }
                // The saved theme, which also ends a live accent preview
                if matches!(key.as_str(), "theme" | "accent-hue") {
                    retheme(&ui, &s);
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_preview_accent(move |hue| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let s = services.borrow();
                let (tone, _) = theme_of(s.settings.current());
                let hue = u16::try_from(hue.rem_euclid(360)).unwrap_or(0);
                apply_theme(&ui, &theme::colours(tone, Some(hue)));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_set_tool_enabled(move |id, enabled| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let saved = s
                    .settings
                    .current()
                    .with_tool(id.as_str(), enabled)
                    .and_then(|next| s.settings.save(next));
                if let Err(error) = saved {
                    s.notice = format!("Could not save settings: {error}");
                }
                let tools = tool_items(s.settings.current());
                s.active_tools_model.set_vec(active_tools(&tools));
                s.tools_model.set_vec(tools);
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_dock_action(move |action| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                s.notice = match action.as_str() {
                    "folder" => open_folder(s.profile.root()),
                    "open:main" => open_folder(s.profile.root()),
                    "open:library" => open_folder(&s.profile.sections_root()),
                    "open:settings" => open_folder(
                        s.profile
                            .settings_path()
                            .parent()
                            .unwrap_or(s.profile.root()),
                    ),
                    "activity" => format!("Activity: {}.", s.jobs.capability()),
                    other => unavailable_notice(other).to_owned(),
                };
                refresh(&ui, &s);
            });
        }

        ui.on_search_settings(|query| {
            catalog::settings_section(query.as_str()).map_or(-1, |index| index as i32)
        });

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_choose_reference(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let can_pick = {
                    let s = services.borrow();
                    s.library_loaded
                        && s.library.writable()
                        && !s.reference_busy
                        && !s.library.busy()
                };
                let picked = if can_pick {
                    rfd::FileDialog::new()
                        .set_title("Add a reference file")
                        .pick_file()
                } else {
                    None
                };
                let mut s = services.borrow_mut();
                if !s.library_loaded {
                    s.notice = "The reference index is still loading.".to_owned();
                } else if !can_pick {
                    s.notice = "The reference index is busy or not writable.".to_owned();
                } else if let Some(path) = picked {
                    start_reference_scan(&mut s, vec![path], &weak);
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_file_dropped(move |data| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let paths = match data.file_paths() {
                    Ok(paths) => paths
                        .take(MAX_DROPPED_FILES + 1)
                        .map(Path::to_path_buf)
                        .collect::<Vec<_>>(),
                    Err(_) => Vec::new(),
                };
                if paths.is_empty() {
                    s.notice = "Only local files can be added as references.".to_owned();
                } else {
                    start_reference_scan(&mut s, paths, &weak);
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_remove_reference(move |id| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let staged = if s.reference_busy {
                    Err(crate::library::LibraryError::Busy)
                } else {
                    s.library.stage_remove_reference(id.as_str())
                };
                match staged {
                    Ok(request) => {
                        s.notice = "Saving reference changes…".to_owned();
                        start_save(&mut s, &weak, request);
                    }
                    Err(error) => s.notice = error.to_string(),
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_set_query(move |query| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let s = services.borrow();
                s.library.model().set_query(query.as_str());
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_set_reduced_motion(move |reduced| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let mut next: Settings = s.settings.current().clone();
                next.reduced_motion = reduced;
                match s.settings.save(next) {
                    Ok(()) => {
                        s.notice = if reduced {
                            "Reduced motion enabled.".to_owned()
                        } else {
                            "Reduced motion disabled.".to_owned()
                        };
                    }
                    Err(error) => {
                        s.notice.clear();
                        log_line(&s.profile, &format!("settings save failed: {error}"));
                    }
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_reset_settings(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                match s.settings.reset() {
                    Ok(()) => {
                        s.library
                            .model()
                            .set_limit(s.settings.current().library_limit);
                        s.notice = "Settings reset to defaults.".to_owned();
                    }
                    Err(error) => {
                        s.notice = format!("Could not reset settings: {error}");
                    }
                }
                retheme(&ui, &s);
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_tool_activated(move |id| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                if let Some(tool) = catalog::tool(id.as_str()) {
                    if tool.id == "library" {
                        if let Some(page) = Page::from_index(1) {
                            s.nav.select(page);
                        }
                        s.notice.clear();
                    } else {
                        s.notice = catalog::activation_notice(id.as_str());
                    }
                } else {
                    s.notice = "That tool is not part of this beta.".to_owned();
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_dismiss_notice(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                s.notice.clear();
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_cancel_job(move |id| {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let s = services.borrow();
                s.jobs.cancel(id.as_str());
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_clear_finished_jobs(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let s = services.borrow();
                s.jobs.clear_finished();
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_jobs_changed(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let s = services.borrow();
                update_jobs_model(&ui, &s.jobs.jobs(), &s.jobs_model);
                ui.set_jobs_capability(SharedString::from(s.jobs.capability()));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_sections_opened(move || {
                let needs_load = {
                    let s = services.borrow();
                    !s.folders_loaded && !s.folders_busy
                };
                if needs_load {
                    run_folder_command(&services, &weak, FolderCommand::Refresh);
                }
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_select_section(move |id| {
                run_folder_command(&services, &weak, FolderCommand::Select(id.to_string()));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_create_section(move |name| {
                run_folder_command(&services, &weak, FolderCommand::Create(name.to_string()));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_rename_section(move |id, to| {
                run_folder_command(
                    &services,
                    &weak,
                    FolderCommand::Rename {
                        id: id.to_string(),
                        to: to.to_string(),
                    },
                );
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_delete_section(move |id| {
                run_folder_command(&services, &weak, FolderCommand::Delete(id.to_string()));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_unlink_folder(move |id| {
                run_folder_command(&services, &weak, FolderCommand::Unlink(id.to_string()));
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_link_folder(move || {
                let idle = {
                    let s = services.borrow();
                    !s.folders_busy
                };
                if !idle {
                    return;
                }
                let picked = rfd::FileDialog::new()
                    .set_title("Link a folder as a Library section")
                    .pick_folder();
                if let Some(path) = picked {
                    run_folder_command(&services, &weak, FolderCommand::Link(path));
                }
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_sections_finished(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let view = lock_inbox(&s.inbox).folders.take();
                if let Some(view) = view {
                    s.folders_busy = false;
                    s.folders_loaded = true;
                    s.notice = view.notice.clone().unwrap_or_default();
                    s.folders_view = view;
                    apply_folder_view(&ui, &s);
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_load_finished(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let slot = lock_inbox(&s.inbox).load.take();
                if let Some((generation, load)) = slot
                    && generation == s.load_generation
                {
                    s.library.apply_load(load);
                    s.library_loaded = true;
                    if let Some(error) = s.library.error() {
                        log_line(&s.profile, &format!("library load failed: {error}"));
                    }
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_save_finished(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let slot = lock_inbox(&s.inbox).save.take();
                if let Some((generation, result)) = slot {
                    match s.library.finish_save(generation, result) {
                        SaveCompletion::Committed => {
                            s.notice =
                                "Library changes saved. Original files were not modified.".to_owned();
                        }
                        SaveCompletion::Failed => {
                            s.notice = "Could not save the reference index. The previous snapshot was kept."
                                .to_owned();
                            if let Some(error) = s.library.error() {
                                log_line(&s.profile, &format!("library save failed: {error}"));
                            }
                        }
                        SaveCompletion::Stale => {}
                    }
                }
                refresh(&ui, &s);
            });
        }

        {
            let weak = self.weak.clone();
            let services = self.services.clone();
            ui.on_references_finished(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let slot = lock_inbox(&s.inbox).references.take();
                if let Some((generation, results)) = slot
                    && generation == s.reference_generation
                {
                    s.reference_busy = false;
                    if let Some(request) = stage_scanned_references(&mut s, results) {
                        s.notice = "Saving reference changes…".to_owned();
                        start_save(&mut s, &weak, request);
                    }
                }
                refresh(&ui, &s);
            });
        }

        {
            let services = self.services.borrow();
            refresh(&ui, &services);
        }
        start_load(&self.services, &self.weak);
        if diagnostic_cycle {
            *self.diagnostic_timer.borrow_mut() = Some(start_diagnostic_cycle(&self.weak));
        }
    }
}

fn start_load(services: &Rc<RefCell<Services>>, weak: &Weak<AppWindow>) {
    let (inbox, path, limit, generation, profile) = {
        let mut s = services.borrow_mut();
        s.library_loaded = false;
        s.load_generation = s.load_generation.wrapping_add(1);
        (
            s.inbox.clone(),
            s.profile.library_path(),
            s.settings.current().library_limit,
            s.load_generation,
            s.profile.clone(),
        )
    };
    let weak = weak.clone();
    let spawn = std::thread::Builder::new()
        .name("library-load".to_owned())
        .spawn(move || {
            let load = load_index(&path, limit);
            lock_inbox(&inbox).load = Some((generation, load));
            // A dropped window/event loop is an expected lifecycle cancellation: no UI state is captured here.
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_load_finished());
        });
    if let Err(error) = spawn {
        let mut s = services.borrow_mut();
        s.library_loaded = true;
        let message = format!("Could not start the index loader: {error}");
        s.library.apply_load(LibraryLoad::Corrupt(message.clone()));
        s.notice = message;
        log_line(&profile, &format!("could not start index loader: {error}"));
    }
}

fn start_save(s: &mut Services, weak: &Weak<AppWindow>, request: SaveRequest) {
    let inbox = s.inbox.clone();
    let weak = weak.clone();
    let generation = request.generation;
    let path = request.path;
    let entries = request.entries;
    let profile = s.profile.clone();
    let spawn = std::thread::Builder::new()
        .name("library-save".to_owned())
        .spawn(move || {
            let result = write_index(&path, &entries).map_err(|error| error.to_string());
            lock_inbox(&inbox).save = Some((generation, result));
            // A dropped window/event loop is an expected lifecycle cancellation; the disk result stands alone.
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_save_finished());
        });
    if let Err(error) = spawn {
        s.library
            .finish_save(generation, Err(format!("could not start saver: {error}")));
        s.notice = "Could not save the reference index. The previous snapshot was kept.".to_owned();
        log_line(&profile, &format!("could not start index saver: {error}"));
    }
}

fn start_reference_scan(s: &mut Services, paths: Vec<PathBuf>, weak: &Weak<AppWindow>) {
    if !s.library_loaded {
        s.notice = "The reference index is still loading.".to_owned();
        return;
    }
    if !s.library.writable() || s.library.busy() || s.reference_busy {
        s.notice = "The reference index is busy or read-only because of a data error.".to_owned();
        return;
    }
    if paths.is_empty() {
        return;
    }
    if paths.len() > MAX_DROPPED_FILES {
        s.notice = format!("Add at most {MAX_DROPPED_FILES} files per drop.");
        return;
    }

    s.reference_generation = s.reference_generation.wrapping_add(1);
    let generation = s.reference_generation;
    s.reference_busy = true;
    s.notice = "Checking selected file metadata…".to_owned();
    let inbox = s.inbox.clone();
    let weak = weak.clone();
    let profile = s.profile.clone();
    let spawn = std::thread::Builder::new()
        .name("library-reference-scan".to_owned())
        .spawn(move || {
            let results = paths
                .iter()
                .map(|path| scan_reference(path).map_err(|error| error.to_string()))
                .collect();
            lock_inbox(&inbox).references = Some((generation, results));
            // If the owner was destroyed, the weak callback is discarded and this owned payload is dropped.
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_references_finished());
        });
    if let Err(error) = spawn {
        s.reference_busy = false;
        s.notice = format!("Could not start the file metadata worker: {error}");
        log_line(
            &profile,
            &format!("could not start reference scan: {error}"),
        );
    }
}

fn stage_scanned_references(
    s: &mut Services,
    results: Vec<Result<LibraryEntry, String>>,
) -> Option<SaveRequest> {
    let mut entries = Vec::with_capacity(results.len());
    for result in results {
        match result {
            Ok(entry) => entries.push(entry),
            Err(error) => {
                s.notice = error;
                return None;
            }
        }
    }
    match s.library.stage_add_entries(entries) {
        Ok(request) => Some(request),
        Err(error) => {
            s.notice = error.to_string();
            None
        }
    }
}

/// Runs one Library-sections command on a worker thread; the view comes back through the inbox.
fn run_folder_command(
    services: &Rc<RefCell<Services>>,
    weak: &Weak<AppWindow>,
    command: FolderCommand,
) {
    let (store, inbox, profile) = {
        let mut s = services.borrow_mut();
        if s.folders_busy {
            return;
        }
        s.folders_busy = true;
        (s.folders.clone(), s.inbox.clone(), s.profile.clone())
    };
    let thread_weak = weak.clone();
    let spawn = std::thread::Builder::new()
        .name("library-sections".to_owned())
        .spawn(move || {
            let view = store
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .run(command);
            lock_inbox(&inbox).folders = Some(view);
            let _ = thread_weak.upgrade_in_event_loop(|ui| ui.invoke_sections_finished());
        });
    if let Err(error) = spawn {
        let mut s = services.borrow_mut();
        s.folders_busy = false;
        s.notice = format!("Could not start the sections worker: {error}");
        log_line(
            &profile,
            &format!("could not start sections worker: {error}"),
        );
        if let Some(ui) = weak.upgrade() {
            refresh(&ui, &s);
        }
    }
}

fn apply_folder_view(ui: &AppWindow, s: &Services) {
    let view = &s.folders_view;
    s.sections_model.set_vec(
        view.sections
            .iter()
            .map(|section| SectionRow {
                id: SharedString::from(section.id.as_str()),
                name: SharedString::from(section.name.as_str()),
                kind: SharedString::from(section.kind.label()),
                count: section.count.min(i32::MAX as u64) as i32,
                missing: section.missing,
                selected: view.selected.as_deref() == Some(section.id.as_str()),
            })
            .collect::<Vec<_>>(),
    );
    s.section_items_model.set_vec(
        view.items
            .iter()
            .map(|item| ItemRow {
                name: SharedString::from(item.name.as_str()),
                detail: SharedString::from(size_label(item.size)),
            })
            .collect::<Vec<_>>(),
    );
    let selected = view
        .selected
        .as_deref()
        .and_then(|id| view.sections.iter().find(|section| section.id == id));
    ui.set_section_id(SharedString::from(selected.map_or("", |e| e.id.as_str())));
    ui.set_section_name(SharedString::from(selected.map_or("", |e| e.name.as_str())));
    ui.set_section_kind(SharedString::from(selected.map_or("", |e| e.kind.label())));
    ui.set_section_hidden(view.hidden_items.min(i32::MAX as u64) as i32);
}

fn refresh(ui: &AppWindow, s: &Services) {
    s.backdrop.sync(
        s.nav.current() == Page::Home,
        s.settings.current().reduced_motion,
    );
    ui.set_page(s.nav.current().index());
    ui.set_reduced_motion(s.settings.current().reduced_motion);
    apply_motion(ui, motion::tokens(s.settings.current().reduced_motion));
    let model = s.library.model();
    ui.set_library_total(model.len() as i32);
    ui.set_library_missing(model.missing_count() as i32);
    ui.set_library_query(SharedString::from(model.query()));
    ui.set_library_busy(s.library.busy() || s.reference_busy);
    ui.set_library_writable(s.library_loaded && s.library.writable() && !s.reference_busy);
    ui.set_library_loaded(s.library_loaded);
    ui.set_library_limit(s.settings.current().library_limit as i32);
    ui.set_library_error(SharedString::from(s.library.error().unwrap_or_default()));
    ui.set_settings_writable(!s.settings.is_locked());
    ui.set_settings_error(SharedString::from(s.settings.error().unwrap_or_default()));
    ui.set_notice(SharedString::from(s.notice.as_str()));
    ui.set_prefs(prefs(s.settings.current()));
    ui.set_sections_loaded(s.folders_loaded);
    ui.set_sections_busy(s.folders_busy);

    update_recent_model(model, &s.recent_cache, &s.recent_model);
    update_jobs_model(ui, &s.jobs.jobs(), &s.jobs_model);
}

fn update_jobs_model(ui: &AppWindow, jobs: &[JobEntry], model: &VecModel<JobRow>) {
    ui.set_jobs_has_finished(jobs.iter().any(|job| job.finished));
    ui.set_jobs_busy(jobs.iter().any(|job| !job.finished));
    let rows: Vec<JobRow> = jobs
        .iter()
        .map(|job| JobRow {
            id: SharedString::from(job.id.as_str()),
            name: SharedString::from(job.name.as_str()),
            detail: SharedString::from(job.detail.as_str()),
            state: SharedString::from(job.state.as_str()),
            progress: job.progress.unwrap_or(0.0),
            has_progress: job.progress.is_some(),
            cancellable: job.cancellable,
            finished: job.finished,
            failed: job.failed,
        })
        .collect();
    if model.row_count() == rows.len() {
        // Same rows: update in place so a list being scrolled is not reset by every progress tick.
        for (index, row) in rows.into_iter().enumerate() {
            if model.row_data(index).as_ref() != Some(&row) {
                model.set_row_data(index, row);
            }
        }
    } else {
        model.set_vec(rows);
    }
}

fn start_diagnostic_cycle(weak: &Weak<AppWindow>) -> Rc<slint::Timer> {
    let timer = Rc::new(slint::Timer::default());
    let stop_timer = Rc::downgrade(&timer);
    let weak = weak.clone();
    let mut visits = 0_u32;
    timer.start(
        slint::TimerMode::Repeated,
        std::time::Duration::from_secs(1),
        move || {
            const PAGE_SEQUENCE: [i32; 4] = [1, 2, 3, 0];
            if let Some(ui) = weak.upgrade() {
                ui.invoke_navigate(PAGE_SEQUENCE[(visits as usize) % PAGE_SEQUENCE.len()]);
                visits += 1;
                if visits >= 90
                    && let Some(timer) = stop_timer.upgrade()
                {
                    timer.stop();
                }
            } else {
                if let Some(timer) = stop_timer.upgrade() {
                    timer.stop();
                }
            }
        },
    );
    timer
}

/// Recent files Home lists (planning/active/ui-redesign.md §9)
const RECENT_FILES: usize = 6;

fn update_recent_model(
    library: &crate::library::LibraryModel,
    cache: &RefCell<Vec<(String, String)>>,
    model: &VecModel<RecentItem>,
) -> bool {
    let mut cached = cache.borrow_mut();
    if library.recent_matches(&cached, RECENT_FILES) {
        return false;
    }

    let entries = library.recent_entries(RECENT_FILES);
    *cached = entries
        .iter()
        .map(|entry| (entry.id.clone(), entry.display_name.clone()))
        .collect();
    model.set_vec(
        entries
            .iter()
            .map(|entry| RecentItem {
                id: SharedString::from(entry.id.as_str()),
                name: SharedString::from(entry.display_name.as_str()),
                folder: SharedString::from(parent_folder(&entry.path)),
            })
            .collect::<Vec<_>>(),
    );
    true
}

/// Name of the folder that holds `path`, shown under a recent file
fn parent_folder(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Every tool of the catalog, as Settings > Tools lists it
fn tool_items(settings: &Settings) -> Vec<ToolItem> {
    catalog::TOOLS
        .iter()
        .map(|tool| ToolItem {
            id: SharedString::from(tool.id),
            name: SharedString::from(tool.name),
            icon: SharedString::from(tool.icon),
            summary: SharedString::from(tool.summary),
            group: tool.group,
            beta: tool.beta,
            enabled: settings.tool_enabled(tool.id),
            missing: SharedString::from(tool.missing),
            available: tool.available,
            reason: SharedString::from(tool.reason),
        })
        .collect()
}

/// The tools turned on, the sidebar's and the Workspace's: the Library is not among them, the Workspace holds it
fn active_tools(tools: &[ToolItem]) -> Vec<ToolItem> {
    tools
        .iter()
        .filter(|tool| tool.enabled && tool.id != "library")
        .cloned()
        .collect()
}

fn prefs(settings: &Settings) -> Prefs {
    let choice = |value: u8| i32::from(value);
    Prefs {
        language: choice(settings.language),
        reduce_motion: settings.reduced_motion,
        show_dock: settings.show_dock,
        notify: settings.notify,
        dock_mode: choice(settings.dock_mode),
        dock_activity: settings.dock_activity,
        open_window: choice(settings.open_window),
        artist: SharedString::from(settings.artist.as_str()),
        youtube: SharedString::from(settings.youtube.as_str()),
        spotify: SharedString::from(settings.spotify.as_str()),
        soundcloud: SharedString::from(settings.soundcloud.as_str()),
        instagram: SharedString::from(settings.instagram.as_str()),
        tiktok: SharedString::from(settings.tiktok.as_str()),
        save_mode: choice(settings.save_mode),
        video_template: SharedString::from(settings.video_template.as_str()),
        image_template: SharedString::from(settings.image_template.as_str()),
        processing: choice(settings.processing),
        use_gpu: settings.use_gpu,
        vocal_device: choice(settings.vocal_device),
        cpu_jobs: choice(settings.cpu_jobs),
        gpu_jobs: choice(settings.gpu_jobs),
        downloads: choice(settings.downloads),
        minimized: choice(settings.minimized),
        budget: choice(settings.budget),
        updates: choice(settings.updates),
        whats_new: settings.whats_new,
        theme: choice(settings.theme),
        accent_hue: i32::from(settings.accent_hue),
    }
}

/// The beta profile's folders, as Settings > About lists them
fn folder_rows(profile: &Profile) -> Vec<FolderRow> {
    let settings_dir = profile
        .settings_path()
        .parent()
        .map_or_else(|| profile.root().to_path_buf(), Path::to_path_buf);
    [
        (
            "main",
            "Main folder",
            "Beta profile",
            profile.root().to_path_buf(),
        ),
        (
            "library",
            "Library",
            "Sections and packs",
            profile.sections_root(),
        ),
        ("settings", "Settings", "settings.json", settings_dir),
    ]
    .into_iter()
    .map(|(key, name, detail, path)| FolderRow {
        key: SharedString::from(key),
        name: SharedString::from(name),
        detail: SharedString::from(detail),
        path: SharedString::from(path.to_string_lossy().as_ref()),
    })
    .collect()
}

/// Opens a folder in Explorer on a human gesture; the returned text is the notice to show
fn open_folder(path: &Path) -> String {
    match std::process::Command::new("explorer").arg(path).spawn() {
        Ok(_) => String::new(),
        Err(error) => format!("Could not open {}: {error}", path.display()),
    }
}

/// What the buttons without an engine behind them say in the beta
fn unavailable_notice(action: &str) -> &'static str {
    match action {
        "install" | "update-engine" => "Components cannot be installed in this beta yet.",
        "shortcuts" => "Keyboard shortcuts come with the tools.",
        "language" => "The beta is in English only for now.",
        "session" => "There is no session to save until the tools are connected.",
        "test-notification" => "Notifications are not connected in this beta yet.",
        "search-sites" => "Searching other sites is not connected in this beta yet.",
        "check-updates" | "changelog" => {
            "The native beta is updated from its launcher, not by itself."
        }
        "license" | "notices" => "LICENSE and NOTICE.md are in the repository root.",
        _ => "Not available in this beta yet.",
    }
}

/// Size of the beta profile, read off the GUI thread; Settings > Storage shows it when it arrives
fn measure_storage(profile: &Profile, weak: &Weak<AppWindow>) {
    fn walk(path: &Path, depth: u8) -> u64 {
        let Ok(entries) = std::fs::read_dir(path) else {
            return 0;
        };
        entries
            .flatten()
            .map(|entry| match entry.metadata() {
                Ok(meta) if meta.is_dir() && depth < 8 => walk(&entry.path(), depth + 1),
                Ok(meta) => meta.len(),
                Err(_) => 0,
            })
            .sum()
    }
    let root = profile.root().to_path_buf();
    let weak = weak.clone();
    std::thread::spawn(move || {
        let profile_bytes = walk(&root, 0);
        let app_bytes = std::env::current_exe()
            .and_then(std::fs::metadata)
            .map(|meta| meta.len())
            .unwrap_or(0);
        // A closed window is a normal lifecycle end
        let _ = weak.upgrade_in_event_loop(move |ui| {
            ui.set_workspace_size(SharedString::from(size_label(profile_bytes)));
            ui.set_storage_used(SharedString::from(size_label(profile_bytes + app_bytes)));
        });
    });
}

/// Plays Home's backdrop loop (backdrop.rs): a 15 Hz timer asks the decoding thread for the next frame, which comes
/// back to the window as an image; two frames are kept and written in turn. The timer runs only while Home is shown
/// with motion on and the window is not minimized; otherwise the frame on screen stays (the still frame with reduced
/// motion, or when the loop cannot play).
struct BackdropPlayer {
    weak: Weak<AppWindow>,
    player: Option<crate::backdrop::Player>,
    timer: slint::Timer,
    still: std::cell::Cell<bool>,
}

impl BackdropPlayer {
    fn new(weak: Weak<AppWindow>, assets: &Path, tone: theme::Tone) -> Self {
        let deliver_to = weak.clone();
        let player = crate::backdrop::Player::start(assets, tone, move |frame| {
            // A closed window is a normal lifecycle end
            let _ = deliver_to.upgrade_in_event_loop(move |ui| {
                ui.set_backdrop(Image::from_rgba8_premultiplied(frame))
            });
        });
        Self {
            weak,
            player,
            timer: slint::Timer::default(),
            still: std::cell::Cell::new(false),
        }
    }

    /// Recolours the loop and the still frame for `tone`; the frame on screen changes with the next one decoded, or at
    /// once when the still frame shows
    fn set_tone(&self, tone: theme::Tone) {
        if let Some(player) = &self.player {
            player.set_tone(tone);
        }
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let still = crate::assets::still(&crate::assets::locate(), tone);
        ui.global::<crate::ui::Assets>().set_still(still.clone());
        if self.still.get() || self.player.is_none() || !self.timer.running() {
            ui.set_backdrop(still);
        }
    }

    fn sync(self: &Rc<Self>, on_home: bool, reduced_motion: bool) {
        let playing = on_home && !reduced_motion && self.player.is_some();
        if !playing {
            self.timer.stop();
            // The still frame where the loop does not move (reduced motion, no decoder), once
            if (reduced_motion || self.player.is_none())
                && !self.still.replace(true)
                && let Some(ui) = self.weak.upgrade()
            {
                ui.set_backdrop(ui.global::<crate::ui::Assets>().get_still());
            }
            return;
        }
        self.still.set(false);
        if self.timer.running() {
            return;
        }
        let this = Rc::downgrade(self);
        self.timer.start(
            slint::TimerMode::Repeated,
            std::time::Duration::from_micros(1_000_000 / crate::backdrop::FPS),
            move || {
                let Some(this) = this.upgrade() else {
                    return;
                };
                let Some(ui) = this.weak.upgrade() else {
                    return;
                };
                if let (false, Some(player)) = (ui.window().is_minimized(), &this.player) {
                    let size = ui.window().size();
                    player.request(size.width, size.height);
                }
            },
        );
    }
}

fn apply_motion(ui: &AppWindow, tokens: motion::Tokens) {
    let ms = |d: std::time::Duration| d.as_millis().min(i64::MAX as u128) as i64;
    let global = ui.global::<crate::ui::Motion>();
    global.set_hover_in(ms(tokens.hover_in));
    global.set_hover_out(ms(tokens.hover_out));
    global.set_release(ms(tokens.release));
    global.set_glide(ms(tokens.glide));
    global.set_trail(ms(tokens.trail));
    global.set_fade(ms(tokens.fade));
    global.set_panel(ms(tokens.panel));
    global.set_tip_wait(ms(tokens.tip_wait));
    global.set_press_scale(tokens.press_scale);
}

/// Sets the theme's colours (docs/features/themes.md): at start and whenever Settings changes the theme or the accent;
/// the window repaints once
fn apply_theme(ui: &AppWindow, colours: &theme::Colours) {
    let theme = ui.global::<Theme>();
    theme.set_chrome(color(colours.chrome));
    theme.set_canvas(color(colours.canvas));
    theme.set_canvas_deep(color(colours.canvas_deep));
    theme.set_control(color(colours.control));
    theme.set_control_hover(color(colours.control_hover));
    theme.set_control_active(color(colours.control_active));
    theme.set_line(color(colours.line));
    theme.set_line_strong(color(colours.line_strong));
    theme.set_line_hover(color(colours.line_hover));
    theme.set_text(color(colours.text));
    theme.set_muted(color(colours.muted));
    theme.set_subtle(color(colours.subtle));
    theme.set_accent(color(colours.accent));
    theme.set_activity(color(colours.activity));
    theme.set_warning(color(colours.warning));
    theme.set_beta(color(colours.beta));
    theme.set_danger(color(colours.danger));
    theme.set_success(color(colours.success));
    theme.set_raised(color(colours.raised));
    theme.set_raised_press(color(colours.raised_press));
    theme.set_well(color(colours.well));
    theme.set_bubble(color(colours.bubble));
    theme.set_popover(color(colours.popover));
    theme.set_key(color(colours.key));
    theme.set_primary_press(color(colours.primary_press));
}

/// Applies the saved theme and accent to the window and Home's backdrop
fn retheme(ui: &AppWindow, s: &Services) {
    let (tone, hue) = theme_of(s.settings.current());
    apply_theme(ui, &theme::colours(tone, hue));
    s.backdrop.set_tone(tone);
}

/// The theme and accent of the settings
fn theme_of(settings: &Settings) -> (theme::Tone, Option<u16>) {
    let hue = (settings.accent_hue < crate::settings::THEME_ACCENT).then_some(settings.accent_hue);
    (theme::Tone::from_setting(settings.theme), hue)
}

fn color(value: theme::Rgb) -> slint::Color {
    slint::Color::from_rgb_u8(value.0, value.1, value.2)
}

/// Diagnostic renderer selection (`HALATION_RENDERER`, default `skia`). A renderer that is not
/// compiled in or cannot start is an error; there is no fallback to another renderer.
fn select_renderer() -> Result<String, Box<dyn std::error::Error>> {
    let requested = std::env::var("HALATION_RENDERER").unwrap_or_else(|_| "skia".to_owned());
    let selector = slint::BackendSelector::new().backend_name("winit".into());
    let selector = match requested.as_str() {
        "skia" => selector.renderer_name("skia".into()),
        "skia-d3d" => selector.renderer_name("skia".into()).require_d3d(),
        #[cfg(feature = "diag-skia-vulkan")]
        "skia-vulkan" => selector.renderer_name("skia".into()).require_vulkan(),
        #[cfg(feature = "diag-skia-opengl")]
        // Desktop OpenGL: Slint's default GLES 3.0 context does not draw stroked paths on some drivers.
        "skia-opengl" => selector
            .renderer_name("skia-opengl".into())
            .require_opengl(),
        #[cfg(feature = "diag-skia-opengl")]
        "skia-opengl-es" => selector
            .renderer_name("skia-opengl".into())
            .require_opengl_es(),
        #[cfg(feature = "diag-femtovg")]
        "femtovg" => selector.renderer_name("femtovg".into()),
        #[cfg(feature = "diag-software")]
        "software" => selector.renderer_name("software".into()),
        other => {
            return Err(
                format!("renderer '{other}' is unknown or not compiled into this binary").into(),
            );
        }
    };
    selector
        .select()
        .map_err(|error| format!("could not select renderer '{requested}': {error}"))?;
    Ok(requested)
}

fn log_line(profile: &Profile, message: &str) {
    // Diagnostic logging is best-effort; the operation's user-facing error is handled by its caller.
    let _ = profile.ensure();
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(profile.log_path())
    {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "{stamp} {message}");
    }
}

#[cfg(test)]
mod tests {
    use super::update_recent_model;
    use crate::library::{LibraryEntry, LibraryLoad, LibraryModel, LibraryStore};
    use crate::ui::RecentItem;
    use slint::{Model, VecModel};
    use std::cell::RefCell;
    use std::rc::Rc;

    fn entry(id: &str, name: &str) -> LibraryEntry {
        LibraryEntry {
            id: id.to_owned(),
            path: format!("C:/fixture/{id}.png"),
            display_name: name.to_owned(),
            missing: false,
            added_at: 1,
        }
    }

    #[test]
    fn recent_model_is_not_reset_when_recent_entries_are_unchanged() {
        let library_model = LibraryModel::new(2000);
        let mut library = LibraryStore::new("unused.json", library_model.clone());
        library.apply_load(LibraryLoad::Loaded(vec![entry("a", "Alpha.png")]));

        let cache = RefCell::new(Vec::new());
        let model = Rc::new(VecModel::<RecentItem>::default());
        assert!(update_recent_model(&library_model, &cache, &model));
        assert_eq!(model.row_count(), 1);
        assert!(!update_recent_model(&library_model, &cache, &model));
        assert_eq!(model.row_count(), 1);

        library.apply_load(LibraryLoad::Loaded(vec![entry("a", "Renamed.png")]));
        assert!(update_recent_model(&library_model, &cache, &model));
        assert_eq!(model.row_count(), 1);
        assert_eq!(model.row_data(0).unwrap().name.as_str(), "Renamed.png");
    }
}
