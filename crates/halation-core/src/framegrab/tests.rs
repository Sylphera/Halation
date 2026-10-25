use super::*;
use crate::components::Ffmpeg;
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

static TEMP: AtomicU64 = AtomicU64::new(0);

fn info(width: u32, height: u32) -> VideoInfo {
    VideoInfo {
        width,
        height,
        rotation_degrees: 0,
        pixel_format: "yuv420p".into(),
        color_space: "bt709".into(),
        fps_num: 30,
        fps_den: 1,
        start_time: 0.0,
        variable_frame_rate: false,
        frames: 300,
        duration: 10.0,
        has_audio: false,
    }
}

#[test]
fn rational_frame_times_do_not_drift() {
    let ntsc = VideoInfo {
        fps_num: 30_000,
        fps_den: 1001,
        frames: 240,
        duration: 8.008,
        ..info(1920, 1080)
    };
    assert!((ntsc.time(1) - 1001.0 / 30_000.0).abs() < 1e-12);
    assert!((ntsc.time(30) - 1.001).abs() < 1e-12);
    assert_eq!(ntsc.frame_at(1.001), 30);
    assert_eq!(ntsc.frame_at(100.0), 239);
    assert_eq!(ntsc.time_label(30), "0:01.00");
    assert_eq!(time_label(3725.55), "1:02:05.55");
}

#[test]
fn layouts_take_the_largest_exact_ratio_crop_and_clamp_moves() {
    let video = info(1920, 1080);
    assert!(default_crop(&video, Layout::Widescreen).is_full());
    assert!(default_crop(&video, Layout::Original).is_full());
    let square = default_crop(&video, Layout::Square);
    assert!((square.w - 1080.0 / 1920.0).abs() < 1e-9);
    assert!((square.x - (1.0 - square.w) / 2.0).abs() < 1e-9);
    let portrait = default_crop(&video, Layout::Portrait);
    assert!((portrait.h - 1.0).abs() < 1e-9);
    assert!((portrait.w - 9.0 / 16.0 * 1080.0 / 1920.0).abs() < 1e-9);
    let moved = move_crop(square, 10.0, 10.0);
    assert!((moved.x - (1.0 - moved.w)).abs() < 1e-9);
    assert_eq!(moved.y, 0.0);
    let pixels = pixel_crop(&video, square);
    assert_eq!(
        (pixels.x, pixels.y, pixels.w, pixels.h),
        (420, 0, 1080, 1080)
    );
    let portrait_pixels = pixel_crop(&video, portrait);
    assert_eq!(portrait_pixels.h, 1080);
    assert_eq!(portrait_pixels.w % 2, 0);
}

#[test]
fn queue_keeps_time_order_selects_duplicates_and_caps_at_eight() {
    let mut queue = Queue::default();
    assert_eq!(queue.add(10), AddOutcome::Added);
    assert_eq!(queue.add(3), AddOutcome::Added);
    assert_eq!(queue.add(10), AddOutcome::Selected);
    assert_eq!(queue.len(), 2);
    assert_eq!(queue.items()[0].n, 3);
    queue.toggle(3);
    assert_eq!(queue.selected(), vec![10]);
    assert!(queue.remove(10));
    assert!(!queue.remove(10));
    queue.clear();
    for n in 0..8 {
        assert_eq!(queue.add(n), AddOutcome::Added);
    }
    assert_eq!(queue.add(99), AddOutcome::Full);
    queue.set_all(false);
    assert!(queue.selected().is_empty());
}

#[test]
fn cache_stays_within_budget_and_drops_the_farthest_frame() {
    let mut cache = FrameCache::new(3 * 16);
    for n in 0..5 {
        cache.insert(
            RawFrame {
                index: n,
                width: 2,
                height: 2,
                rgba: vec![0; 16],
            },
            n,
        );
    }
    assert_eq!(cache.bytes(), 3 * 16);
    assert!(cache.get(4).is_some());
    assert!(cache.get(0).is_none());
    cache.clear();
    assert!(cache.is_empty());
}

#[test]
fn laplacian_is_zero_on_flat_and_high_on_edges() {
    let flat = vec![128_u8; 32 * 32 * 4];
    assert_eq!(laplacian_variance(&flat, 32, 32), 0.0);
    let mut checker = flat;
    for y in 0..32 {
        for x in 0..32 {
            if (x / 4 + y / 4) % 2 == 0 {
                let i = (y * 32 + x) * 4;
                checker[i] = 255;
                checker[i + 1] = 255;
                checker[i + 2] = 255;
            }
        }
    }
    assert!(laplacian_variance(&checker, 32, 32) > 1000.0);
}

#[test]
fn capture_names_use_the_stem_and_one_based_frame() {
    assert_eq!(
        capture_name(Path::new("C:\\clips\\my:clip.mkv"), 41),
        "my-clip - frame 42.png"
    );
}

#[test]
fn authorization_accepts_roots_and_explicit_picks_only() {
    let root = temp("access");
    let inside = root.join("a.mkv");
    fs::write(&inside, b"x").unwrap();
    let outside = std::env::temp_dir().join(format!(
        "halation-framegrab-outside-{}.mkv",
        std::process::id()
    ));
    fs::write(&outside, b"x").unwrap();
    assert!(allowed(&inside, std::slice::from_ref(&root), false));
    assert!(!allowed(&outside, std::slice::from_ref(&root), false));
    assert!(allowed(&outside, &[], true));
    let _ = fs::remove_file(&outside);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fit_never_enlarges() {
    assert_eq!(fit_size(3840, 2160, 1920), (1920, 1080));
    assert_eq!(fit_size(1280, 720, 1920), (1280, 720));
    assert_eq!(fit_size(360, 202, 360), (360, 202));
    assert_eq!(fit_size(1919, 1079, 1920), (1919, 1079));
}

#[test]
fn preview_window_bounds_transient_rgba_and_contains_requested_frame() {
    let budget = PREVIEW_BATCH_BYTES;
    for (width, height) in [(1920, 1080), (3840, 2160), (7680, 4320)] {
        let info = info(width, height);
        for center in [0, 150, 299] {
            let (from, count) = preview_window(&info, center, PREVIEW_WIDTH, budget);
            let (pw, ph) = fit_size(width, height, PREVIEW_WIDTH);
            let bytes = count as usize * pw as usize * ph as usize * 4;
            assert!(bytes <= budget, "{width}x{height}: {bytes} > {budget}");
            assert!(from <= center && center < from + u64::from(count));
        }
    }
    let ffmpeg = ffmpeg();
    let oversized = with_context(move |context| {
        decode_window(
            DecodeSource {
                context: &context,
                ffmpeg: &ffmpeg.ffmpeg,
                input: Path::new("not-opened-on-budget-rejection.mp4"),
                info: &info(7680, 4320),
            },
            0,
            2,
            0,
            Path::new("unused.rgba"),
        )
    });
    assert!(oversized.unwrap_err().contains("160 MiB"));
}

/* ===== synthetic FFmpeg integration ===== */

fn temp(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "halation-framegrab-{tag}-{}-{}",
        std::process::id(),
        TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn ffmpeg() -> Ffmpeg {
    if let Some(found) =
        std::env::var_os("HALATION_FFMPEG").and_then(|dir| Ffmpeg::in_directory(Path::new(&dir)))
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
        "Frame Capture's synthetic integration tests need FFmpeg and ffprobe. Install them from Settings → \
         Tools or set HALATION_FFMPEG to the folder that contains both programs.",
    )
}

fn make_video(dir: &Path, fps: &str, frames: u32, sharp_frame: u32) -> PathBuf {
    let ffmpeg = ffmpeg();
    for i in 0..frames {
        let mut image = image::RgbaImage::from_pixel(320, 180, image::Rgba([110, 110, 110, 255]));
        if i == sharp_frame {
            for y in 0..180 {
                for x in 0..320 {
                    let light = (x / 6 + y / 6) % 2 == 0;
                    let value = if light { 245 } else { 10 };
                    image.put_pixel(x, y, image::Rgba([value, value, value, 255]));
                }
            }
        } else {
            // A soft horizontal gradient: much less edge energy than the checkerboard
            for y in 0..180 {
                for x in 0..320 {
                    let value = (100 + x / 8) as u8;
                    image.put_pixel(x, y, image::Rgba([value, value, value, 255]));
                }
            }
        }
        image
            .save_with_format(
                dir.join(format!("frame{i:03}.png")),
                image::ImageFormat::Png,
            )
            .unwrap();
    }
    let output = dir.join("synthetic.mkv");
    let status = std::process::Command::new(&ffmpeg.ffmpeg)
        .current_dir(dir)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-framerate",
            fps,
            "-i",
            "frame%03d.png",
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

fn with_context<T: Send + 'static>(body: impl FnOnce(TaskContext) -> T + Send + 'static) -> T {
    let engine = crate::engine::JobEngine::new(|| {});
    let (tx, rx) = std::sync::mpsc::channel();
    engine.submit_task(
        crate::queue::JobSpec::new("test", "test", crate::queue::Lane::Light),
        move |context| {
            let _ = tx.send(body(context));
            Ok(())
        },
    );
    rx.recv_timeout(Duration::from_secs(60))
        .expect("the test job should finish")
}

#[test]
fn synthetic_video_probes_decodes_windows_and_extracts_native_frames() {
    let dir = temp("video");
    let video = make_video(&dir, "10", 25, 17);
    let ffmpeg = ffmpeg();
    let info = probe(&ffmpeg.ffprobe, &video).unwrap();
    assert_eq!((info.width, info.height), (320, 180));
    assert_eq!((info.fps_num, info.fps_den), (10, 1));
    assert_eq!(info.frames, 25);
    assert!((info.duration - 2.5).abs() < 0.05);

    #[cfg(windows)]
    {
        let mp4 = dir.join("mf-fixture.mp4");
        let status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                video.to_string_lossy().as_ref(),
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "18",
                "-profile:v",
                "baseline",
                "-pix_fmt",
                "yuv420p",
                mp4.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("FFmpeg should encode the baseline-profile synthetic MF fixture");
        assert!(
            status.success(),
            "the synthetic MP4 fixture should be created"
        );
        let rotated = dir.join("mf-rotated.mp4");
        let rotation_status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-display_rotation:0",
                "90",
                "-i",
                mp4.to_string_lossy().as_ref(),
                "-c",
                "copy",
                rotated.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("FFmpeg should write the synthetic rotation metadata");
        assert!(rotation_status.success());
        let rotated_info = probe(&ffmpeg.ffprobe, &rotated).unwrap();
        assert!(matches!(rotated_info.rotation_degrees, 90 | 270));
        assert_eq!((rotated_info.width, rotated_info.height), (180, 320));
        let in_process = crate::frame_decoder::decode_window(&mp4, &info, 10, 3, 0, &|| false)
            .expect("Windows Media Foundation decodes the synthetic H.264 fixture in-process");
        assert_eq!(
            in_process
                .iter()
                .map(|frame| frame.index)
                .collect::<Vec<_>>(),
            [10, 11, 12]
        );
        assert_eq!((in_process[0].width, in_process[0].height), (320, 180));
        assert_eq!(
            crate::frame_decoder::decode_window(&mp4, &info, 10, 1, 0, &|| true).unwrap_err(),
            "Cancelled"
        );
        let captured_png = dir.join("mf-native-capture.png");
        let capture_raw = dir.join("mf-capture.rgba");
        let captured_size = with_context({
            let path = mp4.clone();
            let output = captured_png.clone();
            let raw = capture_raw.clone();
            let info = info.clone();
            let ffmpeg = ffmpeg.clone();
            move |context| {
                capture_png(
                    DecodeSource {
                        context: &context,
                        ffmpeg: &ffmpeg.ffmpeg,
                        input: &path,
                        info: &info,
                    },
                    10,
                    Crop::FULL,
                    &output,
                    &raw,
                )
            }
        })
        .unwrap();
        assert_eq!(captured_size, (320, 180));
        assert_eq!(
            image::open(captured_png).unwrap().to_rgba8().into_raw(),
            in_process[0].rgba
        );
        let baseline_raw = dir.join("mf-baseline.rgba");
        with_context({
            let path = mp4.clone();
            let raw = baseline_raw.clone();
            let info = info.clone();
            let ffmpeg = ffmpeg.clone();
            move |context| {
                run_decode(
                    &DecodeSource {
                        context: &context,
                        ffmpeg: &ffmpeg.ffmpeg,
                        input: &path,
                        info: &info,
                    },
                    10,
                    3,
                    None,
                    &raw,
                )
            }
        })
        .unwrap();
        let baseline = fs::read(&baseline_raw).unwrap();
        let frame_bytes = 320 * 180 * 4;
        for (i, frame) in in_process.iter().enumerate() {
            let difference = frame
                .rgba
                .iter()
                .zip(&baseline[i * frame_bytes..(i + 1) * frame_bytes])
                .map(|(a, b)| a.abs_diff(*b) as u64)
                .sum::<u64>() as f64
                / frame_bytes as f64;
            assert!(
                difference < 16.0,
                "MF/FFmpeg mean RGBA difference {difference:.2}"
            );
        }

        // A wide scene surrounded by real black letterbox bars catches a spurious green first-row stripe in the
        // NV12-to-RGBA path; the interior red field proves the decoder is not simply returning a black surface.
        let letterbox = dir.join("mf-letterbox-1080p.mp4");
        let status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=1920x1080:r=10:d=1",
                "-vf",
                "drawbox=x=0:y=40:w=1920:h=1000:color=red:t=fill",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-profile:v",
                "baseline",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ])
            .arg(&letterbox)
            .status()
            .expect("FFmpeg should encode the synthetic letterbox fixture");
        assert!(
            status.success(),
            "the letterbox MP4 fixture should be created"
        );
        let letterbox_info = probe(&ffmpeg.ffprobe, &letterbox).unwrap();
        let letterbox_frame =
            crate::frame_decoder::decode_window(&letterbox, &letterbox_info, 0, 1, 0, &|| false)
                .expect("Media Foundation should decode the synthetic letterbox fixture");
        assert_eq!(letterbox_frame.len(), 1);
        let frame = &letterbox_frame[0];
        assert_eq!((frame.width, frame.height), (1920, 1080));
        let ffmpeg_raw = dir.join("mf-letterbox-reference.rgba");
        with_context({
            let raw = ffmpeg_raw.clone();
            let input = letterbox.clone();
            let ffmpeg = ffmpeg.clone();
            let info = letterbox_info.clone();
            move |context| {
                run_decode(
                    &DecodeSource {
                        context: &context,
                        ffmpeg: &ffmpeg.ffmpeg,
                        input: &input,
                        info: &info,
                    },
                    0,
                    1,
                    None,
                    &raw,
                )
            }
        })
        .unwrap();
        let ffmpeg_reference = fs::read(ffmpeg_raw).unwrap();
        for y in (0..24_u32).chain(1056..1080) {
            for x in 0..frame.width {
                let offset = (y as usize * frame.width as usize + x as usize) * 4;
                assert!(
                    frame.rgba[offset] <= 12
                        && frame.rgba[offset + 1] <= 12
                        && frame.rgba[offset + 2] <= 12,
                    "letterbox pixel ({x},{y}) should stay black, got RGB({}, {}, {})",
                    frame.rgba[offset],
                    frame.rgba[offset + 1],
                    frame.rgba[offset + 2]
                );
                assert!(
                    ffmpeg_reference[offset] <= 12
                        && ffmpeg_reference[offset + 1] <= 12
                        && ffmpeg_reference[offset + 2] <= 12,
                    "FFmpeg reference letterbox pixel ({x},{y}) should stay black"
                );
            }
        }
        // The moving preview uses FFmpeg's raw-RGBA path, not the still Media Foundation decoder. Check the
        // same fixture through that player path so the regression distinguishes a still-only NV12 artifact.
        let picture = crate::playback::Picture::fit(1920, 1080, 10.0, 1920, 1080).unwrap();
        let player = crate::playback::Player::start_media(
            &ffmpeg.ffmpeg,
            &letterbox,
            0.0,
            false,
            Some(picture),
            0.8,
            Box::new(|| Err("audio output is not used in this picture-only fixture".into())),
        );
        let deadline = Instant::now() + Duration::from_secs(20);
        let played_frame = loop {
            if let Some(frame) = player.take_frame() {
                break frame;
            }
            assert!(
                Instant::now() < deadline,
                "FFmpeg player should produce the fixture frame"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        player.stop();
        for y in (0..24_u32).chain(1056..1080) {
            for x in 0..frame.width {
                let offset = (y as usize * frame.width as usize + x as usize) * 4;
                assert!(
                    played_frame[offset] <= 12
                        && played_frame[offset + 1] <= 12
                        && played_frame[offset + 2] <= 12,
                    "playing preview letterbox pixel ({x},{y}) should stay black"
                );
            }
        }
        let center = (540_usize * frame.width as usize + 960) * 4;
        assert!(
            frame.rgba[center] > 200 && frame.rgba[center + 1] < 30 && frame.rgba[center + 2] < 30,
            "synthetic red picture field should survive the letterbox decode"
        );
        assert!(
            played_frame[center] > 200
                && played_frame[center + 1] < 30
                && played_frame[center + 2] < 30,
            "synthetic red picture field should survive the playing preview"
        );
    }

    let raw = dir.join("window.rgba");
    let frames = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        move |context| {
            decode_window(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                10,
                6,
                160,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!(frames.len(), 6);
    assert_eq!(frames[0].index, 10);
    assert_eq!(frames[5].index, 15);
    assert_eq!((frames[0].width, frames[0].height), (160, 90));
    assert_eq!(frames[0].rgba.len(), 160 * 90 * 4);
    assert!(!raw.exists(), "the temporary raw file is removed");

    let raw = dir.join("frame.rgba");
    let frame = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        move |context| {
            preview_frame(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                17,
                1920,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!(frame.index, 17);
    assert_eq!((frame.width, frame.height), (320, 180));
    assert!(
        laplacian_variance(&frame.rgba, frame.width, frame.height) > 1000.0,
        "the checkerboard frame is sharp"
    );

    let png = dir.join("out.png");
    let raw = dir.join("capture.rgba");
    let crop = default_crop(&info, Layout::Square);
    let size = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        let png = png.clone();
        move |context| {
            capture_png(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                17,
                crop,
                &png,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!(size, (180, 180));
    let decoded = image::open(&png).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (180, 180));
    assert!(!raw.exists());

    let keys = keyframes(&ffmpeg.ffprobe, &video, &info).unwrap();
    assert!(keys.contains(&0) && keys.contains(&10) && keys.contains(&20));
    let strip_raw = dir.join("strip.rgba");
    let strip = with_context({
        let strip_raw = strip_raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        let keys = keys.clone();
        move |context| keyframe_strip(&context, &ffmpeg.ffmpeg, &video, &info, &keys, &strip_raw)
    })
    .unwrap()
    .expect("keyframes produce a strip");
    assert_eq!((strip.width, strip.height), (STRIP_WIDTH, 144));
    assert_eq!(strip.rgba.len(), STRIP_WIDTH as usize * 144 * 4);

    let sharp_raw = dir.join("sharp.rgba");
    let sharp = with_context({
        let sharp_raw = sharp_raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        move |context| {
            sharpest_near(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                12,
                &sharp_raw,
            )
        }
    })
    .unwrap();
    assert_eq!(sharp, 17, "the sharpest frame within ±12 is found");

    let key = content_key(&video).unwrap();
    let copy = dir.join("copy.mkv");
    fs::copy(&video, &copy).unwrap();
    assert_eq!(content_key(&copy).unwrap(), key);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn ntsc_frame_count_and_last_frame_match_the_decoder() {
    let dir = temp("ntsc");
    let video = make_video(&dir, "24000/1001", 24, 12);
    let ffmpeg = ffmpeg();
    let info = probe(&ffmpeg.ffprobe, &video).unwrap();
    assert_eq!((info.fps_num, info.fps_den), (24_000, 1001));
    assert!(!info.variable_frame_rate);
    assert_eq!(info.frames, 24);
    assert!((info.time(23) - 23.0 * 1001.0 / 24_000.0).abs() < 1e-9);
    let raw = dir.join("last.rgba");
    let frame = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        move |context| {
            preview_frame(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                info.last(),
                160,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!(frame.index, 23);
    #[cfg(windows)]
    {
        let mp4 = dir.join("ntsc-mf.mp4");
        let status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                video.to_string_lossy().as_ref(),
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "18",
                "-profile:v",
                "baseline",
                "-r",
                "24000/1001",
                "-pix_fmt",
                "yuv420p",
                mp4.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("FFmpeg should encode the rational-rate MF fixture");
        assert!(status.success());
        let mf_info = probe(&ffmpeg.ffprobe, &mp4).unwrap();
        assert_eq!((mf_info.fps_num, mf_info.fps_den), (24_000, 1001));
        assert!(!mf_info.variable_frame_rate);
        let mf_frames = crate::frame_decoder::decode_window(&mp4, &mf_info, 20, 4, 160, &|| false)
            .expect("MF timestamp-to-index mapping supports NTSC rational timing");
        assert_eq!(
            mf_frames.iter().map(|f| f.index).collect::<Vec<_>>(),
            [20, 21, 22, 23]
        );
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_4k_capture_stays_native_while_the_preview_is_downscaled() {
    let dir = temp("4k");
    let ffmpeg = ffmpeg();
    let video = dir.join("4k.mkv");
    let status = std::process::Command::new(&ffmpeg.ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=3840x2160:rate=24",
            "-frames:v",
            "1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-qp",
            "0",
            "-pix_fmt",
            "yuv420p",
            video.to_string_lossy().as_ref(),
        ])
        .status()
        .expect("FFmpeg should run");
    assert!(status.success(), "FFmpeg could not encode the 4K fixture");
    let info = probe(&ffmpeg.ffprobe, &video).unwrap();
    assert_eq!((info.width, info.height), (3840, 2160));

    let raw = dir.join("preview.rgba");
    let preview = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        move |context| {
            preview_frame(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                0,
                PREVIEW_WIDTH,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!((preview.width, preview.height), (1920, 1080));

    let png = dir.join("4k.png");
    let raw = dir.join("capture.rgba");
    let size = with_context({
        let raw = raw.clone();
        let video = video.clone();
        let ffmpeg = ffmpeg.clone();
        let info = info.clone();
        let png = png.clone();
        move |context| {
            capture_png(
                DecodeSource {
                    context: &context,
                    ffmpeg: &ffmpeg.ffmpeg,
                    input: &video,
                    info: &info,
                },
                0,
                Crop::FULL,
                &png,
                &raw,
            )
        }
    })
    .unwrap();
    assert_eq!(
        size,
        (3840, 2160),
        "the capture decodes at the source size, not the preview"
    );
    let decoded = image::open(&png).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (3840, 2160));
    assert!(!raw.exists());
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
#[allow(unsafe_code)]
fn synthetic_decode_performance_diagnostic_1080p_4k_8k_at_60fps() {
    use std::{
        process::{Command, Stdio},
        sync::Arc,
        time::Instant,
    };
    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
            Threading::{
                GetCurrentProcessId, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
            },
        },
    };

    fn process_peak_ws(pid: u32) -> usize {
        // SAFETY: query-only process handle and initialized PROCESS_MEMORY_COUNTERS.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            assert!(!process.is_null(), "open diagnostic process {pid}");
            let mut counters = PROCESS_MEMORY_COUNTERS {
                cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                ..Default::default()
            };
            let ok = K32GetProcessMemoryInfo(process, &mut counters, counters.cb);
            windows_sys::Win32::Foundation::CloseHandle(process);
            assert_ne!(ok, 0, "read diagnostic working set for process {pid}");
            counters.PeakWorkingSetSize
        }
    }

    fn peak_ws_from_handle(process: HANDLE) -> usize {
        // SAFETY: caller owns a valid query-only process handle.
        unsafe {
            let mut counters = PROCESS_MEMORY_COUNTERS {
                cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                ..Default::default()
            };
            let ok = K32GetProcessMemoryInfo(process, &mut counters, counters.cb);
            assert_ne!(ok, 0, "read diagnostic peak working set");
            counters.PeakWorkingSetSize
        }
    }

    fn measure_current_peak<T>(body: impl FnOnce() -> T) -> (T, usize) {
        let pid = unsafe { GetCurrentProcessId() };
        let baseline = process_peak_ws(pid);
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let peak = Arc::new(std::sync::atomic::AtomicUsize::new(baseline));
        let stop_thread = stop.clone();
        let peak_thread = peak.clone();
        let sampler = std::thread::spawn(move || {
            while !stop_thread.load(Ordering::Acquire) {
                let current = process_peak_ws(pid);
                peak_thread.fetch_max(current, Ordering::AcqRel);
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        let value = body();
        stop.store(true, Ordering::Release);
        sampler.join().unwrap();
        (value, peak.load(Ordering::Acquire).saturating_sub(baseline))
    }

    let dir = temp("decode-perf");
    let ffmpeg = ffmpeg();
    let measured_frames = 6_u32;
    println!(
        "FRAME_PERF hardware_h264_mfts={:?}",
        crate::frame_decoder::hardware_h264_transform_names()
    );
    for (width, height, name) in [
        (1920_u32, 1080_u32, "1080p"),
        (3840, 2160, "4k"),
        (7680, 4320, "8k"),
    ] {
        let input = dir.join(format!("{name}-60.mp4"));
        let source = format!("testsrc2=size={width}x{height}:rate=60:duration=0.5");
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
                &source,
                "-frames:v",
                "30",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "30",
                "-profile:v",
                "high",
                "-pix_fmt",
                "yuv420p",
                input.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("FFmpeg should generate the synthetic 60 fps diagnostic source");
        assert!(status.success(), "synthetic {name} fixture encoding failed");
        let info = probe(&ffmpeg.ffprobe, &input).unwrap();
        assert_eq!((info.width, info.height), (width, height));
        assert_eq!(info.frames, 30, "the {name} file really has 30 frames");

        let (mf_result, mf_peak) = measure_current_peak(|| {
            let start = Instant::now();
            let result = crate::frame_decoder::decode_window(
                &input,
                &info,
                0,
                measured_frames,
                PREVIEW_WIDTH,
                &|| false,
            );
            let stages = crate::frame_decoder::take_last_stage_times();
            (result, start.elapsed(), stages)
        });
        let (mf, mf_time, mf_stages) = mf_result;
        let mf_rate = mf
            .as_ref()
            .ok()
            .map(|frames| frames.len() as f64 / mf_time.as_secs_f64());
        let mf_error = mf.as_ref().err().cloned();
        drop(mf);

        let raw = dir.join(format!("{name}-baseline.rgba"));
        let scale = format!(
            "scale={}:{}:flags=bilinear",
            fit_size(width, height, PREVIEW_WIDTH).0,
            fit_size(width, height, PREVIEW_WIDTH).1
        );
        let started = Instant::now();
        let mut child = Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                input.to_string_lossy().as_ref(),
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-dn",
                "-frames:v",
                &measured_frames.to_string(),
                "-vf",
                &scale,
                "-fps_mode",
                "passthrough",
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                raw.to_string_lossy().as_ref(),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the FFmpeg CLI baseline should start");
        let child_pid = child.id();
        let child_process =
            unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, child_pid) };
        assert!(
            !child_process.is_null(),
            "open FFmpeg child for peak-RSS measurement"
        );
        let baseline_time = {
            let status = child.wait().expect("the FFmpeg baseline should finish");
            assert!(status.success(), "the FFmpeg baseline should decode {name}");
            started.elapsed()
        };
        let baseline_peak = peak_ws_from_handle(child_process);
        unsafe { windows_sys::Win32::Foundation::CloseHandle(child_process) };
        let baseline_rate = f64::from(measured_frames) / baseline_time.as_secs_f64();
        let baseline_bytes = fs::metadata(&raw).unwrap().len();
        assert_eq!(
            baseline_bytes,
            u64::from(measured_frames)
                * u64::from(fit_size(width, height, PREVIEW_WIDTH).0)
                * u64::from(fit_size(width, height, PREVIEW_WIDTH).1)
                * 4
        );
        println!(
            "FRAME_PERF {name} src={width}x{height}@60 mf_fps={} mf_ms={:.1} mf_ws_delta_mib={:.1} mf_read_ms={:.1} mf_lock_ms={:.1} mf_convert_ms={:.1} mf_error={:?} ffmpeg_fps={baseline_rate:.1} ffmpeg_ms={:.1} ffmpeg_peak_ws_mib={:.1}",
            mf_rate.map_or_else(|| "n/a".into(), |fps| format!("{fps:.1}")),
            mf_time.as_secs_f64() * 1000.0,
            mf_peak as f64 / (1024.0 * 1024.0),
            mf_stages.map_or(0.0, |stages| stages.0.as_secs_f64() * 1000.0),
            mf_stages.map_or(0.0, |stages| stages.1.as_secs_f64() * 1000.0),
            mf_stages.map_or(0.0, |stages| stages.2.as_secs_f64() * 1000.0),
            mf_error,
            baseline_time.as_secs_f64() * 1000.0,
            baseline_peak as f64 / (1024.0 * 1024.0),
        );
        let _ = fs::remove_file(raw);
    }
    fs::remove_dir_all(dir).unwrap();
}
