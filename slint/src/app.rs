use crate::catalog;
use crate::jobs::JobsService;
use crate::library::{
    LibraryEntry, LibraryLoad, LibraryModel, LibraryStore, load_index, scan_reference, write_index,
};
use crate::motion;
use crate::navigation::{Navigation, Page};
use crate::profile::{LaunchOptions, Profile};
use crate::settings::{Settings, SettingsStore};
use crate::theme;
use crate::ui::{AppWindow, JobRow, RecentItem, Theme, ToolItem};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel, Weak};
use std::cell::RefCell;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const HELP: &str = "\
Halation native beta (Rust + Slint + Skia)

Usage: halation-slint [OPTIONS]

Options:
  --profile-root <DIR>   Use an isolated profile root (also HALATION_SLINT_PROFILE)
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
}

struct Services {
    profile: Profile,
    settings: SettingsStore,
    library: LibraryStore,
    jobs: JobsService,
    nav: Navigation,
    notice: String,
    library_loaded: bool,
    load_generation: u64,
    reference_generation: u64,
    reference_busy: bool,
    inbox: Arc<Mutex<AsyncInbox>>,
    tools_model: Rc<VecModel<ToolItem>>,
    rail_tools_model: Rc<VecModel<ToolItem>>,
    jobs_model: Rc<VecModel<JobRow>>,
}

struct Controller {
    weak: Weak<AppWindow>,
    services: Rc<RefCell<Services>>,
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
    let profile = Profile::resolve(&options)?;
    if options.print_profile {
        println!("{}", profile.root().display());
        return Ok(());
    }
    profile.ensure()?;
    log_line(&profile, "starting native beta");

    slint::BackendSelector::new()
        .backend_name("winit".into())
        .renderer_name("skia".into())
        .select()
        .map_err(|error| format!("could not select winit + Skia: {error}"))?;

    let window = AppWindow::new()?;
    let log_profile = profile.clone();
    let controller = Controller::new(window.as_weak(), profile, options)?;
    controller.install();
    log_line(&log_profile, "window created");

    window
        .run()
        .map_err(|error| format!("event loop failed: {error}"))?;
    log_line(&log_profile, "event loop finished");
    Ok(())
}

impl Controller {
    fn new(
        weak: Weak<AppWindow>,
        profile: Profile,
        _options: LaunchOptions,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let settings = SettingsStore::load(profile.settings_path());
        let library_model = LibraryModel::new(settings.current().library_limit);
        let library = LibraryStore::new(profile.library_path(), library_model);

        let tools: Vec<ToolItem> = catalog::TOOLS
            .iter()
            .map(|tool| ToolItem {
                id: SharedString::from(tool.id),
                name: SharedString::from(tool.name),
                icon: SharedString::from(tool.icon),
                available: tool.available,
                reason: SharedString::from(tool.reason),
            })
            .collect();
        let jobs_model = Rc::new(VecModel::from(Vec::<JobRow>::new()));
        let rail_tools: Vec<ToolItem> = tools
            .iter()
            .filter(|tool| !tool.available)
            .cloned()
            .collect();

        Ok(Self {
            weak,
            services: Rc::new(RefCell::new(Services {
                profile,
                settings,
                library,
                jobs: JobsService::default(),
                nav: Navigation::default(),
                notice: String::new(),
                library_loaded: false,
                load_generation: 0,
                reference_generation: 0,
                reference_busy: false,
                inbox: Arc::new(Mutex::new(AsyncInbox::default())),
                tools_model: Rc::new(VecModel::from(tools)),
                rail_tools_model: Rc::new(VecModel::from(rail_tools)),
                jobs_model,
            })),
        })
    }

    fn install(&self) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        apply_theme(&ui);

        {
            let services = self.services.borrow();
            ui.set_tools(ModelRc::from(services.tools_model.clone()));
            ui.set_rail_tools(ModelRc::from(services.rail_tools_model.clone()));
            ui.set_jobs(ModelRc::from(services.jobs_model.clone()));
            ui.set_jobs_capability(SharedString::from(services.jobs.capability()));
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
                }
                refresh(&ui, &s);
            });
        }

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
                let result = if s.reference_busy {
                    Err(crate::library::LibraryError::Busy)
                } else {
                    s.library.remove_reference(id.as_str())
                };
                let changed = result.is_ok();
                match result {
                    Ok(()) => {
                        s.notice =
                            "Reference removed. The original file was not touched.".to_owned();
                    }
                    Err(error) => s.notice = error.to_string(),
                }
                refresh(&ui, &s);
                if changed {
                    start_save(&mut s, &weak);
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
                    if tool.available {
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
            ui.on_load_finished(move || {
                let Some(ui) = weak.upgrade() else {
                    return;
                };
                let mut s = services.borrow_mut();
                let slot = s.inbox.lock().ok().and_then(|mut inbox| inbox.load.take());
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
                let slot = s.inbox.lock().ok().and_then(|mut inbox| inbox.save.take());
                if let Some((generation, result)) = slot {
                    let failed = result.is_err();
                    s.library.finish_save(generation, result);
                    if failed {
                        s.notice =
                            "Could not save the reference index. The previous snapshot was kept."
                                .to_owned();
                        if let Some(error) = s.library.error() {
                            log_line(&s.profile, &format!("library save failed: {error}"));
                        }
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
                let slot = s
                    .inbox
                    .lock()
                    .ok()
                    .and_then(|mut inbox| inbox.references.take());
                if let Some((generation, results)) = slot
                    && generation == s.reference_generation
                {
                    s.reference_busy = false;
                    if apply_scanned_references(&mut s, results) {
                        start_save(&mut s, &weak);
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
            if let Ok(mut inbox) = inbox.lock() {
                inbox.load = Some((generation, load));
            }
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

fn start_save(s: &mut Services, weak: &Weak<AppWindow>) {
    if !s.library_loaded || s.library.busy() || s.reference_busy || !s.library.writable() {
        return;
    }
    let request = match s.library.begin_save() {
        Ok(request) => request,
        Err(_) => return,
    };
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
            if let Ok(mut inbox) = inbox.lock() {
                inbox.save = Some((generation, result));
            }
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_save_finished());
        });
    if let Err(error) = spawn {
        let _ = s
            .library
            .finish_save(generation, Err(format!("could not start saver: {error}")));
        s.notice = "Could not start the reference index saver.".to_owned();
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
            if let Ok(mut inbox) = inbox.lock() {
                inbox.references = Some((generation, results));
            }
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

fn apply_scanned_references(s: &mut Services, results: Vec<Result<LibraryEntry, String>>) -> bool {
    let mut added = 0usize;
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(entry) => {
                let name = entry.display_name.clone();
                match s.library.add_scanned_entry(entry) {
                    Ok(()) => {
                        added += 1;
                        log_line(&s.profile, &format!("reference added: {name}"));
                    }
                    Err(error) => errors.push(error.to_string()),
                }
            }
            Err(error) => errors.push(error),
        }
    }
    if added > 0 {
        s.notice = format!(
            "Added {added} reference{}. The original file{} not modified{}.",
            if added == 1 { "" } else { "s" },
            if added == 1 { " was" } else { "s were" },
            errors
                .first()
                .map(|error| format!(" Some files were skipped: {error}"))
                .unwrap_or_default()
        );
    } else if let Some(error) = errors.first() {
        s.notice = error.clone();
    }
    added > 0
}

fn refresh(ui: &AppWindow, s: &Services) {
    ui.set_page(s.nav.current().index());
    ui.set_reduced_motion(s.settings.current().reduced_motion);
    ui.set_motion_duration(
        motion::duration(s.settings.current().reduced_motion).as_millis() as i64,
    );
    ui.set_build_label(SharedString::from(crate::build_label()));
    ui.set_profile_path(SharedString::from(
        s.profile.root().to_string_lossy().into_owned(),
    ));

    let model = s.library.model();
    ui.set_library_rows(ModelRc::from(model.clone()));
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
    ui.set_jobs_capability(SharedString::from(s.jobs.capability()));

    let recent: Vec<RecentItem> = model
        .recent_entries(3)
        .iter()
        .map(|entry| RecentItem {
            id: SharedString::from(entry.id.as_str()),
            name: SharedString::from(entry.display_name.as_str()),
        })
        .collect();
    ui.set_recent(ModelRc::from(Rc::new(VecModel::from(recent))));
}

fn apply_theme(ui: &AppWindow) {
    let theme = ui.global::<Theme>();
    theme.set_background(color(theme::BACKGROUND));
    theme.set_surface(color(theme::SURFACE));
    theme.set_surface_high(color(theme::SURFACE_HIGH));
    theme.set_border(color(theme::BORDER));
    theme.set_text(color(theme::TEXT));
    theme.set_muted(color(theme::MUTED));
    theme.set_accent(color(theme::ACCENT));
    theme.set_accent_soft(color(theme::ACCENT_SOFT));
    theme.set_danger(color(theme::DANGER));
    theme.set_success(color(theme::SUCCESS));
}

fn color(value: theme::Rgb) -> slint::Color {
    slint::Color::from_rgb_u8(value.0, value.1, value.2)
}

fn log_line(profile: &Profile, message: &str) {
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
