//! Native Converter controller. Input/plan/job state survives lazy page destruction.
use crate::{
    profile::Profile,
    ui::{AppWindow, ConvertRow, FormatRow},
};
use halation_core::{
    components::{self, Ffmpeg},
    convert::{self, Class, Plan, Source},
    destinations::{Destinations, ExportLocation, SaveMode, SavePicker},
    engine::JobEngine,
    folders,
    playback::{self, Player},
    queue::{JobSpec, JobState, Lane},
};
use slint::{
    ComponentHandle, Image, Model, ModelRc, Rgba8Pixel, SharedPixelBuffer, VecModel, Weak,
};
use std::{
    cell::RefCell,
    collections::HashSet,
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

static WORKSPACE: AtomicU64 = AtomicU64::new(0);

struct Input {
    path: PathBuf,
    source: Result<Source, String>,
    plans: Vec<Plan>,
    target: String,
    job: Option<String>,
    output: Option<PathBuf>,
    status: String,
    subfolder: Option<String>,
    /// Size of the finished output, shown beside the original's
    bytes_out: Option<u64>,
}

struct Loaded {
    inputs: Vec<Input>,
    ffmpeg: Option<Ffmpeg>,
    encoders: Option<HashSet<String>>,
    limited: bool,
}

#[derive(Default)]
struct State {
    inputs: Vec<Input>,
    selected: usize,
    busy: bool,
    opened: bool,
    ffmpeg: Option<Ffmpeg>,
    encoders: Option<HashSet<String>>,
    install_job: Option<String>,
    message: String,
    destinations: Destinations,
    location: ExportLocation,
    location_writable: bool,
    /// What was last written to export-location.json; an unchanged location is not written (and synced) again
    location_saved: Option<Vec<u8>>,
    left_open: bool,
    inspector_open: bool,
}

pub(crate) struct Converter {
    weak: Weak<AppWindow>,
    state: RefCell<State>,
    inbox: Arc<Mutex<Option<Loaded>>>,
    rows: Rc<VecModel<ConvertRow>>,
    formats: Rc<VecModel<FormatRow>>,
    engine: JobEngine,
    profile: Profile,
    preview_path: RefCell<Option<PathBuf>>,
    preview_job: RefCell<Option<String>>,
    preview_generation: Arc<AtomicU64>,
    probe_cancel: Arc<AtomicBool>,
    /// The remembered export location is written off the UI thread (a synced write); the newest write wins and a
    /// failure comes back here
    location_writes: Arc<Mutex<LocationWrites>>,
    audio: RefCell<Audio>,
    // Runs only while audio plays: moves the head and notices the end
    clock: slint::Timer,
}

#[derive(Default)]
struct LocationWrites {
    latest: u64,
    error: Option<String>,
}

/// The selected audio file's preview. Playback state lives here, never in the page.
#[derive(Default)]
struct Audio {
    path: Option<PathBuf>,
    ffmpeg: Option<PathBuf>,
    duration: f64,
    /// Seconds heard, kept while paused
    position: f64,
    player: Option<Player>,
}

/// Arrow keys move the audio head by this much.
const AUDIO_STEP: f64 = 5.0;

impl Converter {
    pub fn new(weak: Weak<AppWindow>, profile: Profile, engine: JobEngine) -> Rc<Self> {
        let (location, location_writable, message) =
            read_location(&profile.root().join("export-location.json"));
        Rc::new(Self {
            weak,
            state: RefCell::new(State {
                location,
                location_writable,
                message,
                inspector_open: true,
                ..Default::default()
            }),
            inbox: Arc::new(Mutex::new(None)),
            rows: Rc::new(VecModel::default()),
            formats: Rc::new(VecModel::default()),
            engine,
            profile,
            preview_path: RefCell::new(None),
            preview_job: RefCell::new(None),
            preview_generation: Arc::new(AtomicU64::new(0)),
            probe_cancel: Arc::new(AtomicBool::new(false)),
            location_writes: Arc::default(),
            audio: RefCell::new(Audio::default()),
            clock: slint::Timer::default(),
        })
    }

    pub fn install(self: &Rc<Self>, save_mode: impl Fn() -> Option<u8> + 'static) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        ui.set_convert_rows(ModelRc::from(self.rows.clone()));
        ui.set_convert_formats(ModelRc::from(self.formats.clone()));
        let controller = self.clone();
        ui.on_converter_action(move |action| match action.as_str() {
            "add" => {
                if let Some(files) = rfd::FileDialog::new()
                    .set_title("Add media to Converter")
                    .pick_files()
                {
                    controller.add(files);
                }
            }
            "folder" => {
                if let Some(folder) = rfd::FileDialog::new()
                    .set_title("Add a media folder")
                    .pick_folder()
                {
                    controller.add(vec![folder]);
                }
            }
            "clear" => {
                if !controller.engine.busy(Some("converter")) && !controller.state.borrow().busy {
                    controller.state.borrow_mut().inputs.clear();
                    controller.state.borrow_mut().selected = 0;
                    controller.refresh();
                    controller.start_preview();
                }
            }
            "run" => {
                if let Some(mode) = save_mode() {
                    controller.run(mode);
                }
            }
            "cancel" => {
                controller.probe_cancel.store(true, Ordering::Release);
                controller.engine.cancel("converter-batch");
                if let Some(id) = controller.state.borrow().install_job.as_ref() {
                    controller.engine.cancel(id);
                }
            }
            "install" => controller.install_ffmpeg(),
            "play" => controller.toggle_playback(),
            "back" => controller.seek_by(-AUDIO_STEP),
            "forward" => controller.seek_by(AUDIO_STEP),
            "reveal" => controller.reveal(),
            "location-error" => {
                let error = controller
                    .location_writes
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .error
                    .take();
                if let Some(error) = error {
                    controller.state.borrow_mut().message = format!(
                        "File saved, but the export location could not be remembered: {error}"
                    );
                    controller.refresh();
                }
            }
            "toggle-files" => {
                let mut state = controller.state.borrow_mut();
                state.left_open = !state.left_open;
                drop(state);
                controller.refresh();
            }
            "toggle-output" => {
                let mut state = controller.state.borrow_mut();
                state.inspector_open = !state.inspector_open;
                drop(state);
                controller.refresh();
            }
            _ => {}
        });
        let controller = self.clone();
        ui.on_converter_select(move |index| {
            if let Ok(index) = usize::try_from(index)
                && index < controller.state.borrow().inputs.len()
            {
                controller.state.borrow_mut().selected = index;
                controller.refresh();
                controller.start_preview();
            }
        });
        let controller = self.clone();
        ui.on_converter_target(move |target| {
            let mut state = controller.state.borrow_mut();
            let can_change = !controller.engine.busy(Some("converter"));
            let class = state
                .inputs
                .get(state.selected)
                .and_then(|i| i.source.as_ref().ok())
                .map(|s| s.class);
            for input in &mut state.inputs {
                if can_change
                    && input.source.as_ref().ok().map(|s| s.class) == class
                    && input.plans.iter().any(|p| p.target == target.as_str())
                {
                    if input.target != target.as_str() {
                        input.job = None;
                        input.bytes_out = None;
                        input.status = "Ready".into();
                    }
                    input.target = target.to_string();
                }
            }
            drop(state);
            controller.refresh();
        });
        let controller = self.clone();
        ui.on_converter_seek(move |fraction| {
            let duration = controller.audio.borrow().duration;
            controller.seek_to(f64::from(fraction) * duration);
        });
        let controller = self.clone();
        ui.on_converter_loaded(move || {
            let loaded = controller
                .inbox
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if let Some(loaded) = loaded {
                let mut state = controller.state.borrow_mut();
                state.busy = false;
                state.inputs = loaded.inputs;
                state.ffmpeg = loaded.ffmpeg;
                state.encoders = loaded.encoders;
                if loaded.limited { state.message = "Showing up to 256 files after checking at most 4096 entries. Add a smaller folder to include more.".into(); }
                state.selected = state.selected.min(state.inputs.len().saturating_sub(1));
            }
            controller.refresh();
            controller.start_preview();
        });
        let controller = self.clone();
        ui.on_converter_dropped(move |data| {
            if let Ok(paths) = data.file_paths() {
                controller.add(paths.take(257).map(Path::to_path_buf).collect());
            }
        });
        self.refresh();
    }

    pub fn open(self: &Rc<Self>) {
        let first = !self.state.borrow().opened;
        self.state.borrow_mut().opened = true;
        if first {
            if let Some(ui) = self.weak.upgrade() {
                self.state.borrow_mut().left_open = ui.window().size().width >= 1180;
            }
            self.add(Vec::new());
        } else {
            self.start_preview();
        }
    }

    pub fn suspend_preview(&self) {
        self.close_audio();
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        *self.preview_path.borrow_mut() = None;
        if let Some(id) = self.preview_job.borrow_mut().take() {
            self.engine.cancel(&id);
        }
        if let Some(ui) = self.weak.upgrade() {
            ui.set_convert_has_preview(false);
            ui.set_convert_preview(Image::default());
        }
    }

    pub fn cancel_probe(&self) {
        self.probe_cancel.store(true, Ordering::Release);
    }

    fn start_preview(&self) {
        if self.weak.upgrade().is_none_or(|ui| ui.get_page() != 4) {
            return;
        }
        let state = self.state.borrow();
        let selected = state.inputs.get(state.selected);
        let path = selected.map(|i| i.path.clone());
        if *self.preview_path.borrow() == path {
            return;
        }
        *self.preview_path.borrow_mut() = path;
        let generation = self.preview_generation.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(job) = self.preview_job.borrow_mut().take() {
            self.engine.cancel(&job);
        }
        if let Some(ui) = self.weak.upgrade() {
            ui.set_convert_has_preview(false);
            ui.set_convert_preview(Image::default());
        }
        self.close_audio();
        let Some(input) = selected else {
            return;
        };
        let Ok(source) = &input.source else {
            return;
        };
        if source.class == Class::Audio {
            let Some(ffmpeg) = state.ffmpeg.as_ref().map(|f| f.ffmpeg.clone()) else {
                return;
            };
            let path = input.path.clone();
            let duration = source.duration;
            drop(state);
            self.open_audio(path, ffmpeg, duration, generation);
            return;
        }
        if !matches!(source.class, Class::Image | Class::Animated | Class::Video) {
            return;
        }
        let source = source.clone();
        let path = input.path.clone();
        let ffmpeg = state.ffmpeg.clone();
        let workspace = self.workspace();
        let weak = self.weak.clone();
        let current = self.preview_generation.clone();
        drop(state);
        let mut spec = JobSpec::new("converter-preview", "Prepare preview", Lane::Light);
        // Decoding can touch a large source before thumbnailing. Never decode several previews concurrently.
        spec.cost = Lane::Light.capacity();
        spec.priority = halation_core::queue::Priority::User;
        let job = self.engine.submit_task(spec, move |context| {
            let thumbnail = workspace.join("preview.png");
            let result = (|| {
                context.check_cancelled()?;
                let preview_path = if source.class == Class::Video || source.format == "avif" {
                    let Some(ffmpeg) = ffmpeg else {
                        return Ok(());
                    };
                    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
                    context.run_process(
                        halation_core::process::ProcessSpec {
                            program: ffmpeg.ffmpeg,
                            args: vec![
                                "-hide_banner".into(),
                                "-nostdin".into(),
                                "-n".into(),
                                "-protocol_whitelist".into(),
                                "file,pipe".into(),
                                "-i".into(),
                                path.to_string_lossy().into_owned(),
                                "-frames:v".into(),
                                "1".into(),
                                "-vf".into(),
                                "scale=1024:768:force_original_aspect_ratio=decrease".into(),
                                thumbnail.to_string_lossy().into_owned(),
                            ],
                            low_priority: true,
                            ..Default::default()
                        },
                        0.0,
                    )?;
                    &thumbnail
                } else {
                    &path
                };
                let (image, _) = convert::decode(preview_path)?;
                let rgba = image.thumbnail(1024, 768).to_rgba8();
                context.check_cancelled()?;
                let (width, height) = rgba.dimensions();
                let bytes = rgba.into_raw();
                let _ = weak.upgrade_in_event_loop(move |ui| {
                    if current.load(Ordering::Acquire) == generation {
                        ui.set_convert_preview(Image::from_rgba8(
                            SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
                                &bytes, width, height,
                            ),
                        ));
                        ui.set_convert_has_preview(true);
                    }
                });
                Ok(())
            })();
            let _ = std::fs::remove_file(thumbnail);
            let _ = std::fs::remove_dir(workspace);
            result
        });
        *self.preview_job.borrow_mut() = Some(job);
    }

    /* ===== audio preview ===== */

    /// Shows the player at once (skeleton waveform) and computes the waveform in a preview job.
    fn open_audio(&self, path: PathBuf, ffmpeg: PathBuf, duration: f64, generation: u64) {
        *self.audio.borrow_mut() = Audio {
            path: Some(path.clone()),
            ffmpeg: Some(ffmpeg.clone()),
            duration,
            ..Default::default()
        };
        if let Some(ui) = self.weak.upgrade() {
            ui.set_convert_audio(true);
            ui.set_convert_wave(Default::default());
            ui.set_convert_wave_bins(playback::WAVE_BINS as f32);
        }
        self.show_audio();
        let weak = self.weak.clone();
        let current = self.preview_generation.clone();
        let mut spec = JobSpec::new("converter-preview", "Prepare preview", Lane::Light);
        spec.cost = Lane::Light.capacity();
        spec.priority = halation_core::queue::Priority::User;
        let job = self.engine.submit_task(spec, move |context| {
            let stale = || {
                context.check_cancelled().is_err() || current.load(Ordering::Acquire) != generation
            };
            let peaks = playback::waveform(&ffmpeg, &path, duration, &stale)?;
            let wave = playback::envelope_path(&peaks);
            let _ = weak.upgrade_in_event_loop(move |ui| {
                if current.load(Ordering::Acquire) == generation {
                    ui.set_convert_wave(wave.into());
                }
            });
            Ok(())
        });
        *self.preview_job.borrow_mut() = Some(job);
    }

    /// Stops playback and hides the player (another file, another page, closing).
    fn close_audio(&self) {
        self.clock.stop();
        let had = std::mem::take(&mut *self.audio.borrow_mut()).path.is_some();
        if had && let Some(ui) = self.weak.upgrade() {
            ui.set_convert_audio(false);
            ui.set_convert_playing(false);
            ui.set_convert_wave(Default::default());
            ui.set_convert_position(0.0);
            ui.set_convert_clock(Default::default());
        }
    }

    fn toggle_playback(self: &Rc<Self>) {
        let playing = self.audio.borrow().player.is_some();
        if playing {
            self.pause();
        } else {
            let mut audio = self.audio.borrow_mut();
            // From the end, play again from the start
            if audio.duration > 0.0 && audio.position >= audio.duration - 0.05 {
                audio.position = 0.0;
            }
            let at = audio.position;
            drop(audio);
            self.play_from(at);
        }
    }

    fn play_from(self: &Rc<Self>, at: f64) {
        let mut audio = self.audio.borrow_mut();
        let (Some(path), Some(ffmpeg)) = (audio.path.clone(), audio.ffmpeg.clone()) else {
            return;
        };
        audio.player = None;
        audio.position = at;
        audio.player = Some(Player::start(&ffmpeg, &path, at, playback::system_output()));
        drop(audio);
        let weak = Rc::downgrade(self);
        self.clock.start(
            slint::TimerMode::Repeated,
            Duration::from_millis(33),
            move || {
                if let Some(controller) = weak.upgrade() {
                    controller.tick();
                }
            },
        );
        self.show_audio();
    }

    fn pause(&self) {
        self.clock.stop();
        let mut audio = self.audio.borrow_mut();
        if let Some(player) = audio.player.take() {
            let heard = player.position();
            audio.position = if audio.duration > 0.0 {
                heard.min(audio.duration)
            } else {
                heard
            };
        }
        drop(audio);
        self.show_audio();
    }

    fn seek_by(self: &Rc<Self>, delta: f64) {
        let position = {
            let audio = self.audio.borrow();
            audio
                .player
                .as_ref()
                .map_or(audio.position, Player::position)
        };
        self.seek_to(position + delta);
    }

    fn seek_to(self: &Rc<Self>, seconds: f64) {
        let mut audio = self.audio.borrow_mut();
        if audio.path.is_none() || !seconds.is_finite() {
            return;
        }
        let end = if audio.duration > 0.0 {
            audio.duration
        } else {
            0.0
        };
        let at = seconds.clamp(0.0, end);
        let playing = audio.player.is_some();
        audio.position = at;
        drop(audio);
        if playing && at < end {
            self.play_from(at);
        } else {
            self.pause();
            self.audio.borrow_mut().position = at;
            self.show_audio();
        }
    }

    fn tick(&self) {
        let mut audio = self.audio.borrow_mut();
        let Some(player) = audio.player.as_ref() else {
            drop(audio);
            self.clock.stop();
            return;
        };
        let position = player.position();
        let finished = player.finished();
        let error = player.error();
        audio.position = if audio.duration > 0.0 {
            position.min(audio.duration)
        } else {
            position
        };
        if finished {
            audio.player = None;
            if error.is_none() && audio.duration > 0.0 {
                audio.position = audio.duration;
            }
        }
        drop(audio);
        if finished {
            self.clock.stop();
            if let Some(error) = error {
                self.state.borrow_mut().message = format!("Could not play this file: {error}");
                self.refresh();
            }
        }
        self.show_audio();
    }

    fn show_audio(&self) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let audio = self.audio.borrow();
        if audio.path.is_none() {
            return;
        }
        ui.set_convert_playing(audio.player.is_some());
        ui.set_convert_position(if audio.duration > 0.0 {
            (audio.position / audio.duration).clamp(0.0, 1.0) as f32
        } else {
            0.0
        });
        let clock = format!(
            "{} / {}",
            playback::clock(audio.position),
            if audio.duration > 0.0 {
                playback::clock(audio.duration)
            } else {
                "--:--".into()
            }
        );
        if ui.get_convert_clock().as_str() != clock {
            ui.set_convert_clock(clock.into());
        }
    }

    pub fn add(self: &Rc<Self>, paths: Vec<PathBuf>) {
        if self.state.borrow().busy || self.engine.busy(Some("converter")) {
            return;
        }
        let mut state = self.state.borrow_mut();
        state.busy = true;
        state.message.clear();
        // Move rather than clone probe data. The previous view remains visible until the worker returns.
        let existing = Arc::new(Mutex::new(Some(std::mem::take(&mut state.inputs))));
        let fallback = existing.clone();
        let cancelled = self.probe_cancel.clone();
        cancelled.store(false, Ordering::Release);
        let tools = self.profile.root().join("tools");
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        drop(state);
        self.refresh();
        let spawn = std::thread::Builder::new()
            .name("converter-probe".into())
            .spawn(move || {
                let ffmpeg = Ffmpeg::find(&tools);
                let encoders = ffmpeg
                    .as_ref()
                    .and_then(|f| convert::encoders(&f.ffmpeg).ok());
                let mut inputs = existing
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take()
                    .unwrap_or_default();
                let mut pending: Vec<(PathBuf, Option<PathBuf>, usize)> =
                    paths.into_iter().map(|p| (p, None, 0)).collect();
                let mut visited = 0;
                let mut limited = false;
                while let Some((path, base, depth)) = pending.pop() {
                    if cancelled.load(Ordering::Acquire) {
                        break;
                    }
                    visited += 1;
                    if inputs.len() >= 256 || visited > 4096 {
                        limited = true;
                        break;
                    }
                    if path.is_symlink() {
                        continue;
                    }
                    if path.is_dir() && depth < 16 {
                        let base = base.or_else(|| Some(path.clone()));
                        if let Ok(entries) = std::fs::read_dir(path) {
                            pending.extend(
                                entries
                                    .flatten()
                                    .take(257)
                                    .map(|e| (e.path(), base.clone(), depth + 1)),
                            );
                        }
                        continue;
                    }
                    if inputs.iter().any(|i| i.path == path) {
                        continue;
                    }
                    let source =
                        convert::probe(&path, ffmpeg.as_ref().map(|f| f.ffprobe.as_path()));
                    if cancelled.load(Ordering::Acquire) {
                        break;
                    }
                    let plans = source
                        .as_ref()
                        .map(|s| convert::targets(s, encoders.as_ref()))
                        .unwrap_or_default();
                    let target = plans.first().map_or(String::new(), |p| p.target.into());
                    let status = match &source {
                        Err(error) => format!("Failed: {error}"),
                        Ok(s) if s.class == Class::Unsupported => "Unsupported".into(),
                        _ => "Ready".into(),
                    };
                    let subfolder = base
                        .as_ref()
                        .and_then(|base| path.parent()?.strip_prefix(base).ok())
                        .filter(|p| !p.as_os_str().is_empty())
                        .map(|p| p.to_string_lossy().into_owned());
                    inputs.push(Input {
                        path,
                        source,
                        plans,
                        target,
                        job: None,
                        output: None,
                        status,
                        subfolder,
                        bytes_out: None,
                    });
                }
                // Installation can resolve sources previously loaded without FFmpeg, without restarting the app.
                for input in &mut inputs {
                    if cancelled.load(Ordering::Acquire) {
                        break;
                    }
                    if input.source.as_ref().is_ok_and(|s| s.needs_ffmpeg) && ffmpeg.is_some() {
                        input.source = convert::probe(
                            &input.path,
                            ffmpeg.as_ref().map(|f| f.ffprobe.as_path()),
                        );
                        input.plans = input
                            .source
                            .as_ref()
                            .map(|s| convert::targets(s, encoders.as_ref()))
                            .unwrap_or_default();
                        input.target = input
                            .plans
                            .first()
                            .map_or(String::new(), |p| p.target.into());
                    }
                }
                for input in inputs.iter_mut().filter(|i| i.job.is_none()) {
                    input.plans = input
                        .source
                        .as_ref()
                        .map(|s| convert::targets(s, encoders.as_ref()))
                        .unwrap_or_default();
                }
                normalize_groups(&mut inputs);
                *inbox
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Loaded {
                    inputs,
                    ffmpeg,
                    encoders,
                    limited,
                });
                // Closed window: discard the owned result normally, no models touched from this worker.
                let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_converter_loaded());
            });
        if let Err(error) = spawn {
            let mut state = self.state.borrow_mut();
            state.inputs = fallback
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
                .unwrap_or_default();
            state.busy = false;
            state.message = error.to_string();
            drop(state);
            self.refresh();
        }
    }

    fn workspace(&self) -> PathBuf {
        self.profile.root().join("workspace").join(format!(
            "convert-{}-{}",
            std::process::id(),
            WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn run(&self, mode: u8) {
        let mut state = self.state.borrow_mut();
        if state.busy || self.engine.busy(Some("converter")) {
            return;
        }
        state.message.clear();
        let mode = if mode == 1 {
            SaveMode::HalationFolder
        } else {
            SaveMode::AskEveryTime
        };
        // Preview profiles never write into the published app's Documents tree.
        let base = self.profile.root().join("Exports").join("Converted");
        let location = state.location.clone();
        let ffmpeg = state.ffmpeg.clone();
        for index in 0..state.inputs.len() {
            let input = &state.inputs[index];
            if input.job.is_some() && !retryable(input) {
                continue;
            }
            let Ok(source) = &input.source else {
                continue;
            };
            let Some(plan) = input
                .plans
                .iter()
                .find(|p| p.target == input.target)
                .cloned()
            else {
                continue;
            };
            if (!plan.image || source.needs_ffmpeg) && ffmpeg.is_none() {
                state.message = "Needs FFmpeg · Install to convert audio and video".into();
                continue;
            }
            let input_path = input.path.clone();
            let subfolder = input.subfolder.clone();
            let source = source.clone();
            let filename = format!(
                "{}.{}",
                input_path.file_stem().unwrap_or_default().to_string_lossy(),
                plan.target
            );
            let output = match state.destinations.resolve(
                mode,
                &base,
                &filename,
                subfolder.as_deref(),
                &location,
                &NativePicker,
            ) {
                Ok(Some(path)) => path,
                Ok(None) => break,
                Err(error) => {
                    state.message = error;
                    break;
                }
            };
            if !state.destinations.allows(&output) || output == input_path {
                state.message = "The original cannot be replaced".into();
                continue;
            }
            let replace_confirmed = mode == SaveMode::AskEveryTime && output.is_file();
            let mut spec = JobSpec::new(
                "converter",
                &filename,
                if plan.weight == 0 {
                    Lane::Light
                } else {
                    Lane::Cpu
                },
            );
            spec.cost = if plan.image {
                Lane::Light.capacity()
            } else if plan.weight == 2 {
                2.0
            } else {
                1.0
            };
            spec.group = Some("converter-batch".into());
            spec.detail = plan.notes.join(" · ");
            let workspace = self.workspace();
            let bin = ffmpeg.as_ref().map(|f| f.ffmpeg.clone());
            let destination = output.clone();
            let id = self.engine.submit_task(spec, move |context| {
                convert::execute_export(
                    &context,
                    convert::Conversion {
                        input: &input_path,
                        output: &destination,
                        workspace: &workspace,
                        source: &source,
                        plan: &plan,
                        ffmpeg: bin.as_deref(),
                        replace_confirmed,
                    },
                )
            });
            state.inputs[index].job = Some(id);
            state.inputs[index].bytes_out = None;
            state.inputs[index].output = Some(output);
        }
        drop(state);
        self.refresh();
    }

    pub(crate) fn install_ffmpeg(&self) {
        let mut state = self.state.borrow_mut();
        if state.ffmpeg.is_some() || state.install_job.is_some() || state.busy {
            return;
        }
        let tools = self.profile.root().join("tools");
        let workspace = self.workspace();
        let spec = JobSpec::new("components", "Install FFmpeg", Lane::Net);
        state.install_job = Some(self.engine.submit_task(spec, move |context| {
            components::install_ffmpeg(&context, &tools, &workspace)
        }));
        drop(state);
        self.refresh();
    }

    pub fn jobs_changed(self: &Rc<Self>) -> Option<String> {
        let jobs = self.engine.jobs();
        let mut state = self.state.borrow_mut();
        let mut installed = false;
        let mut installation_notice = None;
        let mut saved: Option<(PathBuf, bool)> = None;
        if let Some(id) = state.install_job.as_ref()
            && let Some(job) = jobs.iter().find(|j| &j.id == id)
            && job.state.finished()
        {
            installed = job.state == JobState::Done;
            state.message = match &job.state {
                JobState::Failed(e) => e.clone(),
                JobState::Cancelled => "Installation cancelled".into(),
                _ => "FFmpeg installed".into(),
            };
            installation_notice = Some(state.message.clone());
            state.install_job = None;
        }
        for index in 0..state.inputs.len() {
            let input = &mut state.inputs[index];
            if let Some(job) = input
                .job
                .as_ref()
                .and_then(|id| jobs.iter().find(|j| &j.id == id))
            {
                input.status = match &job.state {
                    JobState::Queued => "Queued".into(),
                    JobState::Held => "Held".into(),
                    JobState::Running => {
                        format!("Converting · {:.0}%", job.progress.unwrap_or(0.0) * 100.0)
                    }
                    JobState::Done => "Done".into(),
                    JobState::Failed(e) => format!("Failed: {e}"),
                    JobState::Cancelled => "Cancelled".into(),
                };
                if job.state == JobState::Done
                    && let Some(path) = input.output.clone()
                {
                    if input.bytes_out.is_none() {
                        input.bytes_out = std::fs::metadata(&path).ok().map(|m| m.len());
                    }
                    let State {
                        destinations,
                        location,
                        ..
                    } = &mut *state;
                    match destinations.complete(&path, location) {
                        Ok(completion) if completion.fresh => {
                            if saved.as_ref().is_none_or(|(_, explain)| !explain) {
                                saved = Some((path, completion.explain));
                            }
                        }
                        Ok(_) => {}
                        Err(error) => state.message = error,
                    }
                }
            }
        }
        if let Some((path, explain)) = saved {
            state.message = format!(
                "Saved {}{}.",
                path.file_name().unwrap_or_default().to_string_lossy(),
                if explain { " to Halation Folder" } else { "" }
            );
            if !state.location_writable {
                state.message = "File saved, but the export location could not be remembered: the damaged export-location file was kept unchanged".into();
            } else {
                match serde_json::to_vec_pretty(&state.location) {
                    Ok(bytes) if state.location_saved.as_ref() != Some(&bytes) => {
                        state.location_saved = Some(bytes.clone());
                        self.save_location(bytes);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        state.message = format!(
                            "File saved, but the export location could not be remembered: {error}"
                        );
                    }
                }
            }
        }
        drop(state);
        if installed {
            self.add(Vec::new());
        } else {
            self.refresh();
        }
        installation_notice
    }

    /// Writes the remembered location on a short-lived thread; a newer write makes an older one a no-op.
    fn save_location(&self, bytes: Vec<u8>) {
        let writes = self.location_writes.clone();
        let generation = {
            let mut writes = writes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            writes.latest += 1;
            writes.latest
        };
        let path = self.profile.root().join("export-location.json");
        let weak = self.weak.clone();
        let spawned = std::thread::Builder::new()
            .name("export-location".into())
            .spawn(move || {
                // Held while writing: writes never interleave, and a superseded one is skipped
                let mut guard = writes
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if guard.latest != generation {
                    return;
                }
                if let Err(error) = halation_core::atomic_file::write_atomic(&path, &bytes) {
                    guard.error = Some(error.to_string());
                    drop(guard);
                    let _ = weak.upgrade_in_event_loop(|ui| {
                        ui.invoke_converter_action("location-error".into());
                    });
                }
            });
        if let Err(error) = spawned {
            self.state.borrow_mut().message =
                format!("File saved, but the export location could not be remembered: {error}");
        }
    }

    fn reveal(&self) {
        let path = {
            let state = self.state.borrow();
            state
                .inputs
                .get(state.selected)
                .filter(|i| i.status == "Done")
                .and_then(|i| i.output.clone())
        };
        let Some(path) = path else {
            return;
        };
        let mut command = std::process::Command::new("explorer");
        if path.is_file() {
            command.arg("/select,").arg(&path);
        } else if let Some(parent) = path.parent() {
            command.arg(parent);
        } else {
            return;
        }
        if let Err(error) = command.spawn() {
            self.state.borrow_mut().message = format!("Could not show the saved file: {error}");
            self.refresh();
        }
    }

    fn refresh(&self) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let state = self.state.borrow();
        ui.set_convert_left_open(state.left_open);
        ui.set_convert_inspector_open(state.inspector_open);
        update_rows(
            &self.rows,
            state
                .inputs
                .iter()
                .enumerate()
                .map(|(index, i)| ConvertRow {
                    index: index as i32,
                    name: i
                        .path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .as_ref()
                        .into(),
                    detail: i
                        .source
                        .as_ref()
                        .map_or_else(|e| e.clone(), Source::summary)
                        .into(),
                    state: shown_status(i).into(),
                    target: i.target.to_uppercase().into(),
                    selected: index == state.selected,
                    failed: i.source.is_err()
                        || i.status.starts_with("Failed")
                        || i.status == "Unsupported",
                })
                .collect(),
        );
        let selected = state.inputs.get(state.selected);
        let jobs = self.engine.jobs();
        let active = state
            .install_job
            .as_ref()
            .and_then(|id| jobs.iter().find(|j| &j.id == id))
            .or_else(|| {
                selected
                    .and_then(|i| i.job.as_ref())
                    .and_then(|id| jobs.iter().find(|j| &j.id == id && !j.state.finished()))
            })
            .or_else(|| {
                jobs.iter()
                    .find(|j| j.spec.tool == "converter" && !j.state.finished())
            });
        ui.set_convert_progress(active.and_then(|j| j.progress).unwrap_or(0.0));
        ui.set_convert_progress_label(
            active
                .map_or_else(
                    || {
                        if state.busy {
                            "Checking media…".into()
                        } else {
                            String::new()
                        }
                    },
                    |j| {
                        format!(
                            "{} · {}{}",
                            j.spec.title,
                            j.stage,
                            j.progress
                                .map_or(String::new(), |p| format!(" · {:.0}%", p * 100.0))
                        )
                    },
                )
                .into(),
        );
        update_rows(
            &self.formats,
            selected
                .map(|i| {
                    let video = i.source.as_ref().is_ok_and(|s| s.class == Class::Video);
                    let first_audio = i
                        .plans
                        .iter()
                        .position(|p| video && is_audio_only(p.target));
                    i.plans
                        .iter()
                        .enumerate()
                        .map(|(index, p)| FormatRow {
                            id: p.target.into(),
                            name: p.target.to_uppercase().into(),
                            detail: p.description().into(),
                            note: p.notes.join(" · ").into(),
                            selected: p.target == i.target,
                            audio: video && is_audio_only(p.target),
                            header: first_audio == Some(index),
                            recommended: index == 0,
                        })
                        .collect()
                })
                .unwrap_or_default(),
        );
        ui.set_convert_busy(
            state.busy || self.engine.busy(Some("converter")) || state.install_job.is_some(),
        );
        ui.set_convert_can_run(
            !state.busy
                && state
                    .inputs
                    .iter()
                    .any(|i| (i.job.is_none() || retryable(i)) && !i.target.is_empty())
                && !self.engine.busy(Some("converter")),
        );
        ui.set_convert_needs_ffmpeg(
            state.ffmpeg.is_none()
                && selected.is_some_and(|i| {
                    i.source.as_ref().is_ok_and(|s| {
                        s.needs_ffmpeg
                            || matches!(s.class, Class::Audio | Class::Video | Class::Animated)
                    })
                }),
        );
        ui.set_ffmpeg_ready(state.ffmpeg.is_some());
        ui.set_ffmpeg_installing(state.install_job.is_some());
        ui.set_convert_message(
            if state.message.is_empty()
                && selected.is_some_and(|i| {
                    i.source
                        .as_ref()
                        .is_ok_and(|s| s.class == Class::Unsupported)
                })
            {
                "Halation can't convert this file yet.".into()
            } else {
                state.message.as_str().into()
            },
        );
        ui.set_convert_title(selected.map_or("Add media to begin".into(), |i| {
            i.path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_ref()
                .into()
        }));
        ui.set_convert_summary(
            selected
                .map_or(String::new(), |i| {
                    i.source
                        .as_ref()
                        .map_or_else(|e| e.clone(), Source::summary)
                })
                .into(),
        );
        ui.set_convert_completed(selected.is_some_and(|i| i.status == "Done"));
        ui.set_convert_output(
            selected
                .and_then(|i| i.output.as_ref())
                .map_or(String::new(), |p| p.to_string_lossy().into_owned())
                .into(),
        );
        // Preview is intentionally populated only by a bounded worker result, never decoded in this refresh path.
    }
}

fn read_location(path: &Path) -> (ExportLocation, bool, String) {
    use std::io::Read;
    let result = match std::fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(65_537)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())
                .and_then(|_| {
                    if bytes.len() > 65_536 {
                        Err("Export location exceeds the size limit".into())
                    } else {
                        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
                    }
                })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ExportLocation::default()),
        Err(e) => Err(e.to_string()),
    };
    match result {
        Ok(location) => (location, true, String::new()),
        Err(error) => (
            ExportLocation::default(),
            false,
            format!(
                "Remembered export location could not be read and will not be overwritten: {error}"
            ),
        ),
    }
}

/// The row's state; a finished conversion also says the size before and after.
fn shown_status(input: &Input) -> String {
    match (&input.source, input.bytes_out) {
        (Ok(source), Some(out)) if input.status == "Done" => format!(
            "Done · {} → {}",
            folders::size_label(source.size),
            folders::size_label(out)
        ),
        _ => input.status.clone(),
    }
}

fn is_audio_only(target: &str) -> bool {
    matches!(target, "mp3" | "m4a" | "flac" | "wav" | "opus")
}

fn retryable(input: &Input) -> bool {
    input.status.starts_with("Failed") || input.status == "Cancelled"
}

fn normalize_groups(inputs: &mut [Input]) {
    for class in [Class::Image, Class::Animated, Class::Audio, Class::Video] {
        let group: Vec<_> = inputs
            .iter()
            .filter(|i| i.source.as_ref().is_ok_and(|s| s.class == class) && i.job.is_none())
            .collect();
        let Some(first) = group.first() else {
            continue;
        };
        let common = first
            .plans
            .iter()
            .filter(|p| {
                group
                    .iter()
                    .all(|i| i.plans.iter().any(|other| other.target == p.target))
            })
            .map(|p| p.target)
            .collect::<Vec<_>>();
        let target = if common.contains(&first.target.as_str()) {
            first.target.clone()
        } else {
            common.first().copied().unwrap_or("").to_owned()
        };
        for input in inputs
            .iter_mut()
            .filter(|i| i.source.as_ref().is_ok_and(|s| s.class == class) && i.job.is_none())
        {
            input.plans.retain(|p| common.contains(&p.target));
            input.target = target.clone();
        }
    }
}

fn update_rows<T: Clone + PartialEq + 'static>(model: &VecModel<T>, rows: Vec<T>) {
    if model.row_count() != rows.len() {
        model.set_vec(rows);
    } else {
        for (index, row) in rows.into_iter().enumerate() {
            if model.row_data(index).as_ref() != Some(&row) {
                model.set_row_data(index, row);
            }
        }
    }
}

struct NativePicker;
impl SavePicker for NativePicker {
    fn pick(&self, name: &str, start: Option<&Path>) -> Option<PathBuf> {
        let mut dialog = rfd::FileDialog::new()
            .set_title("Save converted file")
            .set_file_name(name);
        if let Some(start) = start {
            dialog = dialog.set_directory(start);
        }
        dialog.save_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Duration, Instant},
    };

    fn generated_bmp(path: &Path) {
        let mut bytes = b"BM".to_vec();
        for value in [70_u32, 0, 54, 40, 2, 2] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(1_u16.to_le_bytes());
        bytes.extend(24_u16.to_le_bytes());
        for value in [0_u32, 16, 2835, 2835, 0, 0] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend([10, 20, 30, 40, 50, 60, 0, 0, 10, 20, 30, 40, 50, 60, 0, 0]);
        fs::write(path, bytes).unwrap();
    }

    fn until(mut condition: impl FnMut() -> bool) {
        let limit = Instant::now() + Duration::from_secs(10);
        while !condition() {
            assert!(Instant::now() < limit, "worker did not finish");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn controller_converts_a_batch_and_survives_page_recreation() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().unwrap();
        ui.set_page(4);
        let root = std::env::temp_dir().join(format!(
            "halation-converter-ui-{}-{}",
            std::process::id(),
            WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let profile = Profile::at(&root);
        let engine = JobEngine::new(|| {});
        let controller = Converter::new(ui.as_weak(), profile, engine.clone());
        controller.install(|| Some(1));
        let mut paths = Vec::new();
        for index in 0..11 {
            let path = root.join(format!("generated-{index}.bmp"));
            generated_bmp(&path);
            paths.push(path);
        }
        let broken = root.join("broken.bmp");
        fs::write(&broken, b"BMbroken image").unwrap();
        paths.push(broken);
        controller.add(paths);
        until(|| controller.inbox.lock().unwrap().is_some());
        ui.invoke_converter_loaded();
        assert_eq!(ui.get_convert_rows().row_count(), 12);
        ui.invoke_converter_action("run".into());
        until(|| !engine.busy(Some("converter")) && !engine.busy(Some("converter-preview")));
        let _ = controller.jobs_changed();
        assert_eq!(
            controller
                .state
                .borrow()
                .inputs
                .iter()
                .filter(|i| i.status == "Done")
                .count(),
            11
        );
        assert_eq!(
            fs::read_dir(root.join("Exports/Converted"))
                .unwrap()
                .count(),
            11
        );
        // Written off the UI thread
        until(|| root.join("export-location.json").is_file());
        assert!(
            ui.get_convert_rows()
                .iter()
                .any(|row| row.state.starts_with("Done · ") && row.state.contains(" → ")),
            "finished rows show the size before and after"
        );
        let completed = controller
            .state
            .borrow()
            .inputs
            .iter()
            .position(|i| i.status == "Done")
            .unwrap();
        ui.invoke_converter_select(completed as i32);
        ui.set_page(3);
        ui.set_page(4);
        assert_eq!(
            ui.get_convert_rows().row_count(),
            12,
            "page recreation cannot own or lose input state"
        );
        assert!(ui.get_convert_completed());
        controller.suspend_preview();
        engine.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    /// Acceptance §11.10: the UI thread's share of a running batch (job updates, rows, formats) stays far below a
    /// 50 ms frame-blocking task even with the largest batch a folder can add.
    #[test]
    fn ui_thread_work_stays_small_during_the_largest_batch() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().unwrap();
        ui.set_page(4);
        let root = std::env::temp_dir().join(format!(
            "halation-converter-ui-cost-{}-{}",
            std::process::id(),
            WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let engine = JobEngine::new(|| {});
        let controller = Converter::new(ui.as_weak(), Profile::at(&root), engine.clone());
        controller.install(|| Some(1));
        let paths: Vec<_> = (0..256)
            .map(|index| {
                let path = root.join(format!("generated-{index}.bmp"));
                generated_bmp(&path);
                path
            })
            .collect();
        controller.add(paths);
        until(|| controller.inbox.lock().unwrap().is_some());
        ui.invoke_converter_loaded();
        assert_eq!(ui.get_convert_rows().row_count(), 256);
        ui.invoke_converter_action("run".into());
        let mut times = Vec::new();
        while engine.busy(Some("converter")) || times.is_empty() {
            let started = Instant::now();
            let _ = controller.jobs_changed();
            times.push(started.elapsed());
            std::thread::sleep(Duration::from_millis(2));
        }
        let _ = controller.jobs_changed();
        times.sort();
        // Wall time on a test machine shared with other tests: a single preemption is not the UI's work, so the
        // 95th percentile carries the assertion and the slowest is reported.
        let typical = times[times.len() * 95 / 100];
        println!(
            "{} batch updates, 95th percentile {typical:?}, slowest {:?}",
            times.len(),
            times[times.len() - 1]
        );
        assert!(
            typical < Duration::from_millis(50),
            "95th percentile {typical:?}"
        );
        controller.suspend_preview();
        engine.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    /// Audio preview through the controller with generated audio and a real FFmpeg (skipped, saying so, without one).
    #[test]
    fn audio_preview_plays_seeks_pauses_and_stops_when_leaving() {
        let Some(pair) = components::Ffmpeg::find(&std::env::temp_dir().join("halation-no-tools"))
        else {
            eprintln!("FFmpeg not found: the audio preview controller test did not run");
            return;
        };
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().unwrap();
        ui.set_page(4);
        let root = std::env::temp_dir().join(format!(
            "halation-converter-audio-{}-{}",
            std::process::id(),
            WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("generated-tone.wav");
        let status = std::process::Command::new(&pair.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
            ])
            .arg("sine=frequency=440:sample_rate=44100:duration=20")
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let engine = JobEngine::new(|| {});
        let controller = Converter::new(ui.as_weak(), Profile::at(&root), engine.clone());
        controller.install(|| Some(1));
        controller.add(vec![input]);
        until(|| controller.inbox.lock().unwrap().is_some());
        ui.invoke_converter_loaded();
        assert!(ui.get_convert_audio(), "audio shows the player");
        assert_eq!(ui.get_convert_clock().as_str(), "0:00 / 0:20");
        // The waveform job completes (its result reaches the page through the event loop, absent in this test)
        until(|| !engine.busy(Some("converter-preview")));
        assert!(
            engine
                .jobs()
                .iter()
                .any(|j| j.spec.tool == "converter-preview" && j.state == JobState::Done)
        );
        // Seeking while paused only moves the head
        ui.invoke_converter_seek(0.5);
        assert!(!ui.get_convert_playing());
        assert_eq!(ui.get_convert_clock().as_str(), "0:10 / 0:20");
        ui.invoke_converter_action("play".into());
        assert!(ui.get_convert_playing());
        std::thread::sleep(Duration::from_millis(400));
        controller.tick();
        let position = ui.get_convert_position();
        if controller.audio.borrow().player.is_some() {
            assert!(position > 0.5 && position < 0.6, "{position}");
        } else {
            // No audio device (a CI machine): playback ends with a message instead of hanging
            assert!(!ui.get_convert_message().is_empty());
        }
        ui.invoke_converter_action("forward".into());
        ui.invoke_converter_action("play".into());
        assert!(!ui.get_convert_playing());
        assert!(
            ui.get_convert_position() >= 0.75,
            "{}",
            ui.get_convert_position()
        );
        ui.invoke_converter_action("play".into());
        controller.suspend_preview();
        assert!(
            controller.audio.borrow().player.is_none(),
            "leaving the page stops playback"
        );
        assert!(!ui.get_convert_audio());
        engine.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn group_formats_are_the_intersection_and_one_choice_is_shared() {
        let root =
            std::env::temp_dir().join(format!("halation-converter-group-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("input.bmp");
        generated_bmp(&path);
        let mut source = convert::probe(&path, None).unwrap();
        let mut inputs = Vec::new();
        for format in ["png", "jpg"] {
            source.format = format.into();
            inputs.push(Input {
                path: path.clone(),
                source: Ok(source.clone()),
                plans: convert::targets(&source, None),
                target: if format == "png" { "jpg" } else { "png" }.into(),
                job: None,
                output: None,
                status: "Ready".into(),
                subfolder: None,
                bytes_out: None,
            });
        }
        normalize_groups(&mut inputs);
        assert_eq!(inputs[0].target, inputs[1].target);
        assert!(inputs.iter().all(|i| {
            i.plans
                .iter()
                .all(|p| p.target != "png" && p.target != "jpg")
        }));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn damaged_export_location_is_read_only_instead_of_being_replaced() {
        let root =
            std::env::temp_dir().join(format!("halation-export-location-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("export-location.json");
        let bytes = b"{ damaged export state";
        fs::write(&path, bytes).unwrap();
        let (_, writable, error) = read_location(&path);
        assert!(!writable);
        assert!(!error.is_empty());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::remove_dir_all(root).unwrap();
    }
}
