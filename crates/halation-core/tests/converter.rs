use halation_core::{
    convert::{self, Class, Source, Stream},
    engine::JobEngine,
    queue::{JobSpec, JobState, Lane},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "halation-converter-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn source(class: Class, format: &str, streams: Vec<Stream>) -> Source {
    Source {
        class,
        format: format.into(),
        named: format.into(),
        streams,
        duration: 1.0,
        width: 64,
        height: 64,
        alpha: false,
        hdr: false,
        few_colours: false,
        size: 100,
        needs_ffmpeg: false,
    }
}
fn audio(codec: &str) -> Stream {
    Stream {
        index: 1,
        kind: "audio".into(),
        codec: codec.into(),
        channels: 2,
        rate: 48000,
        bits: 16,
        ..Default::default()
    }
}
fn video(codec: &str) -> Stream {
    Stream {
        kind: "video".into(),
        codec: codec.into(),
        width: 64,
        height: 64,
        ..Default::default()
    }
}
fn contains(args: &[String], pair: &[&str]) -> bool {
    args.windows(pair.len())
        .any(|a| a.iter().map(String::as_str).eq(pair.iter().copied()))
}
fn wait(engine: &JobEngine, id: &str) -> JobState {
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let state = engine
            .jobs()
            .into_iter()
            .find(|j| j.id == id)
            .unwrap()
            .state;
        if state.finished() {
            return state;
        }
        assert!(Instant::now() < end, "job did not finish");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn video_copy_and_partial_transcode_preserve_each_compatible_stream() {
    let mut src = source(Class::Video, "mkv", vec![video("h264"), audio("aac")]);
    let p = convert::plan(&src, "mp4").unwrap();
    assert!(p.copy);
    assert_eq!(p.weight, 0);
    assert!(contains(&p.args, &["-c:v", "copy"]));
    assert!(contains(&p.args, &["-c:a:0", "copy"]));
    src.streams[1].codec = "flac".into();
    src.streams.push(Stream {
        index: 2,
        kind: "subtitle".into(),
        codec: "hdmv_pgs_subtitle".into(),
        ..Default::default()
    });
    let p = convert::plan(&src, "mp4").unwrap();
    assert!(!p.copy);
    assert!(contains(&p.args, &["-c:v", "copy"]));
    assert!(contains(&p.args, &["-c:a:0", "aac"]));
    assert!(p.notes.contains(&"Image subtitles are discarded"));
    assert!(!contains(&p.args, &["-map", "0:2"]));
}

#[test]
fn every_curated_audio_and_video_target_has_a_plan() {
    let a = source(Class::Audio, "aac", vec![audio("aac")]);
    let plans = convert::targets(&a, None);
    assert_eq!(plans.len(), 7);
    for target in ["mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff"] {
        assert!(plans.iter().any(|p| p.target == target));
    }
    let v = source(
        Class::Video,
        "avi",
        vec![video("mpeg4"), audio("pcm_s16le")],
    );
    let plans = convert::targets(&v, None);
    assert_eq!(plans.len(), 10);
    for target in [
        "mp4", "mkv", "webm", "mov", "gif", "mp3", "m4a", "flac", "wav", "opus",
    ] {
        assert!(plans.iter().any(|p| p.target == target));
    }
    assert_eq!(plans[0].target, "mkv", "prefer compatible remux");
}

#[test]
fn missing_encoder_only_hides_targets_that_need_it() {
    let a = source(Class::Audio, "wav", vec![audio("pcm_s16le")]);
    let all = convert::targets(&a, None);
    let enc = all
        .iter()
        .flat_map(|p| p.needs.iter())
        .filter(|n| **n != "libvorbis")
        .map(|s| (*s).to_owned())
        .collect();
    let filtered = convert::targets(&a, Some(&enc));
    assert_eq!(filtered.len(), all.len() - 1);
    assert!(!filtered.iter().any(|p| p.target == "ogg"));
}

#[test]
fn covers_do_not_turn_audio_into_video_and_original_format_is_not_offered() {
    let a = source(
        Class::Audio,
        "mp3",
        vec![
            audio("mp3"),
            Stream {
                index: 2,
                kind: "video".into(),
                codec: "mjpeg".into(),
                cover: true,
                ..Default::default()
            },
        ],
    );
    assert!(!convert::targets(&a, None).iter().any(|p| p.target == "mp3"));
    assert!(contains(
        &convert::plan(&a, "flac").unwrap().args,
        &["-disposition:v:0", "attached_pic"]
    ));
}

#[test]
fn image_content_beats_a_misleading_extension() {
    let dir = Directory::new();
    let path = dir.0.join("sample.mp3");
    image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 0]))
        .save_with_format(&path, image::ImageFormat::Png)
        .unwrap();
    let source = convert::probe(&path, None).unwrap();
    assert_eq!(source.class, Class::Image);
    assert_eq!(source.format, "png");
    assert!(source.summary().contains("named .mp3"));
    let disguised_tga = dir.0.join("sample.tga");
    fs::copy(&path, &disguised_tga).unwrap();
    assert_eq!(convert::probe(&disguised_tga, None).unwrap().format, "png");
    assert!(
        convert::plan(&source, "jpg")
            .unwrap()
            .notes
            .contains(&"Transparency becomes white")
    );
    for target in ["jpg", "webp", "tiff", "bmp", "ico", "gif"] {
        assert!(
            convert::targets(&source, None)
                .iter()
                .any(|p| p.target == target)
        );
    }
}

fn image_job(
    input: &Path,
    output: &Path,
    workspace: &Path,
    target: &'static str,
) -> (JobEngine, String) {
    let src = convert::probe(input, None).unwrap();
    let plan = convert::plan(&src, target).unwrap();
    let (input, output, workspace) = (input.to_owned(), output.to_owned(), workspace.to_owned());
    let engine = JobEngine::new(|| {});
    let id = engine.submit_task(
        JobSpec::new("converter", "image", Lane::Light),
        move |context| convert::execute(&context, &input, &output, &workspace, &src, &plan, None),
    );
    (engine, id)
}

#[test]
fn transparent_png_to_jpeg_is_white_and_no_part_is_left() {
    let dir = Directory::new();
    let input = dir.0.join("alpha.png");
    let output = dir.0.join("white.jpg");
    let workspace = dir.0.join("work");
    image::RgbaImage::from_pixel(8, 8, image::Rgba([200, 0, 0, 0]))
        .save(&input)
        .unwrap();
    let original = fs::read(&input).unwrap();
    let (engine, id) = image_job(&input, &output, &workspace, "jpg");
    assert_eq!(wait(&engine, &id), JobState::Done);
    let image = image::open(output).unwrap().to_rgb8();
    assert!(image.pixels().all(|p| p.0.iter().all(|c| *c >= 250)));
    assert_eq!(fs::read(input).unwrap(), original);
    assert!(!workspace.exists());
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
}

#[test]
fn colliding_output_and_original_are_never_replaced() {
    let dir = Directory::new();
    let input = dir.0.join("input.png");
    let output = dir.0.join("existing.jpg");
    image::RgbaImage::from_pixel(8, 8, image::Rgba([10, 20, 30, 255]))
        .save(&input)
        .unwrap();
    fs::write(&output, b"unrelated output").unwrap();
    let (engine, id) = image_job(&input, &output, &dir.0.join("one"), "jpg");
    assert!(matches!(wait(&engine, &id), JobState::Failed(_)));
    assert_eq!(fs::read(output).unwrap(), b"unrelated output");
    let original = fs::read(&input).unwrap();
    let (engine, id) = image_job(&input, &input, &dir.0.join("two"), "jpg");
    assert!(matches!(wait(&engine, &id), JobState::Failed(_)));
    assert_eq!(fs::read(input).unwrap(), original);
}

#[test]
fn cancelling_native_work_does_not_publish_its_result() {
    let engine = JobEngine::new(|| {});
    let (tx, rx) = std::sync::mpsc::channel();
    let id = engine.submit_task(
        JobSpec::new("converter", "cancel", Lane::Light),
        move |context| {
            tx.send(()).unwrap();
            loop {
                context.check_cancelled()?;
                std::thread::sleep(Duration::from_millis(1));
            }
        },
    );
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
    engine.cancel(&id);
    assert_eq!(wait(&engine, &id), JobState::Cancelled);
}

#[test]
fn lossless_webp_keeps_alpha_and_all_image_targets_encode() {
    let dir = Directory::new();
    let input = dir.0.join("alpha.png");
    image::RgbaImage::from_pixel(6, 4, image::Rgba([100, 50, 20, 64]))
        .save(&input)
        .unwrap();
    for target in ["webp", "tiff", "bmp", "ico", "gif"] {
        let output = dir.0.join(format!("out.{target}"));
        let (engine, id) = image_job(
            &input,
            &output,
            &dir.0.join(format!("work-{target}")),
            target,
        );
        assert_eq!(wait(&engine, &id), JobState::Done, "{target}");
        let image = image::open(&output).unwrap();
        if target == "webp" {
            assert_eq!(image.to_rgba8().get_pixel(0, 0)[3], 64);
        }
    }
}

#[test]
fn exif_orientation_is_applied_before_png_export() {
    use image::{GenericImageView, ImageEncoder};
    let dir = Directory::new();
    let input = dir.0.join("rotated.jpg");
    let output = dir.0.join("upright.png");
    let mut file = fs::File::create(&input).unwrap();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 90);
    let exif = vec![
        b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    encoder.set_exif_metadata(exif).unwrap();
    encoder
        .encode_image(&image::RgbImage::from_pixel(8, 4, image::Rgb([10, 20, 30])))
        .unwrap();
    drop(file);
    let (engine, id) = image_job(&input, &output, &dir.0.join("work"), "png");
    assert_eq!(wait(&engine, &id), JobState::Done);
    assert_eq!(image::open(output).unwrap().dimensions(), (4, 8));
}

#[test]
fn tiff_is_lzw_and_keeps_sixteen_bit_samples() {
    let dir = Directory::new();
    let input = dir.0.join("deep.png");
    let output = dir.0.join("deep.tiff");
    image::ImageBuffer::<image::Rgb<u16>, Vec<u16>>::from_pixel(
        4,
        3,
        image::Rgb([40000, 12345, 500]),
    )
    .save(&input)
    .unwrap();
    let (engine, id) = image_job(&input, &output, &dir.0.join("work"), "tiff");
    assert_eq!(wait(&engine, &id), JobState::Done);
    let mut decoder = tiff::decoder::Decoder::new(fs::File::open(&output).unwrap()).unwrap();
    assert_eq!(
        decoder.get_tag_u32(tiff::tags::Tag::Compression).unwrap(),
        5
    );
    assert_eq!(
        image::open(output).unwrap().to_rgb16().get_pixel(0, 0).0,
        [40000, 12345, 500]
    );
}

#[test]
fn only_a_confirmed_manual_destination_can_be_replaced() {
    let dir = Directory::new();
    let input = dir.0.join("input.png");
    let output = dir.0.join("chosen.jpg");
    image::RgbImage::from_pixel(4, 4, image::Rgb([10, 20, 30]))
        .save(&input)
        .unwrap();
    fs::write(&output, b"previous output").unwrap();
    let source = convert::probe(&input, None).unwrap();
    let plan = convert::plan(&source, "jpg").unwrap();
    let workspace = dir.0.join("work");
    let original = fs::read(&input).unwrap();
    let exported = output.clone();
    let engine = JobEngine::new(|| {});
    let id = engine.submit_task(
        JobSpec::new("converter", "confirmed replacement", Lane::Light),
        move |context| {
            convert::execute_export(
                &context,
                convert::Conversion {
                    input: &input,
                    output: &output,
                    workspace: &workspace,
                    source: &source,
                    plan: &plan,
                    ffmpeg: None,
                    replace_confirmed: true,
                },
            )
        },
    );
    assert_eq!(wait(&engine, &id), JobState::Done);
    assert!(image::open(exported).is_ok());
    assert_eq!(fs::read(dir.0.join("input.png")).unwrap(), original);
}
