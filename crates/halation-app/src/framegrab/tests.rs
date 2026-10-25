use super::*;
use halation_core::framegrab::QueuedFrame;
use i_slint_backend_testing::{AccessibleRole, ElementHandle};
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

fn click(ui: &AppWindow, position: slint::LogicalPosition) {
    let button = slint::platform::PointerEventButton::Left;
    ui.window()
        .dispatch_event(slint::platform::WindowEvent::PointerMoved { position });
    ui.window()
        .dispatch_event(slint::platform::WindowEvent::PointerPressed { position, button });
    ui.window()
        .dispatch_event(slint::platform::WindowEvent::PointerReleased { position, button });
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
    ui.window().set_size(slint::PhysicalSize::new(960, 600));
    let dir = TestDir::new();
    let profile = Profile::at(dir.path().join("profile"));
    profile.ensure().unwrap();
    let video = make_video(dir.path(), 10, 25);
    let controller = controller(&ui, &profile);
    assert_eq!(controller.state.borrow().destination, Destination::Image);
    assert_eq!(controller.state.borrow().volume, 0.8);
    assert_eq!(controller.state.borrow().layout, Layout::Widescreen);
    assert!(controller.state.borrow().sharp_job.is_none());
    controller.open();
    assert!(controller.state.borrow().left_open);
    assert!(!controller.state.borrow().inspector_open);
    ui.set_page(5);
    let control = slint::SharedString::from(slint::platform::Key::Control);
    let alt = slint::SharedString::from(slint::platform::Key::Alt);
    let toggle = |letter: &str| {
        let key = slint::SharedString::from(letter);
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyPressed {
                text: control.clone(),
            });
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyPressed { text: alt.clone() });
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyPressed { text: key.clone() });
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyReleased { text: key });
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyReleased { text: alt.clone() });
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::KeyReleased {
                text: control.clone(),
            });
    };
    toggle("i");
    assert!(!controller.state.borrow().left_open && controller.state.borrow().inspector_open);
    assert!(!ui.get_frame_left_open() && ui.get_frame_inspector_open());
    toggle("b");
    assert!(controller.state.borrow().left_open && !controller.state.borrow().inspector_open);
    assert!(ui.get_frame_left_open() && !ui.get_frame_inspector_open());
    controller.begin_open(video.clone(), true, None);

    wait(&controller, "the probe", || {
        controller.state.borrow().video.is_some()
    });
    assert!(ui.get_frame_has_video());
    assert_eq!(ui.get_frame_frames(), 25);
    ui.invoke_frame_inspector_tab_selected(1);
    assert_eq!(ui.get_frame_inspector_tab(), 1);
    ui.invoke_frame_inspector_tab_selected(0);
    assert_eq!(ui.get_frame_inspector_tab(), 0);
    assert_eq!(controller.state.borrow().n, 0);
    assert_eq!(ui.get_frame_frame_label().as_str(), "Frame 1 of 25");
    wait(&controller, "the first preview", || {
        controller.state.borrow().preview_image.is_some()
    });
    assert_eq!(
        controller.decoder_backend(),
        Some(framegrab::DecodeBackend::Ffmpeg),
        "unsupported lossless H.264 profile uses the explicit FFmpeg fallback"
    );
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
    assert_eq!(ui.get_frame_queue_count_label().as_str(), "2 / 8");
    assert_eq!(ui.get_frame_action_label().as_str(), "Capture 2");
    assert!(ui.get_frame_can_capture());

    // Exercise the real queue child hit targets: the row surface must not eat check/X presses.
    let second = controller.queue_model.row_data(1).unwrap();
    let check = ElementHandle::find_by_accessible_label(&ui, &format!("Deselect {}", second.label))
        .find(|element| element.accessible_role() == Some(AccessibleRole::Checkbox))
        .expect("selected queue row exposes its deselect checkbox");
    let check_position = check.absolute_position();
    let check_size = check.size();
    click(
        &ui,
        slint::LogicalPosition::new(
            check_position.x + check_size.width / 2.0,
            check_position.y + check_size.height / 2.0,
        ),
    );
    assert_eq!(controller.state.borrow().queue.selected(), vec![3]);
    assert_eq!(ui.get_frame_action_label().as_str(), "Capture 1");

    let button = |label: &str| {
        ElementHandle::find_by_accessible_label(&ui, label)
            .find(|element| element.accessible_role() == Some(AccessibleRole::Button))
            .expect("queue footer action is present")
    };
    let all = button("All");
    let all_position = all.absolute_position();
    let all_size = all.size();
    click(
        &ui,
        slint::LogicalPosition::new(
            all_position.x + all_size.width / 2.0,
            all_position.y + all_size.height / 2.0,
        ),
    );
    assert_eq!(controller.state.borrow().queue.selected(), vec![3, 17]);
    let none = button("None");
    let none_position = none.absolute_position();
    let none_size = none.size();
    click(
        &ui,
        slint::LogicalPosition::new(
            none_position.x + none_size.width / 2.0,
            none_position.y + none_size.height / 2.0,
        ),
    );
    assert!(controller.state.borrow().queue.selected().is_empty());
    assert_eq!(ui.get_frame_action_label().as_str(), "Capture 0");
    let row =
        ElementHandle::find_by_accessible_label(&ui, &format!("{}, {}", second.label, second.time))
            .find(|element| element.accessible_role() == Some(AccessibleRole::Button))
            .expect("queued frame row is accessible");
    let row_position = row.absolute_position();
    let row_size = row.size();
    let close_position = slint::LogicalPosition::new(
        row_position.x + row_size.width - 27.0,
        row_position.y + row_size.height / 2.0,
    );
    ui.window()
        .dispatch_event(slint::platform::WindowEvent::PointerMoved {
            position: close_position,
        });
    let row =
        ElementHandle::find_by_accessible_label(&ui, &format!("{}, {}", second.label, second.time))
            .find(|element| element.accessible_role() == Some(AccessibleRole::Button))
            .expect("queue row remains accessible");
    let row_position = row.absolute_position();
    let row_size = row.size();
    let remove = ElementHandle::find_by_accessible_label(&ui, &format!("Remove {}", second.label))
        .find(|element| element.accessible_role() == Some(AccessibleRole::Button))
        .expect("hovered queue row exposes its remove button");
    let remove_position = remove.absolute_position();
    let remove_size = remove.size();
    assert!(
        remove_position.x > row_position.x + row_size.width - 40.0,
        "remove hit target must lie at the row's right edge: row=({row_position:?}, {row_size:?}), remove=({remove_position:?}, {remove_size:?})"
    );
    click(
        &ui,
        slint::LogicalPosition::new(
            remove_position.x + remove_size.width / 2.0,
            remove_position.y + remove_size.height / 2.0,
        ),
    );
    assert_eq!(
        controller.state.borrow().queue.items().len(),
        1,
        "X click at {remove_position:?} size {remove_size:?} in row {row_position:?} size {row_size:?} did not remove"
    );
    assert_eq!(controller.state.borrow().queue.items()[0].n, 3);
    controller.go_to(17);
    controller.action("add");
    assert_eq!(controller.queue_model.row_count(), 2);
    controller.set_all(true);
    assert_eq!(controller.state.borrow().queue.selected(), vec![3, 17]);
    controller.go_to(3);

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
    controller.set_destination("library");
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
    let restart = FrameCapture::new(ui.as_weak(), profile.clone(), JobEngine::new(|| {}));
    assert_eq!(restart.state.borrow().results.len(), 2);
    assert_eq!(restart.state.borrow().results[0].n, 17);
    restart.install(|| None);
    assert_eq!(restart.results_model.row_count(), 2);
    fs::remove_file(frames.join("synthetic - frame 18.png")).unwrap();
    assert_eq!(
        read_results(&profile.root().join("frame-capture-results.json")).len(),
        1
    );

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
    restart.shutdown();
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

#[test]
fn controller_surfaces_audio_sink_failure_before_silent_picture_playback() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    let dir = TestDir::new();
    let profile = Profile::at(dir.path().join("profile"));
    profile.ensure().unwrap();
    let controller = controller(&ui, &profile);
    let picture = Picture {
        width: 16,
        height: 16,
        fps: 30.0,
    };
    let player = Player::start_media(
        Path::new("not-used"),
        Path::new("not-used"),
        0.0,
        true,
        Some(picture),
        1.0,
        Box::new(|| Err("test: no audio device".into())),
    );
    controller.state.borrow_mut().video = Some(VideoInfo {
        width: 16,
        height: 16,
        rotation_degrees: 0,
        pixel_format: "yuv420p".into(),
        color_space: "bt709".into(),
        fps_num: 30,
        fps_den: 1,
        start_time: 0.0,
        variable_frame_rate: false,
        frames: 30,
        duration: 1.0,
        has_audio: true,
    });
    controller.state.borrow_mut().audio = Audio {
        player: Some(player),
        position: 0.0,
        picture: Some(picture),
    };
    let deadline = Instant::now() + Duration::from_secs(1);
    while controller
        .state
        .borrow()
        .audio
        .player
        .as_ref()
        .is_some_and(|player| !player.finished())
        && Instant::now() < deadline
    {
        std::thread::sleep(Duration::from_millis(2));
    }
    controller.tick();
    assert!(controller.state.borrow().audio.player.is_none());
    assert!(!ui.get_frame_playing());
    assert!(controller.state.borrow().preview_image.is_none());
    assert!(
        controller
            .state
            .borrow()
            .message
            .contains("test: no audio device")
    );
    controller.shutdown();
}
