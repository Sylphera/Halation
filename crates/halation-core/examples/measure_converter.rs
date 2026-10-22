//! Performance check of the Converter with generated media (docs/features/converter.md §10 and §11.2). Explicit only:
//! `cargo run --release -p halation-core --example measure_converter -- <isolated-directory>`. Needs FFmpeg on PATH or
//! in `<directory>/tools/ffmpeg`. Prints a Markdown table for research/performance.
use halation_core::{
    components::Ffmpeg,
    convert::{self, Source},
    engine::JobEngine,
    playback::{self, Paced, Player},
    queue::{JobSpec, JobState, Lane},
};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

fn ffmpeg(bin: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new(bin)
        .args(["-hide_banner", "-nostdin", "-v", "error", "-y"])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

fn convert_timed(
    engine: &JobEngine,
    pair: &Ffmpeg,
    input: &Path,
    output: &Path,
    source: &Source,
    plan: convert::Plan,
) -> Result<Duration, String> {
    let (input, output, source) = (input.to_owned(), output.to_owned(), source.clone());
    let work = output.with_extension("work");
    let bin = pair.ffmpeg.clone();
    let started = Instant::now();
    let id = engine.submit_task(
        JobSpec::new("converter", "Measure", Lane::Cpu),
        move |context| {
            convert::execute(&context, &input, &output, &work, &source, &plan, Some(&bin))
        },
    );
    loop {
        let state = engine
            .jobs()
            .into_iter()
            .find(|j| j.id == id)
            .map(|j| j.state);
        match state {
            Some(JobState::Done) => return Ok(started.elapsed()),
            Some(JobState::Failed(e)) => return Err(e),
            Some(JobState::Cancelled) | None => return Err("Job ended without a result".into()),
            _ => std::thread::sleep(Duration::from_millis(5)),
        }
    }
}

/// Resident memory of this process's direct children (Linux only; elsewhere `None`).
fn children_rss_mb() -> Option<f64> {
    let tasks = fs::read_dir("/proc/self/task").ok()?;
    let mut total = 0.0;
    for task in tasks.flatten() {
        let children = fs::read_to_string(task.path().join("children")).unwrap_or_default();
        for pid in children.split_whitespace() {
            let status = fs::read_to_string(format!("/proc/{pid}/status")).unwrap_or_default();
            if let Some(kb) = status
                .lines()
                .find_map(|l| l.strip_prefix("VmRSS:"))
                .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<f64>().ok())
            {
                total += kb / 1024.0;
            }
        }
    }
    Some(total)
}

fn ms(d: Duration) -> String {
    format!("{:.0} ms", d.as_secs_f64() * 1000.0)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("Pass an isolated directory")?;
    let root = std::path::absolute(root)?;
    fs::create_dir_all(&root)?;
    let pair = Ffmpeg::find(&root.join("tools")).ok_or("FFmpeg not found")?;
    let engine = JobEngine::new(|| {});
    let mut rows: Vec<(String, String, String)> = Vec::new();

    // 1. Stream copy against re-encoding the same 1080p H.264 + AAC MKV (acceptance §11.2: copy < 5 %)
    let video = root.join("generated-1080p.mkv");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1920x1080:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "20",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            &video.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&video, Some(&pair.ffprobe))?;
    let copy_plan = convert::plan(&source, "mp4").ok_or("MP4 plan missing")?;
    if !copy_plan.copy {
        return Err("H.264 + AAC should be copied".into());
    }
    let copy = convert_timed(
        &engine,
        &pair,
        &video,
        &root.join("copy.mp4"),
        &source,
        copy_plan,
    )?;
    // The planner's own re-encoding path for the same file: the codec is presented as one MP4 must re-encode
    let mut reencoded = source.clone();
    for stream in &mut reencoded.streams {
        if stream.kind == "video" {
            stream.codec = "mpeg4".into();
        }
    }
    let encode_plan = convert::plan(&reencoded, "mp4").ok_or("MP4 plan missing")?;
    let encode = convert_timed(
        &engine,
        &pair,
        &video,
        &root.join("encode.mp4"),
        &reencoded,
        encode_plan,
    )?;
    let ratio = copy.as_secs_f64() / encode.as_secs_f64() * 100.0;
    rows.push((
        "MKV 1080p 20 s → MP4, copy vs H.264 medium".into(),
        format!("{} vs {} ({ratio:.1} %)", ms(copy), ms(encode)),
        if ratio < 5.0 {
            "pass (< 5 %)"
        } else {
            "FAIL (≥ 5 %)"
        }
        .into(),
    ));

    // 2. Three minutes of audio → MP3 (§10: about 1–2 s)
    let song = root.join("generated-3min.wav");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:sample_rate=44100",
            "-t",
            "180",
            "-ac",
            "2",
            &song.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&song, Some(&pair.ffprobe))?;
    let plan = convert::plan(&source, "mp3").ok_or("MP3 plan missing")?;
    let mp3 = convert_timed(&engine, &pair, &song, &root.join("song.mp3"), &source, plan)?;
    rows.push((
        "WAV 3 min → MP3 (V0)".into(),
        ms(mp3),
        "reference: 1–2 s".into(),
    ));

    // 3. A 24 MP PNG → JPG and WEBP (§10: < 1 s and 1–2 s)
    let picture = root.join("generated-24mp.png");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=6000x4000",
            "-frames:v",
            "1",
            &picture.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&picture, None)?;
    for target in ["jpg", "webp"] {
        let plan = convert::plan(&source, target).ok_or("Image plan missing")?;
        let took = convert_timed(
            &engine,
            &pair,
            &picture,
            &root.join(format!("picture.{target}")),
            &source,
            plan,
        )?;
        rows.push((
            format!("PNG 24 MP → {}", target.to_uppercase()),
            ms(took),
            if target == "jpg" {
                "reference: < 1 s"
            } else {
                "reference: 1–2 s"
            }
            .into(),
        ));
    }

    // 4. Audio preview: waveform, time to first sound, seek, decoder memory
    let long = root.join("generated-10min.mp3");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=44100",
            "-t",
            "600",
            "-ac",
            "2",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            &long.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&long, Some(&pair.ffprobe))?;
    let started = Instant::now();
    let peaks = playback::waveform(&pair.ffmpeg, &long, source.duration, &|| false)?;
    rows.push((
        "Waveform of a 10 min MP3".into(),
        ms(started.elapsed()),
        format!("{} columns, off the UI thread", peaks.len()),
    ));
    for (label, at) in [
        ("Play from the start", 0.0),
        ("Seek to 7:30 and play", 450.0),
    ] {
        let started = Instant::now();
        let player = Player::start(
            &pair.ffmpeg,
            &long,
            at,
            Box::new(|| Ok(Box::new(Paced::new(48_000)) as Box<dyn playback::Output>)),
        );
        while player.position() <= at && !player.finished() {
            std::thread::sleep(Duration::from_millis(1));
        }
        let first = started.elapsed();
        std::thread::sleep(Duration::from_millis(500));
        let memory = children_rss_mb().map_or("not measured on this OS".to_owned(), |mb| {
            format!("decoder {mb:.1} MB resident")
        });
        player.stop();
        rows.push((format!("{label}: first sound"), ms(first), memory));
    }

    println!("| Case | Measured | Note |\n| --- | --- | --- |");
    for (case, value, note) in rows {
        println!("| {case} | {value} | {note} |");
    }
    engine.shutdown();
    Ok(())
}
