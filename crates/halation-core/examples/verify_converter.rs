//! Explicit integration check with generated media; never run by startup or normal unit tests.
//! Downloads FFmpeg on demand into the supplied isolated evidence directory when absent.
use halation_core::{
    components::{self, Ffmpeg},
    convert,
    engine::JobEngine,
    queue::{JobSpec, JobState, Lane},
};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

fn wait(engine: &JobEngine, id: &str, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    loop {
        let job = engine
            .jobs()
            .into_iter()
            .find(|j| j.id == id)
            .ok_or("Job disappeared")?;
        match job.state {
            JobState::Done => return Ok(()),
            JobState::Failed(e) => return Err(e),
            JobState::Cancelled => return Err("Job cancelled".into()),
            _ => {}
        }
        if start.elapsed() > timeout {
            engine.cancel(id);
            return Err("Verification timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn ffmpeg(bin: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new(bin)
        .args(["-hide_banner", "-nostdin", "-v", "error"])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(output.stdout)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("Pass an isolated evidence directory")?;
    let root = if root.is_absolute() {
        root
    } else {
        std::env::current_dir()?.join(root)
    };
    fs::create_dir_all(&root)?;
    let engine = JobEngine::new(|| {});
    let tools = root.join("tools");
    if Ffmpeg::find(&tools).is_none() {
        let tools = tools.clone();
        let workspace = root.join("install-work");
        let id = engine.submit_task(
            JobSpec::new("components", "Install FFmpeg for verification", Lane::Net),
            move |context| components::install_ffmpeg(&context, &tools, &workspace),
        );
        wait(&engine, &id, Duration::from_secs(25 * 60))?;
    }
    let pair = Ffmpeg::find(&tools).ok_or("FFmpeg pair not found after installation")?;
    let root = root.join(format!(
        "run-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    fs::create_dir(&root)?;
    let input = root.join("generated.mkv");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x64:rate=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            &input.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&input, Some(&pair.ffprobe))?;
    if source.class != convert::Class::Video {
        return Err("Generated video was not detected".into());
    }
    let output = root.join("remux.mp4");
    if output.exists() {
        return Err("Use a fresh directory: remux output already exists".into());
    }
    let plan = convert::plan(&source, "mp4").ok_or("MP4 plan missing")?;
    if !plan.copy {
        return Err("H.264 + AAC should be copied".into());
    }
    let work = root.join("remux-work");
    let src = input.clone();
    let dst = output.clone();
    let bin = pair.ffmpeg.clone();
    let id = engine.submit_task(
        JobSpec::new("converter", "Real remux", Lane::Light),
        move |context| convert::execute(&context, &src, &dst, &work, &source, &plan, Some(&bin)),
    );
    wait(&engine, &id, Duration::from_secs(30))?;
    let hashes = |p: &Path| {
        ffmpeg(
            &pair.ffmpeg,
            &[
                "-i",
                &p.to_string_lossy(),
                "-map",
                "0:v:0",
                "-c",
                "copy",
                "-f",
                "hash",
                "-hash",
                "sha256",
                "-",
            ],
        )
    };
    if hashes(&input)? != hashes(&output)? {
        return Err("Video packet hash changed during stream copy".into());
    }
    let audio = root.join("audio.wav");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000",
            "-t",
            "1",
            &audio.to_string_lossy(),
        ],
    )?;
    let disguised = root.join("misnamed.mp3");
    fs::copy(&audio, &disguised)?;
    let source = convert::probe(&disguised, Some(&pair.ffprobe))?;
    if source.format != "wav" || !source.summary().contains("named .mp3") {
        return Err("Content detection trusted a misleading extension".into());
    }
    for target in ["mp3", "m4a", "flac", "ogg", "opus", "aiff"] {
        let plan = convert::plan(&source, target).ok_or("Audio plan missing")?;
        let source = source.clone();
        let input = audio.clone();
        let output = root.join(format!("audio.{target}"));
        let work = root.join(format!("work-{target}"));
        let bin = pair.ffmpeg.clone();
        let id = engine.submit_task(
            JobSpec::new("converter", "Real audio conversion", Lane::Cpu),
            move |context| {
                convert::execute(&context, &input, &output, &work, &source, &plan, Some(&bin))
            },
        );
        wait(&engine, &id, Duration::from_secs(30))?;
        let checked = convert::probe(&root.join(format!("audio.{target}")), Some(&pair.ffprobe))?;
        if checked.class != convert::Class::Audio {
            return Err(format!("{target} output is not audio").into());
        }
    }
    for target in ["webm", "mov", "gif", "mp3"] {
        let source = convert::probe(&input, Some(&pair.ffprobe))?;
        let plan = convert::plan(&source, target).ok_or("Video plan missing")?;
        let input = input.clone();
        let output = root.join(format!("video.{target}"));
        let workspace = root.join(format!("video-work-{target}"));
        let bin = pair.ffmpeg.clone();
        let id = engine.submit_task(
            JobSpec::new("converter", "Real video conversion", Lane::Cpu),
            move |context| {
                convert::execute(
                    &context,
                    &input,
                    &output,
                    &workspace,
                    &source,
                    &plan,
                    Some(&bin),
                )
            },
        );
        wait(&engine, &id, Duration::from_secs(30))?;
        let output_source =
            convert::probe(&root.join(format!("video.{target}")), Some(&pair.ffprobe))?;
        if !matches!(
            output_source.class,
            convert::Class::Video | convert::Class::Audio | convert::Class::Animated
        ) {
            return Err(format!("Invalid {target} output").into());
        }
    }
    let long = root.join("long.mkv");
    ffmpeg(
        &pair.ffmpeg,
        &[
            "-y",
            "-stream_loop",
            "3599",
            "-i",
            &input.to_string_lossy(),
            "-c",
            "copy",
            &long.to_string_lossy(),
        ],
    )?;
    let source = convert::probe(&long, Some(&pair.ffprobe))?;
    let plan = convert::plan(&source, "webm").ok_or("Cancellation plan missing")?;
    let output = root.join("cancelled.webm");
    let workspace = root.join("cancel-work");
    let bin = pair.ffmpeg.clone();
    let destination = output.clone();
    let work = workspace.clone();
    let id = engine.submit_task(
        JobSpec::new("converter", "Cancel real video encoding", Lane::Cpu),
        move |context| {
            convert::execute(
                &context,
                &long,
                &destination,
                &work,
                &source,
                &plan,
                Some(&bin),
            )
        },
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    while !engine
        .jobs()
        .iter()
        .any(|j| j.id == id && j.progress.is_some_and(|p| p > 0.0))
    {
        if Instant::now() > deadline {
            engine.cancel(&id);
            return Err("Encoder reported no progress".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    engine.cancel(&id);
    let _ = wait(&engine, &id, Duration::from_secs(10));
    if engine.jobs().iter().find(|j| j.id == id).map(|j| &j.state) != Some(&JobState::Cancelled) {
        return Err("Running encoder was not cancelled".into());
    }
    if output.exists()
        || workspace.exists()
        || fs::read_dir(&root)?
            .filter_map(Result::ok)
            .any(|e| e.path().extension().is_some_and(|e| e == "part"))
    {
        return Err("Cancellation left an output or partial file".into());
    }
    println!(
        "PASS: component installation/lookup, content detection, packet-preserving MP4 remux, six audio formats, WebM/MOV/GIF, audio extraction, real progress and running-process cancellation without partial files."
    );
    Ok(())
}
