//! Native Frame Capture controller. Every decoded picture, the queue, the session and the files live here, never in
//! the Slint page: the page only presents what this controller publishes.
//!
//! Decoding is FFmpeg-backed. Interactive stepping decodes one window of frames around the playhead in a single
//! process; dragging the timeline shows the nearest keyframe and releasing settles on the exact frame. Captures always
//! decode the native frame, never the preview.

use crate::{
    profile::Profile,
    strings::Strings,
    ui::{AppWindow, FrameDestinationRow, FrameLayoutRow, FrameQueueRow, FrameResultRow},
};
use halation_core::{
    atomic_file,
    components::{self, Ffmpeg},
    destinations::{Destinations, ExportLocation, SaveMode, SavePicker},
    engine::JobEngine,
    framegrab::{self, Crop, Destination, FrameCache, Layout, Queue, Session, Strip, VideoInfo},
    playback::{self, Picture, Player},
    queue::{JobSpec, JobState, Lane, Priority},
};
use slint::{
    ComponentHandle, Image, Model, ModelRc, Rgba8Pixel, SharedPixelBuffer, VecModel, Weak,
};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

static WORKSPACE: AtomicU64 = AtomicU64::new(0);

/// The preview picture never exceeds this size (the page scales it down further).
const PLAYER_MAX: (u32, u32) = (1280, 720);
/// Thumbnails in the queue.
const THUMB_WIDTH: u32 = 160;

#[derive(Clone)]
struct ResultEntry {
    path: PathBuf,
    n: u64,
    time: String,
    size: (u32, u32),
}

#[derive(Clone)]
struct Captured {
    path: PathBuf,
    n: u64,
    time: String,
    size: (u32, u32),
}

/// One decoded picture's identity, handed from a worker to the event loop. Pictures themselves stay in the byte-bounded
/// cache; the inbox carries only indices and small thumbnails.
enum Done {
    Probed {
        generation: u64,
        path: PathBuf,
        picked: bool,
        info: VideoInfo,
        key: String,
        restore: Option<Session>,
    },
    ProbeFailed {
        generation: u64,
        error: String,
    },
    Analysis {
        generation: u64,
        key: String,
        keys: Vec<u64>,
        strip: Option<Strip>,
    },
    Preview {
        generation: u64,
        requested: u64,
    },
    PreviewFailed {
        generation: u64,
        requested: u64,
        error: String,
    },
    Thumb {
        generation: u64,
        n: u64,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    },
    ThumbFailed {
        generation: u64,
        n: u64,
    },
    Captured {
        generation: u64,
        results: Vec<Captured>,
        failures: Vec<(u64, String)>,
        cancelled: bool,
    },
    Sharpest {
        generation: u64,
        n: u64,
    },
    SharpestFailed {
        generation: u64,
        error: String,
    },
    Installed {
        result: Result<(), String>,
    },
    LocationFailed {
        error: String,
    },
}

#[derive(Default)]
struct Audio {
    player: Option<Player>,
    position: f64,
    picture: Option<Picture>,
}

#[derive(Default)]
struct State {
    ffmpeg: Option<Ffmpeg>,
    install_job: Option<String>,
    video: Option<VideoInfo>,
    path: Option<PathBuf>,
    picked: bool,
    content_key: String,
    n: u64,
    queue: Queue,
    layout: Layout,
    crops: BTreeMap<String, Crop>,
    destination: Destination,
    destinations: Destinations,
    results: Vec<ResultEntry>,
    busy: bool,
    opened: bool,
    message: String,
    sharp_note: String,
    left_open: bool,
    inspector_open: bool,
    scrubbing: bool,
    last_scrub: Option<(Instant, u64)>,
    keys: Vec<u64>,
    strip_image: Option<Image>,
    preview_image: Option<Image>,
    thumbs: HashMap<u64, Image>,
    thumb_requests: HashSet<u64>,
    analysis_job: Option<String>,
    preview_job: Option<String>,
    capture_job: Option<String>,
    capture_total: usize,
    sharp_job: Option<String>,
    last_key_shown: Option<u64>,
    pending_restore: Option<Session>,
    location: ExportLocation,
    location_writable: bool,
    location_saved: Option<Vec<u8>>,
    session_saved: Option<Vec<u8>>,
    audio: Audio,
    volume: f32,
    muted_from: Option<f32>,
}

type SaveModePicker = Rc<dyn Fn() -> Option<u8>>;
type Analysis = (String, Vec<u64>, Option<Strip>);

pub(crate) struct FrameCapture {
    weak: Weak<AppWindow>,
    state: RefCell<State>,
    strings: Strings,
    engine: JobEngine,
    profile: Profile,
    inbox: Arc<Mutex<Vec<Done>>>,
    cache: Arc<Mutex<FrameCache>>,
    queue_model: Rc<VecModel<FrameQueueRow>>,
    layouts_model: Rc<VecModel<FrameLayoutRow>>,
    destinations_model: Rc<VecModel<FrameDestinationRow>>,
    results_model: Rc<VecModel<FrameResultRow>>,
    clock: slint::Timer,
    session_timer: slint::Timer,
    scrub_timer: slint::Timer,
    workspace: PathBuf,
    probe_generation: Arc<AtomicU64>,
    preview_generation: Arc<AtomicU64>,
    analysis_generation: Arc<AtomicU64>,
    thumb_generation: Arc<AtomicU64>,
    capture_generation: Arc<AtomicU64>,
    sharp_generation: Arc<AtomicU64>,
    scrub_generation: Arc<AtomicU64>,
    save_mode: RefCell<Option<SaveModePicker>>,
    last_analysis: RefCell<Option<Analysis>>,
}

impl FrameCapture {
    pub fn new(weak: Weak<AppWindow>, profile: Profile, engine: JobEngine) -> Rc<Self> {
        let tools = profile.root().join("tools");
        let ffmpeg = Ffmpeg::find(&tools);
        let session = Session::read(&profile.root().join("frame-capture.json"));
        let (location, location_writable) =
            read_location(&profile.root().join("export-location.json"));
        let (volume, muted_from) = if session.muted {
            (session.volume, Some(session.volume))
        } else {
            (session.volume, None)
        };
        let mut state = State {
            ffmpeg,
            layout: Layout::from_id(&session.layout).unwrap_or_default(),
            crops: session.crops.clone(),
            destination: Destination::from_id(&session.destination).unwrap_or_default(),
            n: session.n,
            picked: session.picked,
            pending_restore: session.video.clone().map(|_| session.clone()),
            location,
            location_writable,
            inspector_open: true,
            volume,
            muted_from,
            ..Default::default()
        };
        if let Some(path) = &session.video {
            state.path = Some(path.clone());
        }
        let workspace = profile.root().join("workspace").join(format!(
            "frames-{}-{}",
            std::process::id(),
            WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ));
        Rc::new(Self {
            weak,
            state: RefCell::new(state),
            strings: Strings::frame_capture(),
            engine,
            profile,
            inbox: Arc::new(Mutex::new(Vec::new())),
            cache: Arc::new(Mutex::new(FrameCache::new(framegrab::CACHE_BYTES))),
            queue_model: Rc::new(VecModel::default()),
            layouts_model: Rc::new(VecModel::default()),
            destinations_model: Rc::new(VecModel::default()),
            results_model: Rc::new(VecModel::default()),
            clock: slint::Timer::default(),
            session_timer: slint::Timer::default(),
            scrub_timer: slint::Timer::default(),
            workspace,
            probe_generation: Arc::new(AtomicU64::new(0)),
            preview_generation: Arc::new(AtomicU64::new(0)),
            analysis_generation: Arc::new(AtomicU64::new(0)),
            thumb_generation: Arc::new(AtomicU64::new(0)),
            capture_generation: Arc::new(AtomicU64::new(0)),
            sharp_generation: Arc::new(AtomicU64::new(0)),
            scrub_generation: Arc::new(AtomicU64::new(0)),
            save_mode: RefCell::new(None),
            last_analysis: RefCell::new(None),
        })
    }

    pub fn install(self: &Rc<Self>, save_mode: impl Fn() -> Option<u8> + 'static) {
        *self.save_mode.borrow_mut() = Some(Rc::new(save_mode));
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        ui.set_frame_queue(ModelRc::from(self.queue_model.clone()));
        ui.set_frame_layouts(ModelRc::from(self.layouts_model.clone()));
        ui.set_frame_destinations(ModelRc::from(self.destinations_model.clone()));
        ui.set_frame_results(ModelRc::from(self.results_model.clone()));
        ui.set_frame_strings(self.strings.frame_strings());

        let controller = self.clone();
        ui.on_frame_action(move |action| controller.action(action.as_str()));
        let controller = self.clone();
        ui.on_frame_select(move |index| controller.select_row(index));
        let controller = self.clone();
        ui.on_frame_toggle(move |index| controller.toggle_row(index));
        let controller = self.clone();
        ui.on_frame_remove(move |index| controller.remove_row(index));
        let controller = self.clone();
        ui.on_frame_layout(move |id| controller.set_layout(id.as_str()));
        let controller = self.clone();
        ui.on_frame_destination(move |id| controller.set_destination(id.as_str()));
        let controller = self.clone();
        ui.on_frame_scrub(move |fraction, fast| controller.scrub(f64::from(fraction), fast));
        let controller = self.clone();
        ui.on_frame_scrub_end(move |fraction| controller.scrub_end(f64::from(fraction)));
        let controller = self.clone();
        ui.on_frame_crop_set(move |x, y| controller.crop_set(f64::from(x), f64::from(y)));
        let controller = self.clone();
        ui.on_frame_crop_move(move |dx, dy| controller.crop_move(f64::from(dx), f64::from(dy)));
        let controller = self.clone();
        ui.on_frame_seek(move |fraction| controller.seek(f64::from(fraction)));
        let controller = self.clone();
        ui.on_frame_volume_changed(move |value| controller.set_volume(value));
        let controller = self.clone();
        ui.on_frame_dropped(move |data| controller.dropped(&data));
        let controller = self.clone();
        ui.on_frame_reveal(move |index| controller.reveal(index));
        let controller = self.clone();
        ui.on_frame_task_finished(move || controller.task_finished());

        self.refresh();
    }

    /* ===== opening ===== */

    pub fn open(self: &Rc<Self>) {
        let first = !self.state.borrow().opened;
        self.state.borrow_mut().opened = true;
        if first && let Some(ui) = self.weak.upgrade() {
            self.state.borrow_mut().left_open = ui.window().size().width >= 1180;
        }
        let (has_video, n) = {
            let state = self.state.borrow();
            (state.video.is_some(), state.n)
        };
        if has_video {
            self.show_exact(n);
            self.refresh();
            return;
        }
        let pending = self.state.borrow_mut().pending_restore.take();
        if let Some(session) = pending {
            let Some(path) = session.video.clone() else {
                self.refresh();
                return;
            };
            if !path.is_file() {
                self.state.borrow_mut().message = self.strings.get("missing_video").to_owned();
                self.refresh();
                return;
            }
            self.state.borrow_mut().path = Some(path.clone());
            self.state.borrow_mut().picked = session.picked;
            if self.state.borrow().ffmpeg.is_none() {
                self.state.borrow_mut().pending_restore = Some(session);
                self.refresh();
                return;
            }
            self.begin_open(path, session.picked, Some(session));
            return;
        }
        self.refresh();
    }

    /// Leaving the page: playback stops and the decoded cache is released; the picture on screen stays until the next
    /// move decodes again. A capture or analysis job may finish in the background.
    pub fn suspend(self: &Rc<Self>) {
        if !self.state.borrow().opened {
            return;
        }
        self.stop_playback();
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        self.state.borrow_mut().scrubbing = false;
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        self.sharp_generation.fetch_add(1, Ordering::AcqRel);
        self.thumb_generation.fetch_add(1, Ordering::AcqRel);
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        if let Some(id) = self.state.borrow_mut().sharp_job.take() {
            self.engine.cancel(&id);
        }
        self.engine.cancel("frame-thumbs");
        self.state.borrow_mut().thumb_requests.clear();
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.clean_workspace();
        self.flush_session();
    }

    /// Closing the app: stop every process this tool owns and remove its temporary files.
    pub fn shutdown(self: &Rc<Self>) {
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        self.stop_playback();
        for group in [
            "frame-analysis",
            "frame-preview",
            "frame-thumbs",
            "frame-capture",
            "frame-sharp",
            "frame-install",
        ] {
            self.engine.cancel(group);
        }
        self.flush_session();
        self.clean_workspace();
    }

    fn begin_open(self: &Rc<Self>, path: PathBuf, picked: bool, restore: Option<Session>) {
        let Some(ffmpeg) = self.state.borrow().ffmpeg.clone() else {
            self.state.borrow_mut().message = self.strings.get("needs_ffmpeg").to_owned();
            self.refresh();
            return;
        };
        self.stop_playback();
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        for group in [
            "frame-analysis",
            "frame-preview",
            "frame-thumbs",
            "frame-capture",
            "frame-sharp",
        ] {
            self.engine.cancel(group);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        self.analysis_generation.fetch_add(1, Ordering::AcqRel);
        self.capture_generation.fetch_add(1, Ordering::AcqRel);
        self.sharp_generation.fetch_add(1, Ordering::AcqRel);
        self.thumb_generation.fetch_add(1, Ordering::AcqRel);
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.clean_workspace();
        {
            let mut state = self.state.borrow_mut();
            state.busy = true;
            state.message.clear();
            state.video = None;
            state.path = Some(path.clone());
            state.picked = picked;
            state.content_key.clear();
            state.n = 0;
            state.queue.clear();
            state.keys.clear();
            state.strip_image = None;
            state.preview_image = None;
            state.thumbs.clear();
            state.thumb_requests.clear();
            state.sharp_note.clear();
            state.last_key_shown = None;
            state.analysis_job = None;
            state.preview_job = None;
            state.capture_job = None;
            state.sharp_job = None;
            if restore.is_none() {
                state.layout = Layout::default();
                state.crops.clear();
                state.destination = Destination::default();
            }
        }
        let generation = self.probe_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let ffprobe = ffmpeg.ffprobe.clone();
        let probe_path = path.clone();
        let spawn = std::thread::Builder::new()
            .name("frame-probe".into())
            .spawn(move || {
                let result = framegrab::probe(&ffprobe, &probe_path).and_then(|info| {
                    let key = framegrab::content_key(&probe_path)?;
                    Ok((info, key))
                });
                let event = match result {
                    Ok((info, key)) => Done::Probed {
                        generation,
                        path: probe_path,
                        picked,
                        info,
                        key,
                        restore,
                    },
                    Err(error) => Done::ProbeFailed { generation, error },
                };
                inbox
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(event);
                // A closed window is a normal lifecycle end; the owned event is dropped with the callback.
                let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            });
        if let Err(error) = spawn {
            self.state.borrow_mut().busy = false;
            self.state.borrow_mut().message = self
                .strings
                .fill("open_failed", &[("error", error.to_string())]);
        }
        self.refresh();
    }

    fn dropped(self: &Rc<Self>, data: &slint::DataTransfer) {
        let paths = match data.file_paths() {
            Ok(paths) => paths.take(2).map(Path::to_path_buf).collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        match paths.as_slice() {
            [path] => {
                if !framegrab::allowed(path, &allowed_roots(&self.profile), true) {
                    self.state.borrow_mut().message = self.strings.get("not_authorized").to_owned();
                    self.refresh();
                    return;
                }
                self.begin_open(path.clone(), true, None);
            }
            _ => {
                self.state.borrow_mut().message = self.strings.get("drop_one").to_owned();
                self.refresh();
            }
        }
    }

    fn pick_video(self: &Rc<Self>) {
        if self.state.borrow().busy {
            return;
        }
        if self.state.borrow().ffmpeg.is_none() {
            self.state.borrow_mut().message = self.strings.get("needs_ffmpeg").to_owned();
            self.refresh();
            return;
        }
        let picked = rfd::FileDialog::new()
            .set_title(self.strings.get("pick_video_title"))
            .add_filter(
                self.strings.get("video_filter"),
                &["mp4", "m4v", "mov", "webm", "mkv"],
            )
            .pick_file();
        if let Some(path) = picked {
            if !framegrab::allowed(&path, &allowed_roots(&self.profile), true) {
                self.state.borrow_mut().message = self.strings.get("not_authorized").to_owned();
                self.refresh();
                return;
            }
            self.begin_open(path, true, None);
        }
    }

    /* ===== analysis, preview and thumbnails ===== */

    fn request_analysis(self: &Rc<Self>) {
        let (Some(info), Some(path), Some(ffmpeg), key) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
                state.content_key.clone(),
            )
        }) else {
            return;
        };
        let cached = {
            let analysis = self.last_analysis.borrow();
            analysis
                .as_ref()
                .filter(|(cached_key, _, _)| *cached_key == key)
                .map(|(_, keys, strip)| (keys.clone(), strip.clone()))
        };
        if let Some((keys, strip)) = cached {
            self.apply_analysis(key, keys, strip);
            return;
        }
        if let Some(id) = self.state.borrow_mut().analysis_job.take() {
            self.engine.cancel(&id);
        }
        let generation = self.analysis_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.analysis_generation.clone();
        let raw = self.workspace.join(format!("keys-{generation}.rgba"));
        let raw_task = raw.clone();
        let title = self.strings.get("job_analyse").to_owned();
        let stage = self.strings.get("analysing").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Cpu);
        spec.group = Some("frame-analysis".into());
        spec.priority = Priority::Normal;
        spec.detail = info.summary();
        let id = self.engine.submit_task(spec, move |context| {
            let keys = framegrab::keyframes(&ffmpeg.ffprobe, &path, &info)?;
            context.progress(None, &stage);
            let strip =
                framegrab::keyframe_strip(&context, &ffmpeg.ffmpeg, &path, &info, &keys, &raw_task)
                    .ok()
                    .flatten();
            let _ = std::fs::remove_file(&raw_task);
            if current.load(Ordering::Acquire) != generation {
                return Ok(());
            }
            inbox
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(Done::Analysis {
                    generation,
                    key,
                    keys,
                    strip,
                });
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
        self.state.borrow_mut().analysis_job = Some(id);
        self.refresh();
    }

    fn apply_analysis(self: &Rc<Self>, key: String, keys: Vec<u64>, strip: Option<Strip>) {
        let strip_image = strip
            .as_ref()
            .map(|strip| image_from(&strip.rgba, strip.width, strip.height));
        {
            let mut state = self.state.borrow_mut();
            state.analysis_job = None;
            state.keys = keys.clone();
            state.strip_image = strip_image;
            if state.strip_image.is_none() {
                state.message = self.strings.get("timeline_missing").to_owned();
            }
        }
        *self.last_analysis.borrow_mut() = Some((key, keys, strip));
        self.refresh();
    }

    fn request_window(self: &Rc<Self>, n: u64) {
        let (Some(info), Some(path), Some(ffmpeg)) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
            )
        }) else {
            return;
        };
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        let generation = self.preview_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.preview_generation.clone();
        let cache = self.cache.clone();
        let raw = self.workspace.join(format!("preview-{generation}.rgba"));
        let raw_task = raw.clone();
        let from = n.saturating_sub(framegrab::WINDOW_RADIUS);
        let count = (framegrab::WINDOW_RADIUS * 2 + 1).min(info.frames.saturating_sub(from)) as u32;
        let title = self.strings.get("job_preview").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Light);
        spec.group = Some("frame-preview".into());
        spec.priority = Priority::User;
        spec.cost = 4.0;
        spec.detail = format!("{}", n + 1);
        let id = self.engine.submit_task(spec, move |context| {
            let result = framegrab::decode_window(
                framegrab::DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &path,
                    info: &info,
                },
                from,
                count,
                framegrab::PREVIEW_WIDTH,
                &raw_task,
            );
            let _ = std::fs::remove_file(&raw_task);
            if current.load(Ordering::Acquire) != generation {
                return Ok(());
            }
            match result {
                Ok(frames) => {
                    {
                        let mut cache = cache
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        for frame in frames {
                            cache.insert(frame, n);
                        }
                    }
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::Preview {
                            generation,
                            requested: n,
                        });
                }
                Err(error) => {
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::PreviewFailed {
                            generation,
                            requested: n,
                            error,
                        });
                }
            }
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
        self.state.borrow_mut().preview_job = Some(id);
    }

    fn request_keyframe(self: &Rc<Self>, n: u64) {
        let (Some(info), Some(path), Some(ffmpeg)) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
            )
        }) else {
            return;
        };
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        let generation = self.preview_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.preview_generation.clone();
        let cache = self.cache.clone();
        let raw = self.workspace.join(format!("key-{generation}.rgba"));
        let raw_task = raw.clone();
        let title = self.strings.get("job_preview").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Light);
        spec.group = Some("frame-preview".into());
        spec.priority = Priority::User;
        spec.cost = 4.0;
        spec.detail = format!("{}", n + 1);
        let id = self.engine.submit_task(spec, move |context| {
            let result = framegrab::preview_frame(
                framegrab::DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &path,
                    info: &info,
                },
                n,
                framegrab::PREVIEW_WIDTH,
                &raw_task,
            );
            let _ = std::fs::remove_file(&raw_task);
            if current.load(Ordering::Acquire) != generation {
                return Ok(());
            }
            match result {
                Ok(frame) => {
                    cache
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .insert(frame, n);
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::Preview {
                            generation,
                            requested: n,
                        });
                }
                Err(error) => {
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::PreviewFailed {
                            generation,
                            requested: n,
                            error,
                        });
                }
            }
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
        self.state.borrow_mut().preview_job = Some(id);
    }

    fn show_exact(self: &Rc<Self>, n: u64) {
        // A cache hit must invalidate an in-flight keyframe/older exact decode too; otherwise it can paint over the
        // newly settled frame even though no replacement decode was needed.
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        let cached = {
            let cache = self
                .cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            cache.get(n).cloned()
        };
        if let Some(frame) = cached {
            self.set_preview(&frame);
            return;
        }
        self.request_window(n);
    }

    fn set_preview(&self, frame: &framegrab::RawFrame) {
        let image = image_from(&frame.rgba, frame.width, frame.height);
        self.state.borrow_mut().preview_image = Some(image.clone());
        if let Some(ui) = self.weak.upgrade() {
            ui.set_frame_preview(image);
            ui.set_frame_has_preview(true);
        }
    }

    fn request_thumb(self: &Rc<Self>, n: u64) {
        if self.state.borrow().thumbs.contains_key(&n)
            || !self.state.borrow_mut().thumb_requests.insert(n)
        {
            return;
        }
        let (Some(info), Some(path), Some(ffmpeg)) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
            )
        }) else {
            return;
        };
        let generation = self.thumb_generation.load(Ordering::Acquire);
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.thumb_generation.clone();
        let raw = self.workspace.join(format!("thumb-{generation}-{n}.rgba"));
        let raw_task = raw.clone();
        let title = self.strings.get("job_thumb").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Light);
        spec.group = Some("frame-thumbs".into());
        spec.priority = Priority::Background;
        spec.cost = 1.0;
        spec.detail = format!("{}", n + 1);
        self.engine.submit_task(spec, move |context| {
            let result = framegrab::preview_frame(
                framegrab::DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &path,
                    info: &info,
                },
                n,
                THUMB_WIDTH,
                &raw_task,
            );
            let _ = std::fs::remove_file(&raw_task);
            if current.load(Ordering::Acquire) != generation {
                return Ok(());
            }
            match result {
                Ok(frame) => {
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::Thumb {
                            generation,
                            n,
                            width: frame.width,
                            height: frame.height,
                            rgba: frame.rgba,
                        });
                }
                Err(_) => {
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::ThumbFailed { generation, n });
                }
            }
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
    }

    /* ===== navigation and crop ===== */

    fn action(self: &Rc<Self>, action: &str) {
        match action {
            "open" => self.pick_video(),
            "install" => self.install_ffmpeg(),
            "cancel" => self.cancel_all(),
            "play" => self.toggle_playback(),
            "mute" => self.toggle_mute(),
            "back" => self.seek_by(-1.0),
            "forward" => self.seek_by(1.0),
            "add" => self.add_current(),
            "sharp" => self.find_sharpest(),
            "clear" => self.clear_queue(),
            "all" => self.set_all(true),
            "none" => self.set_all(false),
            "capture" => self.capture(),
            "home" => self.go_to(0),
            "end" => {
                let last = self.state.borrow().video.as_ref().map(VideoInfo::last);
                if let Some(last) = last {
                    self.go_to(last);
                }
            }
            "prev" => self.step(-1),
            "next" => self.step(1),
            "second-back" => self.step_by_second(-1),
            "second-forward" => self.step_by_second(1),
            "toggle-queue" => {
                let mut state = self.state.borrow_mut();
                state.left_open = !state.left_open;
                drop(state);
                self.refresh();
            }
            "toggle-inspector" => {
                let mut state = self.state.borrow_mut();
                state.inspector_open = !state.inspector_open;
                drop(state);
                self.refresh();
            }
            _ => {}
        }
    }

    fn step(self: &Rc<Self>, delta: i64) {
        let n = {
            let state = self.state.borrow();
            let Some(info) = &state.video else {
                return;
            };
            let target = state.n as i64 + delta;
            target.clamp(0, info.last() as i64) as u64
        };
        self.go_to(n);
    }

    fn step_by_second(self: &Rc<Self>, direction: i64) {
        let frames = {
            let state = self.state.borrow();
            state
                .video
                .as_ref()
                .map_or(1, |info| (info.fps().round() as i64).max(1))
        };
        self.step(direction * frames);
    }

    fn go_to(self: &Rc<Self>, n: u64) {
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        self.state.borrow_mut().scrubbing = false;
        self.stop_playback();
        let changed = {
            let mut state = self.state.borrow_mut();
            if state.video.is_none() {
                return;
            }
            let changed = state.n != n;
            state.n = n;
            state.sharp_note.clear();
            state.last_key_shown = None;
            changed
        };
        self.show_exact(n);
        self.refresh_labels();
        if changed {
            self.schedule_session();
        }
    }

    fn scrub(self: &Rc<Self>, fraction: f64, _fast: bool) {
        self.stop_playback();
        // A new pointer position invalidates any frame that was requested for the previous one, even when this
        // movement is too slow to request its replacement until the debounce settles.
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        let n = {
            let state = self.state.borrow();
            let Some(info) = &state.video else {
                return;
            };
            info.frame_at(fraction.clamp(0.0, 1.0) * info.duration.max(0.0))
        };
        let fast_motion = {
            let mut state = self.state.borrow_mut();
            let fast = state.last_scrub.is_some_and(|(at, previous)| {
                let elapsed = at.elapsed().as_secs_f64();
                elapsed > 0.0 && previous.abs_diff(n) as f64 / elapsed >= 8.0
            });
            state.last_scrub = Some((Instant::now(), n));
            state.n = n;
            state.sharp_note.clear();
            state.scrubbing = true;
            fast
        };
        if fast_motion {
            let key = {
                let state = self.state.borrow();
                state.keys.iter().min_by_key(|key| key.abs_diff(n)).copied()
            };
            if let Some(key) = key {
                let changed = self.state.borrow().last_key_shown != Some(key);
                if changed {
                    self.state.borrow_mut().last_key_shown = Some(key);
                    let cached = {
                        let cache = self
                            .cache
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        cache.get(key).cloned()
                    };
                    if let Some(frame) = cached {
                        self.set_preview(&frame);
                    } else {
                        self.request_keyframe(key);
                    }
                }
            }
        } else {
            // Slow pointer movement follows exact frames. The ±12 window populates the cache, so subsequent slow
            // movements within it reuse decoded pictures rather than launching one process per frame.
            self.show_exact(n);
        }
        self.schedule_scrub_settle();
        self.refresh_labels();
        self.schedule_session();
    }

    fn scrub_end(self: &Rc<Self>, fraction: f64) {
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        self.stop_playback();
        let n = {
            let state = self.state.borrow();
            let Some(info) = &state.video else {
                return;
            };
            info.frame_at(fraction.clamp(0.0, 1.0) * info.duration.max(0.0))
        };
        {
            let mut state = self.state.borrow_mut();
            state.n = n;
            state.scrubbing = false;
            state.last_scrub = None;
            state.last_key_shown = None;
            state.sharp_note.clear();
        }
        self.show_exact(n);
        self.refresh_labels();
        self.schedule_session();
    }

    /// A pause while the pointer is still down settles on the current exact frame. Repeated movement restarts this
    /// one-shot timer, so a continuous fast drag remains on keyframes and no idle polling is needed.
    fn schedule_scrub_settle(self: &Rc<Self>) {
        let generation = self.scrub_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let weak = Rc::downgrade(self);
        self.scrub_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(160),
            move || {
                if let Some(controller) = weak.upgrade() {
                    controller.settle_scrub(generation);
                }
            },
        );
    }

    fn settle_scrub(self: &Rc<Self>, generation: u64) {
        if generation != self.scrub_generation.load(Ordering::Acquire)
            || !self.state.borrow().scrubbing
        {
            return;
        }
        let n = self.state.borrow().n;
        self.show_exact(n);
    }

    fn seek(self: &Rc<Self>, fraction: f64) {
        self.stop_playback();
        let n = {
            let state = self.state.borrow();
            let Some(info) = &state.video else {
                return;
            };
            info.frame_at(fraction.clamp(0.0, 1.0) * info.duration.max(0.0))
        };
        self.go_to(n);
    }

    fn crop_for(&self, state: &State) -> Crop {
        state
            .crops
            .get(state.layout.id())
            .copied()
            .or_else(|| {
                state
                    .video
                    .as_ref()
                    .map(|info| framegrab::default_crop(info, state.layout))
            })
            .unwrap_or(Crop::FULL)
    }

    fn set_layout(self: &Rc<Self>, id: &str) {
        let Some(layout) = Layout::from_id(id) else {
            return;
        };
        {
            let mut state = self.state.borrow_mut();
            state.layout = layout;
            let crop = state
                .crops
                .get(layout.id())
                .copied()
                .or_else(|| {
                    state
                        .video
                        .as_ref()
                        .map(|info| framegrab::default_crop(info, layout))
                })
                .unwrap_or(Crop::FULL);
            state.crops.insert(layout.id().into(), crop);
        }
        self.refresh();
        self.schedule_session();
    }

    fn crop_set(self: &Rc<Self>, x: f64, y: f64) {
        {
            let mut state = self.state.borrow_mut();
            if state.video.is_none() {
                return;
            }
            let current = self.crop_for(&state);
            let crop = Crop { x, y, ..current }.clamped();
            let layout = state.layout.id().to_owned();
            state.crops.insert(layout, crop);
        }
        self.refresh_crop();
        self.schedule_session();
    }

    fn crop_move(self: &Rc<Self>, dx: f64, dy: f64) {
        {
            let mut state = self.state.borrow_mut();
            if state.video.is_none() {
                return;
            }
            let current = self.crop_for(&state);
            let crop = framegrab::move_crop(current, dx, dy);
            let layout = state.layout.id().to_owned();
            state.crops.insert(layout, crop);
        }
        self.refresh_crop();
        self.schedule_session();
    }

    fn set_destination(self: &Rc<Self>, id: &str) {
        let Some(destination) = Destination::from_id(id) else {
            return;
        };
        self.state.borrow_mut().destination = destination;
        self.refresh();
        self.schedule_session();
    }

    /* ===== queue ===== */

    fn add_current(self: &Rc<Self>) {
        let (n, has_video) = {
            let state = self.state.borrow();
            (state.n, state.video.is_some())
        };
        if !has_video {
            return;
        }
        let outcome = self.state.borrow_mut().queue.add(n);
        match outcome {
            framegrab::AddOutcome::Full => {
                self.state.borrow_mut().message = self.strings.get("queue_full").to_owned();
            }
            framegrab::AddOutcome::Added | framegrab::AddOutcome::Selected => {
                self.state.borrow_mut().message.clear();
                self.request_thumb(n);
            }
        }
        self.refresh();
        self.schedule_session();
    }

    fn select_row(self: &Rc<Self>, index: i32) {
        let n = {
            let state = self.state.borrow();
            usize::try_from(index)
                .ok()
                .and_then(|index| state.queue.items().get(index))
                .map(|item| item.n)
        };
        if let Some(n) = n {
            self.go_to(n);
        }
    }

    fn toggle_row(self: &Rc<Self>, index: i32) {
        let n = {
            let state = self.state.borrow();
            usize::try_from(index)
                .ok()
                .and_then(|index| state.queue.items().get(index))
                .map(|item| item.n)
        };
        if let Some(n) = n {
            self.state.borrow_mut().queue.toggle(n);
            self.refresh();
            self.schedule_session();
        }
    }

    fn remove_row(self: &Rc<Self>, index: i32) {
        let n = {
            let state = self.state.borrow();
            usize::try_from(index)
                .ok()
                .and_then(|index| state.queue.items().get(index))
                .map(|item| item.n)
        };
        if let Some(n) = n {
            self.state.borrow_mut().queue.remove(n);
            self.state.borrow_mut().thumbs.remove(&n);
            self.refresh();
            self.schedule_session();
        }
    }

    fn set_all(self: &Rc<Self>, selected: bool) {
        self.state.borrow_mut().queue.set_all(selected);
        self.refresh();
        self.schedule_session();
    }

    fn clear_queue(self: &Rc<Self>) {
        self.thumb_generation.fetch_add(1, Ordering::AcqRel);
        self.engine.cancel("frame-thumbs");
        {
            let mut state = self.state.borrow_mut();
            state.queue.clear();
            state.thumbs.clear();
            state.thumb_requests.clear();
        }
        self.refresh();
        self.schedule_session();
    }

    /* ===== sharpest ===== */

    fn find_sharpest(self: &Rc<Self>) {
        let (Some(info), Some(path), Some(ffmpeg), n) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
                state.n,
            )
        }) else {
            return;
        };
        if self.state.borrow().sharp_job.is_some() {
            return;
        }
        self.stop_playback();
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        let generation = self.sharp_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.sharp_generation.clone();
        let raw = self.workspace.join(format!("sharp-{generation}.rgba"));
        let raw_task = raw.clone();
        let title = self.strings.get("job_sharp").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Cpu);
        spec.group = Some("frame-sharp".into());
        spec.priority = Priority::User;
        spec.detail = format!("{}", n + 1);
        let id = self.engine.submit_task(spec, move |context| {
            let result = framegrab::sharpest_near(
                framegrab::DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &path,
                    info: &info,
                },
                n,
                &raw_task,
            );
            let _ = std::fs::remove_file(&raw_task);
            if current.load(Ordering::Acquire) != generation {
                return Ok(());
            }
            let event = match result {
                Ok(n) => Done::Sharpest { generation, n },
                Err(error) => Done::SharpestFailed { generation, error },
            };
            inbox
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(event);
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
        self.state.borrow_mut().sharp_job = Some(id);
        self.refresh();
    }

    /* ===== capture ===== */

    fn capture(self: &Rc<Self>) {
        let (Some(info), Some(path), Some(ffmpeg)) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
            )
        }) else {
            return;
        };
        if self.state.borrow().capture_job.is_some() {
            return;
        }
        let selected = self.state.borrow().queue.selected();
        if selected.is_empty() {
            return;
        }
        let crop = {
            let state = self.state.borrow();
            self.crop_for(&state)
        };
        let (mode, base) = {
            let state = self.state.borrow();
            let mode = match state.destination {
                Destination::Library => SaveMode::HalationFolder,
                Destination::Image => match self.save_mode.borrow().as_ref().and_then(|f| f()) {
                    Some(1) => SaveMode::HalationFolder,
                    // Never chosen yet: ask, like the global policy's default
                    _ => SaveMode::AskEveryTime,
                },
            };
            let base = match state.destination {
                Destination::Library => self.profile.sections_root().join("Frames"),
                Destination::Image => self.profile.root().join("Exports").join("Frames"),
            };
            (mode, base)
        };
        let title = self.strings.get("save_png_title").to_owned();
        let filter = self.strings.get("png_filter").to_owned();
        let picker = NativePicker { title, filter };
        let mut outputs = Vec::with_capacity(selected.len());
        for n in &selected {
            let name = framegrab::capture_name(&path, *n);
            let resolved = {
                let mut state = self.state.borrow_mut();
                let State {
                    destinations,
                    location,
                    ..
                } = &mut *state;
                destinations.resolve(mode, &base, &name, None, location, &picker)
            };
            match resolved {
                Ok(Some(output)) => {
                    if output == path || !self.state.borrow().destinations.allows(&output) {
                        self.state.borrow_mut().message =
                            self.strings.get("capture_none").to_owned();
                        self.refresh();
                        return;
                    }
                    outputs.push((*n, output));
                }
                Ok(None) => {
                    self.state.borrow_mut().message = self.strings.get("cancelled").to_owned();
                    self.refresh();
                    return;
                }
                Err(error) => {
                    self.state.borrow_mut().message = error;
                    self.refresh();
                    return;
                }
            }
        }
        let total = outputs.len();
        let generation = self.capture_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let current = self.capture_generation.clone();
        let stage = self.strings.get("capture").to_owned();
        let job_title = self.strings.get("job_capture").to_owned();
        let workspace = self.workspace.clone();
        let mut spec = JobSpec::new("frame-capture", &job_title, Lane::Light);
        spec.group = Some("frame-capture".into());
        spec.priority = Priority::User;
        spec.cost = 4.0;
        spec.detail = info.summary();
        let id = self.engine.submit_task(spec, move |context| {
            let mut results = Vec::new();
            let mut failures = Vec::new();
            let mut cancelled = false;
            for (done, (n, output)) in outputs.into_iter().enumerate() {
                if context.check_cancelled().is_err() {
                    cancelled = true;
                    break;
                }
                let raw = workspace.join(format!("capture-{generation}-{n}.rgba"));
                let result = framegrab::capture_png(
                    framegrab::DecodeSource {
                        context: &context,
                        ffmpeg: &ffmpeg.ffmpeg,
                        input: &path,
                        info: &info,
                    },
                    n,
                    crop,
                    &output,
                    &raw,
                );
                let _ = std::fs::remove_file(&raw);
                match result {
                    Ok((width, height)) => results.push(Captured {
                        path: output,
                        n,
                        time: info.time_label(n),
                        size: (width, height),
                    }),
                    Err(error) => {
                        if context.check_cancelled().is_err() {
                            cancelled = true;
                            break;
                        }
                        failures.push((n, error));
                    }
                }
                context.progress(Some((done + 1) as f32 / total.max(1) as f32), &stage);
            }
            if current.load(Ordering::Acquire) == generation {
                inbox
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(Done::Captured {
                        generation,
                        results,
                        failures,
                        cancelled,
                    });
                let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            }
            Ok(())
        });
        {
            let mut state = self.state.borrow_mut();
            state.capture_job = Some(id);
            state.capture_total = total;
            state.message.clear();
        }
        self.refresh();
    }

    fn cancel_all(self: &Rc<Self>) {
        self.scrub_timer.stop();
        self.scrub_generation.fetch_add(1, Ordering::AcqRel);
        self.state.borrow_mut().scrubbing = false;
        for group in [
            "frame-analysis",
            "frame-preview",
            "frame-thumbs",
            "frame-capture",
            "frame-sharp",
            "frame-install",
        ] {
            self.engine.cancel(group);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        self.analysis_generation.fetch_add(1, Ordering::AcqRel);
        self.capture_generation.fetch_add(1, Ordering::AcqRel);
        self.sharp_generation.fetch_add(1, Ordering::AcqRel);
        self.thumb_generation.fetch_add(1, Ordering::AcqRel);
        {
            let mut state = self.state.borrow_mut();
            state.analysis_job = None;
            state.preview_job = None;
            state.capture_job = None;
            state.sharp_job = None;
            state.install_job = None;
            state.message = self.strings.get("cancelled").to_owned();
        }
        self.refresh();
    }

    fn reveal(self: &Rc<Self>, index: i32) {
        let path = {
            let state = self.state.borrow();
            usize::try_from(index)
                .ok()
                .and_then(|index| state.results.get(index))
                .map(|result| result.path.clone())
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
            self.state.borrow_mut().message = self
                .strings
                .fill("reveal_failed", &[("error", error.to_string())]);
            self.refresh();
        }
    }

    /* ===== playback ===== */

    fn toggle_playback(self: &Rc<Self>) {
        let playing = self.state.borrow().audio.player.is_some();
        if playing {
            self.pause();
        } else {
            self.play_from_current();
        }
    }

    fn play_from_current(self: &Rc<Self>) {
        let (Some(info), Some(path), Some(ffmpeg)) = ({
            let state = self.state.borrow();
            (
                state.video.clone(),
                state.path.clone(),
                state.ffmpeg.clone(),
            )
        }) else {
            return;
        };
        self.stop_playback();
        if let Some(id) = self.state.borrow_mut().preview_job.take() {
            self.engine.cancel(&id);
        }
        self.preview_generation.fetch_add(1, Ordering::AcqRel);
        let (n, volume) = {
            let state = self.state.borrow();
            (state.n, state.volume)
        };
        let from = if n >= info.last() { 0.0 } else { info.time(n) };
        let picture = Picture::fit(
            info.width,
            info.height,
            info.fps(),
            PLAYER_MAX.0,
            PLAYER_MAX.1,
        );
        let player = Player::start_media(
            &ffmpeg.ffmpeg,
            &path,
            from,
            info.has_audio,
            picture,
            volume,
            playback::system_output(),
        );
        {
            let mut state = self.state.borrow_mut();
            state.audio = Audio {
                player: Some(player),
                position: from,
                picture,
            };
        }
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
        if let Some(ui) = self.weak.upgrade() {
            ui.set_frame_playing(true);
        }
        self.refresh_labels();
    }

    fn pause(self: &Rc<Self>) {
        self.clock.stop();
        let position = {
            let mut state = self.state.borrow_mut();
            let position = state
                .audio
                .player
                .as_ref()
                .map_or(state.audio.position, Player::position);
            if let Some(player) = state.audio.player.take() {
                player.stop();
            }
            state.audio.position = position;
            position
        };
        if let Some(ui) = self.weak.upgrade() {
            ui.set_frame_playing(false);
        }
        let n = {
            let state = self.state.borrow();
            state
                .video
                .as_ref()
                .map(|info| info.frame_at(position))
                .unwrap_or(state.n)
        };
        self.state.borrow_mut().n = n;
        self.show_exact(n);
        self.refresh_labels();
        self.schedule_session();
    }

    fn stop_playback(&self) {
        self.clock.stop();
        let had = {
            let mut state = self.state.borrow_mut();
            let had = state.audio.player.is_some();
            if let Some(player) = state.audio.player.take() {
                state.audio.position = player.position();
                player.stop();
            }
            had
        };
        if had && let Some(ui) = self.weak.upgrade() {
            ui.set_frame_playing(false);
        }
    }

    fn seek_by(self: &Rc<Self>, seconds: f64) {
        let (duration, position, playing) = {
            let state = self.state.borrow();
            let Some(info) = &state.video else {
                return;
            };
            // While paused the audio clock still holds the last played position, so the step starts from the frame
            // on screen; otherwise a step after manual navigation would jump back to where playback stopped.
            let position = if state.audio.player.is_some() {
                state.audio.position
            } else {
                info.time(state.n)
            };
            (info.duration, position, state.audio.player.is_some())
        };
        let target = (position + seconds).clamp(0.0, duration.max(0.0));
        let n = {
            let state = self.state.borrow();
            state
                .video
                .as_ref()
                .map_or(state.n, |info| info.frame_at(target))
        };
        if playing {
            self.pause();
        }
        self.go_to(n);
    }

    fn tick(self: &Rc<Self>) {
        let (position, finished, error, frame, picture) = {
            let state = self.state.borrow();
            let Some(player) = state.audio.player.as_ref() else {
                self.clock.stop();
                return;
            };
            (
                player.position(),
                player.finished(),
                player.error(),
                player.take_frame(),
                state.audio.picture,
            )
        };
        if let (Some(picture), Some(frame)) = (picture, frame) {
            let image = image_from(&frame, picture.width, picture.height);
            if let Some(ui) = self.weak.upgrade() {
                ui.set_frame_preview(image.clone());
                ui.set_frame_has_preview(true);
            }
            self.state.borrow_mut().preview_image = Some(image);
            if let Some(player) = self.state.borrow().audio.player.as_ref() {
                player.recycle(frame);
            }
        }
        {
            let mut state = self.state.borrow_mut();
            state.audio.position = position;
            if let Some(info) = &state.video {
                state.n = info.frame_at(position);
            }
        }
        if finished {
            self.clock.stop();
            let mut state = self.state.borrow_mut();
            state.audio.player = None;
            let n = state
                .video
                .as_ref()
                .map(|info| info.frame_at(position))
                .unwrap_or(state.n);
            state.n = n;
            drop(state);
            if let Some(ui) = self.weak.upgrade() {
                ui.set_frame_playing(false);
            }
            if let Some(error) = error {
                self.state.borrow_mut().message =
                    self.strings.fill("playback_failed", &[("error", error)]);
            }
            self.show_exact(n);
            self.refresh_labels();
            self.schedule_session();
            self.refresh();
            return;
        }
        self.refresh_labels();
    }

    fn toggle_mute(self: &Rc<Self>) {
        let current = self.display_volume();
        match self.state.borrow_mut().muted_from.take() {
            Some(before) if current == 0.0 => self.set_volume(before),
            _ if current > 0.0 => {
                let before = self.state.borrow().volume;
                self.state.borrow_mut().muted_from = Some(before);
                self.set_volume(0.0);
            }
            _ => self.set_volume(1.0),
        }
    }

    fn display_volume(&self) -> f32 {
        if self.state.borrow().muted_from.is_some() {
            0.0
        } else {
            self.state.borrow().volume
        }
    }

    fn set_volume(self: &Rc<Self>, value: f32) {
        let value = value.clamp(0.0, 1.0);
        {
            let mut state = self.state.borrow_mut();
            if value > 0.0 {
                state.muted_from = None;
            }
            state.volume = value;
            if let Some(player) = state.audio.player.as_ref() {
                player.set_volume(value);
            }
        }
        if let Some(ui) = self.weak.upgrade() {
            ui.set_frame_volume(value);
        }
        self.schedule_session();
    }

    /* ===== install ===== */

    fn install_ffmpeg(self: &Rc<Self>) {
        {
            let state = self.state.borrow();
            if state.ffmpeg.is_some() || state.install_job.is_some() || state.busy {
                return;
            }
        }
        let tools = self.profile.root().join("tools");
        let workspace = self.workspace.join(format!(
            "install-{}",
            self.capture_generation.fetch_add(1, Ordering::AcqRel)
        ));
        let title = self.strings.get("job_install").to_owned();
        let mut spec = JobSpec::new("frame-capture", &title, Lane::Net);
        spec.group = Some("frame-install".into());
        spec.priority = Priority::User;
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let id = self.engine.submit_task(spec, move |context| {
            let result = components::install_ffmpeg(&context, &tools, &workspace);
            inbox
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(Done::Installed { result });
            let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
            Ok(())
        });
        self.state.borrow_mut().install_job = Some(id);
        self.refresh();
    }

    /* ===== worker results ===== */

    fn task_finished(self: &Rc<Self>) {
        let events = {
            let mut inbox = self
                .inbox
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            std::mem::take(&mut *inbox)
        };
        for event in events {
            self.handle(event);
        }
        self.refresh();
    }

    fn handle(self: &Rc<Self>, event: Done) {
        match event {
            Done::Probed {
                generation,
                path,
                picked,
                info,
                key,
                restore,
            } => {
                if generation != self.probe_generation.load(Ordering::Acquire) {
                    return;
                }
                let (layout, crops, destination, volume, muted_from, n, queue) = match &restore {
                    Some(session) => (
                        Layout::from_id(&session.layout).unwrap_or_default(),
                        session.crops.clone(),
                        Destination::from_id(&session.destination).unwrap_or_default(),
                        session.volume,
                        if session.muted {
                            Some(session.volume)
                        } else {
                            None
                        },
                        session.n.min(info.last()),
                        session.queue.clone(),
                    ),
                    None => (
                        Layout::default(),
                        BTreeMap::new(),
                        Destination::default(),
                        self.state.borrow().volume,
                        self.state.borrow().muted_from,
                        0,
                        Vec::new(),
                    ),
                };
                let crop = crops
                    .get(layout.id())
                    .copied()
                    .unwrap_or_else(|| framegrab::default_crop(&info, layout));
                {
                    let mut state = self.state.borrow_mut();
                    state.busy = false;
                    state.video = Some(info);
                    state.path = Some(path);
                    state.picked = picked;
                    state.content_key = key;
                    state.n = n;
                    state.layout = layout;
                    state.crops = crops;
                    state.crops.insert(layout.id().into(), crop);
                    state.destination = destination;
                    state.volume = volume;
                    state.muted_from = muted_from;
                    state.queue.restore(queue);
                    state.message.clear();
                    state.preview_image = None;
                    state.strip_image = None;
                    state.keys.clear();
                    state.last_key_shown = None;
                }
                self.refresh();
                self.show_exact(n);
                let queued = self.state.borrow().queue.items().to_vec();
                for item in queued {
                    self.request_thumb(item.n);
                }
                self.request_analysis();
                self.schedule_session();
            }
            Done::ProbeFailed { generation, error } => {
                if generation != self.probe_generation.load(Ordering::Acquire) {
                    return;
                }
                {
                    let mut state = self.state.borrow_mut();
                    state.busy = false;
                    state.video = None;
                    state.path = None;
                    state.message = self.strings.fill("open_failed", &[("error", error)]);
                }
                self.refresh();
            }
            Done::Analysis {
                generation,
                key,
                keys,
                strip,
            } => {
                if generation != self.analysis_generation.load(Ordering::Acquire) {
                    return;
                }
                self.apply_analysis(key, keys, strip);
            }
            Done::Preview {
                generation,
                requested,
            } => {
                if generation != self.preview_generation.load(Ordering::Acquire) {
                    return;
                }
                self.state.borrow_mut().preview_job = None;
                let cached = {
                    let cache = self
                        .cache
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    cache.get(requested).cloned()
                };
                if let Some(frame) = cached {
                    self.set_preview(&frame);
                }
            }
            Done::PreviewFailed {
                generation,
                requested,
                error,
            } => {
                if generation != self.preview_generation.load(Ordering::Acquire) {
                    return;
                }
                self.state.borrow_mut().preview_job = None;
                if !error.is_empty() {
                    self.state.borrow_mut().message = self.strings.fill(
                        "frame_failed",
                        &[("n", (requested + 1).to_string()), ("error", error)],
                    );
                }
            }
            Done::Thumb {
                generation,
                n,
                width,
                height,
                rgba,
            } => {
                if generation != self.thumb_generation.load(Ordering::Acquire) {
                    return;
                }
                let mut state = self.state.borrow_mut();
                state.thumb_requests.remove(&n);
                if state.queue.items().iter().any(|item| item.n == n) {
                    state.thumbs.insert(n, image_from(&rgba, width, height));
                }
            }
            Done::ThumbFailed { generation, n } => {
                if generation != self.thumb_generation.load(Ordering::Acquire) {
                    return;
                }
                self.state.borrow_mut().thumb_requests.remove(&n);
            }
            Done::Captured {
                generation,
                results,
                failures,
                cancelled,
            } => {
                if generation != self.capture_generation.load(Ordering::Acquire) {
                    return;
                }
                {
                    let mut state = self.state.borrow_mut();
                    state.capture_job = None;
                    state.busy = false;
                }
                let mut completed = Vec::new();
                for captured in results {
                    let completion = {
                        let mut state = self.state.borrow_mut();
                        let State {
                            destinations,
                            location,
                            ..
                        } = &mut *state;
                        destinations.complete(&captured.path, location)
                    };
                    if let Err(error) = completion {
                        self.state.borrow_mut().message = error;
                    }
                    completed.push(captured);
                }
                {
                    // Newest first, as the Tauri viewer: the last frame captured in this batch leads.
                    let mut state = self.state.borrow_mut();
                    for captured in &completed {
                        state.results.insert(
                            0,
                            ResultEntry {
                                path: captured.path.clone(),
                                n: captured.n,
                                time: captured.time.clone(),
                                size: captured.size,
                            },
                        );
                    }
                    state.results.truncate(framegrab::RESULT_KEEP);
                }
                self.save_location();
                let message = if cancelled {
                    self.strings.get("cancelled").to_owned()
                } else if failures.is_empty() {
                    self.strings
                        .fill("saved", &[("n", completed.len().to_string())])
                } else if completed.is_empty() {
                    let (n, error) = &failures[0];
                    self.strings.fill(
                        "capture_failed",
                        &[("n", (n + 1).to_string()), ("error", error.clone())],
                    )
                } else {
                    let (_, error) = &failures[0];
                    self.strings.fill(
                        "capture_partial",
                        &[
                            ("saved", completed.len().to_string()),
                            ("failed", failures.len().to_string()),
                            ("error", error.clone()),
                        ],
                    )
                };
                self.state.borrow_mut().message = message;
                self.schedule_session();
            }
            Done::Sharpest { generation, n } => {
                if generation != self.sharp_generation.load(Ordering::Acquire) {
                    return;
                }
                self.state.borrow_mut().sharp_job = None;
                self.state.borrow_mut().n = n;
                self.state.borrow_mut().sharp_note =
                    self.strings.fill("sharpest", &[("n", (n + 1).to_string())]);
                self.show_exact(n);
                self.refresh_labels();
                self.schedule_session();
            }
            Done::SharpestFailed { generation, error } => {
                if generation != self.sharp_generation.load(Ordering::Acquire) {
                    return;
                }
                self.state.borrow_mut().sharp_job = None;
                self.state.borrow_mut().message =
                    self.strings.fill("sharp_failed", &[("error", error)]);
            }
            Done::Installed { result } => {
                self.state.borrow_mut().install_job = None;
                match result {
                    Ok(()) => {
                        let ffmpeg = Ffmpeg::find(&self.profile.root().join("tools"));
                        self.state.borrow_mut().ffmpeg = ffmpeg.clone();
                        self.state.borrow_mut().message =
                            self.strings.get("install_done").to_owned();
                        if ffmpeg.is_some()
                            && let Some(session) = self.state.borrow_mut().pending_restore.take()
                            && let Some(path) = session.video.clone()
                        {
                            self.begin_open(path, session.picked, Some(session));
                        }
                    }
                    Err(error) => {
                        self.state.borrow_mut().message =
                            self.strings.fill("install_failed", &[("error", error)]);
                    }
                }
            }
            Done::LocationFailed { error } => {
                self.state.borrow_mut().message =
                    self.strings.fill("location_failed", &[("error", error)]);
            }
        }
    }

    /// Called by the app when the engine's job list changes. It never touches worker results: those arrive through the
    /// inbox. Only a failed or cancelled job whose worker could not report is cleared here.
    pub fn jobs_changed(self: &Rc<Self>) {
        let jobs = self.engine.jobs();
        let mut state = self.state.borrow_mut();
        if let Some(id) = state.install_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
            && job.state.finished()
            && job.state != JobState::Done
        {
            let error = match &job.state {
                JobState::Failed(error) => error.clone(),
                _ => self.strings.get("cancelled").to_owned(),
            };
            state.install_job = None;
            state.message = self.strings.fill("install_failed", &[("error", error)]);
        }
        if let Some(id) = state.capture_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
            && job.state.finished()
            && job.state != JobState::Done
        {
            state.capture_job = None;
            state.busy = false;
            state.message = self.strings.get("cancelled").to_owned();
            self.capture_generation.fetch_add(1, Ordering::AcqRel);
        }
        if let Some(id) = state.analysis_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
            && job.state.finished()
            && job.state != JobState::Done
        {
            state.analysis_job = None;
            state.message = self.strings.get("timeline_missing").to_owned();
        }
        if let Some(id) = state.sharp_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
            && job.state.finished()
            && job.state != JobState::Done
        {
            let error = match &job.state {
                JobState::Failed(error) => error.clone(),
                _ => self.strings.get("cancelled").to_owned(),
            };
            state.sharp_job = None;
            state.message = self.strings.fill("sharp_failed", &[("error", error)]);
        }
        if let Some(id) = state.preview_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
            && job.state.finished()
        {
            state.preview_job = None;
        }
        drop(state);
        self.refresh_progress();
    }

    /* ===== refresh ===== */

    fn refresh(self: &Rc<Self>) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let state = self.state.borrow();
        let strings = &self.strings;
        let info = state.video.as_ref();
        ui.set_frame_has_video(info.is_some());
        ui.set_frame_needs_ffmpeg(state.ffmpeg.is_none());
        ui.set_frame_installing(state.install_job.is_some());
        ui.set_frame_busy(
            state.busy
                || state.analysis_job.is_some()
                || state.capture_job.is_some()
                || state.sharp_job.is_some()
                || state.install_job.is_some(),
        );
        ui.set_frame_message(state.message.as_str().into());
        ui.set_frame_left_open(state.left_open);
        ui.set_frame_inspector_open(state.inspector_open);
        ui.set_frame_selected_count(state.queue.selected().len() as i32);
        ui.set_frame_can_capture(
            info.is_some()
                && state.ffmpeg.is_some()
                && !state.queue.selected().is_empty()
                && state.capture_job.is_none(),
        );
        ui.set_frame_selected_label(
            if state.queue.selected().is_empty() {
                String::new()
            } else {
                strings.fill(
                    "selected_count",
                    &[("n", state.queue.selected().len().to_string())],
                )
            }
            .into(),
        );
        ui.set_frame_sharp_note(state.sharp_note.as_str().into());
        ui.set_frame_has_preview(state.preview_image.is_some());
        if let Some(image) = &state.preview_image {
            ui.set_frame_preview(image.clone());
        }
        ui.set_frame_has_strip(state.strip_image.is_some());
        if let Some(image) = &state.strip_image {
            ui.set_frame_strip(image.clone());
        }
        ui.set_frame_volume(self.display_volume());
        ui.set_frame_video_width(info.map_or(0, |info| info.width.min(i32::MAX as u32) as i32));
        ui.set_frame_video_height(info.map_or(0, |info| info.height.min(i32::MAX as u32) as i32));
        ui.set_frame_frames(info.map_or(0, |info| info.frames.min(i32::MAX as u64) as i32));
        ui.set_frame_current(state.n.min(i32::MAX as u64) as i32);
        let crop = self.crop_for(&state);
        ui.set_frame_crop_visible(info.is_some() && !crop.is_full());
        ui.set_frame_crop_x(crop.x as f32);
        ui.set_frame_crop_y(crop.y as f32);
        ui.set_frame_crop_w(crop.w as f32);
        ui.set_frame_crop_h(crop.h as f32);
        update_rows(
            &self.queue_model,
            state
                .queue
                .items()
                .iter()
                .enumerate()
                .map(|(index, item)| FrameQueueRow {
                    index: index as i32,
                    n: item.n.min(i32::MAX as u64) as i32,
                    label: strings
                        .fill("frame_short", &[("n", (item.n + 1).to_string())])
                        .into(),
                    time: info
                        .map_or(String::new(), |info| info.time_label(item.n))
                        .into(),
                    selected: item.selected,
                    thumb: state.thumbs.get(&item.n).cloned().unwrap_or_default(),
                })
                .collect(),
        );
        update_rows(
            &self.layouts_model,
            Layout::ALL
                .iter()
                .map(|layout| FrameLayoutRow {
                    id: layout.id().into(),
                    label: layout_label(strings, *layout).into(),
                    detail: layout_detail(strings, *layout).into(),
                    selected: *layout == state.layout,
                })
                .collect(),
        );
        update_rows(
            &self.destinations_model,
            Destination::ALL
                .iter()
                .map(|destination| FrameDestinationRow {
                    id: destination.id().into(),
                    label: destination_label(strings, *destination).into(),
                    detail: destination_detail(strings, *destination).into(),
                    selected: *destination == state.destination,
                })
                .collect(),
        );
        update_rows(
            &self.results_model,
            state
                .results
                .iter()
                .enumerate()
                .map(|(index, result)| FrameResultRow {
                    index: index as i32,
                    name: result
                        .path
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
                        .into(),
                    detail: strings
                        .fill(
                            "result_detail",
                            &[
                                (
                                    "frame",
                                    strings
                                        .fill("frame_short", &[("n", (result.n + 1).to_string())]),
                                ),
                                ("time", result.time.clone()),
                                ("size", format!("{} × {}", result.size.0, result.size.1)),
                            ],
                        )
                        .into(),
                    path: result.path.to_string_lossy().as_ref().into(),
                })
                .collect(),
        );
        if let Some(info) = info {
            ui.set_frame_frame_label(
                strings
                    .fill(
                        "frame_of",
                        &[
                            ("n", (state.n + 1).to_string()),
                            ("total", info.frames.to_string()),
                        ],
                    )
                    .into(),
            );
            ui.set_frame_time(
                strings
                    .fill(
                        "time_of",
                        &[
                            ("time", info.time_label(state.n)),
                            ("duration", framegrab::time_label(info.duration)),
                        ],
                    )
                    .into(),
            );
            ui.set_frame_clock(
                format!(
                    "{} / {}",
                    info.time_label(state.n),
                    framegrab::time_label(info.duration)
                )
                .into(),
            );
            let position = if state.audio.player.is_some() {
                (state.audio.position / info.duration.max(f64::EPSILON)) as f32
            } else if info.frames > 1 {
                state.n as f32 / (info.frames - 1) as f32
            } else {
                0.0
            };
            ui.set_frame_position(position.clamp(0.0, 1.0));
        } else {
            ui.set_frame_frame_label(Default::default());
            ui.set_frame_time(Default::default());
            ui.set_frame_clock(Default::default());
            ui.set_frame_position(0.0);
        }
        ui.set_frame_playing(state.audio.player.is_some());
        drop(state);
        self.refresh_progress();
    }

    fn refresh_labels(self: &Rc<Self>) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let state = self.state.borrow();
        let Some(info) = &state.video else {
            return;
        };
        ui.set_frame_current(state.n.min(i32::MAX as u64) as i32);
        ui.set_frame_frame_label(
            self.strings
                .fill(
                    "frame_of",
                    &[
                        ("n", (state.n + 1).to_string()),
                        ("total", info.frames.to_string()),
                    ],
                )
                .into(),
        );
        ui.set_frame_time(
            self.strings
                .fill(
                    "time_of",
                    &[
                        ("time", info.time_label(state.n)),
                        ("duration", framegrab::time_label(info.duration)),
                    ],
                )
                .into(),
        );
        let playing = state.audio.player.is_some();
        ui.set_frame_clock(
            if playing {
                format!(
                    "{} / {}",
                    playback::clock(state.audio.position),
                    playback::clock(info.duration)
                )
            } else {
                format!(
                    "{} / {}",
                    info.time_label(state.n),
                    framegrab::time_label(info.duration)
                )
            }
            .into(),
        );
        let position = if playing {
            (state.audio.position / info.duration.max(f64::EPSILON)) as f32
        } else if info.frames > 1 {
            state.n as f32 / (info.frames - 1) as f32
        } else {
            0.0
        };
        ui.set_frame_position(position.clamp(0.0, 1.0));
        ui.set_frame_playing(playing);
        ui.set_frame_sharp_note(state.sharp_note.as_str().into());
        ui.set_frame_volume(self.display_volume());
    }

    fn refresh_crop(self: &Rc<Self>) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let state = self.state.borrow();
        let crop = self.crop_for(&state);
        ui.set_frame_crop_visible(state.video.is_some() && !crop.is_full());
        ui.set_frame_crop_x(crop.x as f32);
        ui.set_frame_crop_y(crop.y as f32);
        ui.set_frame_crop_w(crop.w as f32);
        ui.set_frame_crop_h(crop.h as f32);
    }

    fn refresh_progress(self: &Rc<Self>) {
        let Some(ui) = self.weak.upgrade() else {
            return;
        };
        let jobs = self.engine.jobs();
        let state = self.state.borrow();
        let mut progress = 0.0;
        let mut label = String::new();
        if let Some(id) = state.capture_job.as_ref()
            && let Some(job) = jobs.iter().find(|job| &job.id == id)
        {
            progress = job.progress.unwrap_or(0.0);
            let done = (progress * state.capture_total as f32).round() as usize;
            label = self.strings.fill(
                "capture_progress",
                &[
                    ("done", done.min(state.capture_total).to_string()),
                    ("total", state.capture_total.to_string()),
                ],
            );
        } else if state.analysis_job.is_some() {
            label = self.strings.get("analysing").to_owned();
        } else if state.sharp_job.is_some() {
            label = self.strings.get("finding").to_owned();
        } else if state.install_job.is_some() {
            label = self.strings.get("install_running").to_owned();
        } else if state.busy {
            label = self.strings.get("reading").to_owned();
        }
        ui.set_frame_progress(progress);
        ui.set_frame_progress_label(label.into());
    }

    /* ===== session and files ===== */

    fn snapshot(&self) -> Session {
        let state = self.state.borrow();
        let (volume, muted) = match state.muted_from {
            Some(before) => (before, true),
            None => (state.volume, false),
        };
        Session {
            video: state.video.as_ref().and_then(|_| state.path.clone()),
            picked: state.picked,
            n: state.n,
            volume,
            muted,
            layout: state.layout.id().into(),
            crops: state.crops.clone(),
            destination: state.destination.id().into(),
            queue: state.queue.items().to_vec(),
        }
    }

    fn schedule_session(self: &Rc<Self>) {
        let weak = Rc::downgrade(self);
        self.session_timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(500),
            move || {
                if let Some(controller) = weak.upgrade() {
                    controller.flush_session();
                }
            },
        );
    }

    fn flush_session(&self) {
        if !self.state.borrow().opened {
            return;
        }
        let session = self.snapshot();
        let Ok(bytes) = session.bytes() else {
            return;
        };
        if self.state.borrow().session_saved.as_ref() == Some(&bytes) {
            return;
        }
        let path = self.profile.root().join("frame-capture.json");
        match atomic_file::write_atomic(&path, &bytes) {
            Ok(()) => self.state.borrow_mut().session_saved = Some(bytes),
            Err(error) => {
                self.state.borrow_mut().message = self
                    .strings
                    .fill("session_failed", &[("error", error.to_string())]);
                if let Some(ui) = self.weak.upgrade() {
                    ui.set_frame_message(self.state.borrow().message.as_str().into());
                }
            }
        }
    }

    fn save_location(&self) {
        let (location, writable, previous) = {
            let state = self.state.borrow();
            (
                state.location.clone(),
                state.location_writable,
                state.location_saved.clone(),
            )
        };
        let Ok(bytes) = serde_json::to_vec_pretty(&location) else {
            return;
        };
        if previous.as_ref() == Some(&bytes) {
            return;
        }
        self.state.borrow_mut().location_saved = Some(bytes.clone());
        if !writable {
            return;
        }
        let path = self.profile.root().join("export-location.json");
        let inbox = self.inbox.clone();
        let weak = self.weak.clone();
        let _ = std::thread::Builder::new()
            .name("frame-location".into())
            .spawn(move || {
                if let Err(error) = atomic_file::write_atomic(&path, &bytes) {
                    inbox
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(Done::LocationFailed {
                            error: error.to_string(),
                        });
                    let _ = weak.upgrade_in_event_loop(|ui| ui.invoke_frame_task_finished());
                }
            });
    }

    fn clean_workspace(&self) {
        let Ok(entries) = std::fs::read_dir(&self.workspace) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn read_location(path: &Path) -> (ExportLocation, bool) {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(location) => (location, true),
            Err(_) => (ExportLocation::default(), false),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (ExportLocation::default(), true)
        }
        Err(_) => (ExportLocation::default(), false),
    }
}

/// The Halation folder, the Library and the linked Library folders: the only places a video may be read from without
/// the user choosing it in the picker or dropping it.
fn allowed_roots(profile: &Profile) -> Vec<PathBuf> {
    let mut roots = vec![profile.root().to_path_buf(), profile.sections_root()];
    if let Ok(bytes) = std::fs::read(profile.links_path())
        && let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes)
    {
        roots.extend(
            value["links"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|path| path.as_str())
                .map(PathBuf::from),
        );
    }
    roots
}

fn image_from(rgba: &[u8], width: u32, height: u32) -> Image {
    Image::from_rgba8(SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
        rgba, width, height,
    ))
}

fn layout_label(strings: &Strings, layout: Layout) -> String {
    strings
        .get(match layout {
            Layout::Widescreen => "layout_16_9",
            Layout::Portrait => "layout_9_16",
            Layout::Square => "layout_1_1",
            Layout::FourFive => "layout_4_5",
            Layout::Original => "layout_original_label",
        })
        .to_owned()
}

fn layout_detail(strings: &Strings, layout: Layout) -> String {
    strings
        .get(match layout {
            Layout::Widescreen => "layout_16_9_detail",
            Layout::Portrait => "layout_9_16_detail",
            Layout::Square => "layout_1_1_detail",
            Layout::FourFive => "layout_4_5_detail",
            Layout::Original => "layout_original",
        })
        .to_owned()
}

fn destination_label(strings: &Strings, destination: Destination) -> String {
    strings
        .get(match destination {
            Destination::Library => "destination_library",
            Destination::Image => "destination_image",
        })
        .to_owned()
}

fn destination_detail(strings: &Strings, destination: Destination) -> String {
    strings
        .get(match destination {
            Destination::Library => "library_detail",
            Destination::Image => "image_detail",
        })
        .to_owned()
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

struct NativePicker {
    title: String,
    filter: String,
}

impl SavePicker for NativePicker {
    fn pick(&self, name: &str, start: Option<&Path>) -> Option<PathBuf> {
        let mut dialog = rfd::FileDialog::new()
            .set_title(&self.title)
            .set_file_name(name)
            .add_filter(&self.filter, &["png"]);
        if let Some(start) = start {
            dialog = dialog.set_directory(start);
        }
        dialog.save_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halation_core::framegrab::QueuedFrame;
    use std::{
        fs,
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
        time::Instant,
    };

    static TEMP: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "halation-frame-controller-{}-{}",
                std::process::id(),
                TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&path);
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

    /// The real FFmpeg the beta uses; the test fails loudly instead of skipping when it is absent.
    fn ffmpeg() -> Ffmpeg {
        if let Some(dir) = std::env::var_os("HALATION_FFMPEG")
            && let Some(found) = Ffmpeg::in_directory(Path::new(&dir))
        {
            return found;
        }
        let profile = std::env::var_os("LOCALAPPDATA").map(|base| {
            PathBuf::from(base)
                .join("Halation")
                .join("slint-beta")
                .join("tools")
        });
        if let Some(found) = profile.and_then(|tools| Ffmpeg::find(&tools)) {
            return found;
        }
        Ffmpeg::find(Path::new(".")).expect(
            "Frame Capture's controller tests need FFmpeg and ffprobe. Install them from Settings → Tools or \
             set HALATION_FFMPEG to the folder that contains both programs.",
        )
    }

    fn make_video(dir: &Path, fps: u32, frames: u32) -> PathBuf {
        let ffmpeg = ffmpeg();
        let output = dir.join("synthetic.mkv");
        let status = Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!(
                    "testsrc2=size=320x180:rate={fps}:duration={}",
                    f64::from(frames) / f64::from(fps)
                ),
                "-frames:v",
                &frames.to_string(),
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-qp",
                "0",
                "-g",
                "10",
                "-keyint_min",
                "10",
                "-sc_threshold",
                "0",
                "-pix_fmt",
                "yuv420p",
                output.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("FFmpeg should run");
        assert!(status.success(), "FFmpeg could not encode the fixture");
        output
    }

    fn controller(ui: &AppWindow, profile: &Profile) -> Rc<FrameCapture> {
        let controller = FrameCapture::new(ui.as_weak(), profile.clone(), JobEngine::new(|| {}));
        controller.install(|| None);
        controller.state.borrow_mut().ffmpeg = Some(ffmpeg());
        controller
    }

    /// Pumps worker results into the controller. Without an event loop nothing invokes `frame-task-finished`.
    fn wait(controller: &Rc<FrameCapture>, what: &str, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            controller.task_finished();
            if done() {
                return;
            }
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn png_size(path: &Path) -> (u32, u32) {
        let bytes = fs::read(path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        (
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
        )
    }

    #[test]
    fn controller_opens_plays_steps_queues_and_captures_a_synthetic_video() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().unwrap();
        ui.show().unwrap();
        let dir = TestDir::new();
        let profile = Profile::at(dir.path().join("profile"));
        profile.ensure().unwrap();
        let video = make_video(dir.path(), 10, 25);
        let controller = controller(&ui, &profile);
        controller.open();
        controller.begin_open(video.clone(), true, None);

        wait(&controller, "the probe", || {
            controller.state.borrow().video.is_some()
        });
        assert!(ui.get_frame_has_video());
        assert_eq!(ui.get_frame_frames(), 25);
        assert_eq!(controller.state.borrow().n, 0);
        assert_eq!(ui.get_frame_frame_label().as_str(), "Frame 1 of 25");
        wait(&controller, "the first preview", || {
            controller.state.borrow().preview_image.is_some()
        });
        assert!(ui.get_frame_has_preview());
        wait(&controller, "the keyframe strip", || {
            let state = controller.state.borrow();
            state.analysis_job.is_none() && !state.keys.is_empty()
        });
        assert!(ui.get_frame_has_strip());
        assert!(controller.state.borrow().keys.contains(&0));

        // Real playback: the picture thread moves the clock; a manual frame change stops it.
        controller.action("play");
        assert!(controller.state.borrow().audio.player.is_some());
        assert!(ui.get_frame_playing());
        std::thread::sleep(Duration::from_millis(250));
        controller.tick();
        assert!(
            controller.state.borrow().audio.position > 0.0,
            "the playback clock advances"
        );
        let playing_at = controller.state.borrow().n;
        controller.action("next");
        assert!(
            controller.state.borrow().audio.player.is_none(),
            "a manual frame change stops playback"
        );
        assert!(!ui.get_frame_playing());
        assert_eq!(controller.state.borrow().n, (playing_at + 1).min(24));

        controller.action("end");
        assert_eq!(controller.state.borrow().n, 24);
        controller.action("home");
        assert_eq!(controller.state.borrow().n, 0);
        controller.go_to(17);
        wait(&controller, "the frame at 17", || {
            let state = controller.state.borrow();
            state.preview_image.is_some() && state.preview_job.is_none()
        });
        assert_eq!(ui.get_frame_frame_label().as_str(), "Frame 18 of 25");

        // A quiet interval during the pointer-held scrub settles exactly without waiting for release; release cancels
        // that timer generation and still settles its final position exactly.
        controller.scrub(0.48, true);
        let quiet_generation = controller.scrub_generation.load(Ordering::Acquire);
        i_slint_backend_testing::mock_elapsed_time(Duration::from_millis(200));
        slint::platform::update_timers_and_animations();
        wait(&controller, "the quiet scrub frame", || {
            let cache = controller
                .cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            cache.get(12).is_some() && controller.state.borrow().preview_job.is_none()
        });
        assert!(controller.state.borrow().scrubbing);
        controller.scrub_end(0.48);
        assert!(!controller.state.borrow().scrubbing);
        let after_release = controller.scrub_generation.load(Ordering::Acquire);
        controller.settle_scrub(quiet_generation);
        assert_eq!(
            controller.scrub_generation.load(Ordering::Acquire),
            after_release
        );
        assert_eq!(controller.state.borrow().n, 12);
        controller.state.borrow_mut().last_scrub =
            Some((Instant::now() - Duration::from_millis(10), 0));
        controller.scrub(0.8, true);
        assert_eq!(controller.state.borrow().last_key_shown, Some(20));
        controller.scrub_end(0.8);
        controller.go_to(17);
        wait(&controller, "the restored queue position", || {
            let state = controller.state.borrow();
            state.preview_image.is_some() && state.preview_job.is_none()
        });

        // The queue keeps time order and stays selected.
        controller.action("add");
        controller.go_to(3);
        controller.action("add");
        assert_eq!(controller.queue_model.row_count(), 2);
        assert_eq!(controller.state.borrow().queue.selected(), vec![3, 17]);
        assert_eq!(controller.queue_model.row_data(0).unwrap().n, 3);
        assert_eq!(controller.queue_model.row_data(1).unwrap().n, 17);
        assert_eq!(ui.get_frame_selected_label().as_str(), "2 selected");
        assert!(ui.get_frame_can_capture());

        // A crop per layout: the square crop is not full, moving it changes only that layout's crop.
        controller.set_layout("1:1");
        let square = controller.state.borrow().crops["1:1"];
        assert!(square.w < 1.0);
        assert!(ui.get_frame_crop_visible());
        controller.crop_move(10.0, 10.0);
        let moved = controller.state.borrow().crops["1:1"];
        assert!(moved.x > square.x && (moved.y - square.y).abs() < 1e-9);
        controller.set_layout("16:9");
        assert!(
            !ui.get_frame_crop_visible(),
            "the whole frame needs no crop"
        );
        controller.set_layout("1:1");
        assert_eq!(controller.state.borrow().crops["1:1"], moved);

        // Capture decodes the native frame, applies the crop and writes a PNG, never the preview.
        controller.capture();
        wait(&controller, "the capture", || {
            let state = controller.state.borrow();
            state.capture_job.is_none() && state.results.len() == 2
        });
        assert_eq!(controller.results_model.row_count(), 2);
        assert_eq!(ui.get_frame_message().as_str(), "Saved 2 frame(s).");
        let frames = profile.sections_root().join("Frames");
        for n in [3, 17] {
            let path = frames.join(format!("synthetic - frame {}.png", n + 1));
            assert!(path.is_file(), "{} exists", path.display());
            assert_eq!(png_size(&path), (180, 180), "native square crop");
        }

        // The session keeps the video, frame, layout, crop, destination and queue.
        controller.set_destination("image");
        controller.flush_session();
        let session = Session::read(&profile.root().join("frame-capture.json"));
        assert_eq!(session.video.as_deref(), Some(video.as_path()));
        assert!(session.picked);
        assert_eq!(session.n, 3);
        assert_eq!(session.layout, "1:1");
        assert_eq!(session.destination, "image");
        assert_eq!(
            session.queue.iter().map(|item| item.n).collect::<Vec<_>>(),
            vec![3, 17]
        );
        assert_eq!(
            session.crops.get("1:1"),
            Some(&controller.state.borrow().crops["1:1"])
        );
        controller.shutdown();
    }

    #[test]
    fn controller_restores_a_saved_session_and_ignores_stale_worker_results() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().unwrap();
        ui.show().unwrap();
        let dir = TestDir::new();
        let profile = Profile::at(dir.path().join("profile"));
        profile.ensure().unwrap();
        let video = make_video(dir.path(), 10, 25);
        let crop = Crop {
            x: 0.1,
            y: 0.2,
            w: 0.5,
            h: 0.5,
        };
        let mut session = Session {
            video: Some(video.clone()),
            picked: true,
            n: 17,
            volume: 0.5,
            muted: false,
            layout: "1:1".into(),
            destination: "image".into(),
            ..Default::default()
        };
        session.crops.insert("1:1".into(), crop);
        session.queue = vec![
            QueuedFrame {
                n: 17,
                selected: true,
            },
            QueuedFrame {
                n: 3,
                selected: false,
            },
        ];
        fs::write(
            profile.root().join("frame-capture.json"),
            session.bytes().unwrap(),
        )
        .unwrap();

        let controller = controller(&ui, &profile);
        {
            let state = controller.state.borrow();
            assert_eq!(state.n, 17, "the saved frame is known before opening");
            assert_eq!(state.layout, Layout::Square);
            assert_eq!(state.destination, Destination::Image);
            assert!(state.pending_restore.is_some());
        }
        controller.open();
        wait(&controller, "the restored video", || {
            controller.state.borrow().video.is_some()
        });
        wait(&controller, "the restored analysis", || {
            let state = controller.state.borrow();
            state.analysis_job.is_none() && !state.keys.is_empty()
        });
        assert_eq!(controller.state.borrow().n, 17);
        assert_eq!(ui.get_frame_frame_label().as_str(), "Frame 18 of 25");
        assert_eq!(controller.state.borrow().crops["1:1"], crop);
        assert!(ui.get_frame_crop_visible());
        assert_eq!(ui.get_frame_volume(), 0.5);
        assert_eq!(controller.queue_model.row_count(), 2);
        assert_eq!(controller.queue_model.row_data(0).unwrap().n, 3);
        assert!(!controller.queue_model.row_data(0).unwrap().selected);
        assert!(controller.queue_model.row_data(1).unwrap().selected);

        // A result from an older generation never reaches the page.
        let stale = controller.preview_generation.load(Ordering::Acquire);
        controller.preview_generation.fetch_add(1, Ordering::AcqRel);
        controller
            .inbox
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(Done::PreviewFailed {
                generation: stale,
                requested: 5,
                error: "stale worker result".into(),
            });
        controller.task_finished();
        assert!(
            !ui.get_frame_message().contains("stale worker result"),
            "an outdated worker result must be ignored"
        );
        controller.shutdown();
    }
}
