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
fn video_preview_plays_frames_mutes_and_is_removed_from_the_list() {
    let Some(pair) = components::Ffmpeg::find(&std::env::temp_dir().join("halation-no-tools"))
    else {
        eprintln!("FFmpeg not found: the video preview controller test did not run");
        return;
    };
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.set_page(4);
    let root = std::env::temp_dir().join(format!(
        "halation-converter-video-{}-{}",
        std::process::id(),
        WORKSPACE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    let input = root.join("generated-clip.mkv");
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
            "testsrc2=size=320x180:rate=12:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let engine = JobEngine::new(|| {});
    let controller = Converter::new(ui.as_weak(), Profile::at(&root), engine.clone());
    controller.install(|| Some(1));
    controller.add(vec![input.clone()]);
    until(|| controller.inbox.lock().unwrap().is_some());
    ui.invoke_converter_loaded();
    assert!(ui.get_convert_video() && !ui.get_convert_audio());
    assert_eq!(ui.get_convert_clock().as_str(), "0:00 / 0:04");
    let picture = controller.audio.borrow().picture.unwrap();
    assert_eq!((picture.width, picture.height), (320, 180));
    // A paused seek asks for the still at the head; the first still is no longer wanted
    ui.invoke_converter_seek(0.5);
    assert!(!ui.get_convert_playing());
    assert_eq!(ui.get_convert_clock().as_str(), "0:02 / 0:04");
    until(|| !engine.busy(Some("converter-preview")));
    assert!(
        engine
            .jobs()
            .iter()
            .filter(|j| j.spec.tool == "converter-preview" && j.state == JobState::Done)
            .count()
            >= 1
    );
    // Mute keeps the level to restore; the slider clears it
    ui.invoke_converter_volume(0.6);
    ui.invoke_converter_action("mute".into());
    assert_eq!(ui.get_convert_volume(), 0.0);
    ui.invoke_converter_action("mute".into());
    assert!((ui.get_convert_volume() - 0.6).abs() < 1e-6);
    ui.invoke_converter_action("play".into());
    assert!(ui.get_convert_playing());
    let start = std::time::Instant::now();
    let mut framed = false;
    while start.elapsed() < Duration::from_secs(3) && !framed {
        std::thread::sleep(Duration::from_millis(40));
        controller.tick();
        framed = ui.get_convert_has_preview() && controller.audio.borrow().player.is_some();
    }
    if controller.audio.borrow().player.is_some() {
        assert!(framed, "playing shows frames");
    } else {
        // No audio device (a CI machine): playback ends with a message instead of hanging
        assert!(!ui.get_convert_message().is_empty());
    }
    // Taking the file off the list stops playback and leaves the file on disk
    ui.invoke_converter_remove(0);
    assert!(controller.audio.borrow().player.is_none());
    assert!(!ui.get_convert_video());
    assert_eq!(ui.get_convert_rows().row_count(), 0);
    assert!(input.exists());
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
