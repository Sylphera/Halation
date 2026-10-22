//! Audio preview with generated media through a real FFmpeg (an installed component or one on PATH). Without
//! FFmpeg these tests say so and check nothing; `examples/verify_converter.rs` installs one and repeats them.
use halation_core::{
    components::Ffmpeg,
    playback::{self, OutputFactory, Paced, Player, WAVE_BINS},
};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "halation-playback-{}-{}",
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

fn ffmpeg() -> Option<Ffmpeg> {
    let found = Ffmpeg::find(&std::env::temp_dir().join("halation-no-tools"));
    if found.is_none() {
        eprintln!("FFmpeg not found: audio preview tests did not run");
    }
    found
}

/// Two seconds of silence, then two seconds of a 440 Hz tone.
fn generated(bin: &Path, out: &Path) {
    let status = Command::new(bin)
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
        .arg("aevalsrc=if(gt(t\\,2)\\,0.8*sin(2*PI*440*t)\\,0):s=44100:d=4")
        .args(["-ac", "2"])
        .arg(out)
        .status()
        .unwrap();
    assert!(status.success());
}

fn paced() -> OutputFactory {
    Box::new(|| Ok(Box::new(Paced::new(8000)) as Box<dyn playback::Output>))
}

fn until_finished(player: &Player, limit: Duration) {
    let start = Instant::now();
    while !player.finished() {
        assert!(start.elapsed() < limit, "playback did not finish");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn waveform_finds_silence_and_tone() {
    let Some(pair) = ffmpeg() else { return };
    let dir = Directory::new();
    let input = dir.0.join("tone.flac");
    generated(&pair.ffmpeg, &input);
    for duration in [4.0, 0.0] {
        let peaks = playback::waveform(&pair.ffmpeg, &input, duration, &|| false).unwrap();
        assert_eq!(peaks.len(), WAVE_BINS);
        let quarter = WAVE_BINS / 4;
        assert!(
            peaks[..quarter].iter().all(|p| *p < 0.01),
            "{duration}: silence"
        );
        assert!(
            peaks[3 * quarter..].iter().all(|p| *p > 0.95),
            "{duration}: tone"
        );
    }
    let cancelled = playback::waveform(&pair.ffmpeg, &input, 4.0, &|| true);
    assert_eq!(cancelled, Err("Cancelled".into()));
}

#[test]
fn playback_runs_in_real_time_and_seeks() {
    let Some(pair) = ffmpeg() else { return };
    let dir = Directory::new();
    let input = dir.0.join("tone.mp3");
    generated(&pair.ffmpeg, &input);
    let started = Instant::now();
    let player = Player::start(&pair.ffmpeg, &input, 3.0, paced());
    until_finished(&player, Duration::from_secs(5));
    let elapsed = started.elapsed().as_secs_f64();
    assert_eq!(player.error(), None);
    // One second remained after the seek: heard in about that time, never faster than real time.
    assert!(elapsed > 0.9, "played too fast: {elapsed}");
    assert!(
        (player.position() - 4.0).abs() < 0.1,
        "{}",
        player.position()
    );
}

#[test]
fn stopping_ends_playback_at_once() {
    let Some(pair) = ffmpeg() else { return };
    let dir = Directory::new();
    let input = dir.0.join("tone.wav");
    generated(&pair.ffmpeg, &input);
    let player = Player::start(&pair.ffmpeg, &input, 0.0, paced());
    std::thread::sleep(Duration::from_millis(300));
    let heard = player.position();
    assert!(heard > 0.05 && heard < 1.0, "{heard}");
    let stopped = Instant::now();
    player.stop();
    until_finished(&player, Duration::from_secs(1));
    assert!(stopped.elapsed() < Duration::from_millis(500));
    assert_eq!(player.error(), None);
}

#[test]
fn a_file_without_audio_reports_an_error() {
    let Some(pair) = ffmpeg() else { return };
    let dir = Directory::new();
    let input = dir.0.join("not-audio.mp3");
    fs::write(&input, b"plain text, not audio").unwrap();
    let player = Player::start(&pair.ffmpeg, &input, 0.0, paced());
    until_finished(&player, Duration::from_secs(5));
    assert!(player.error().is_some());
    assert!(playback::waveform(&pair.ffmpeg, &input, 0.0, &|| false).is_err());
}
