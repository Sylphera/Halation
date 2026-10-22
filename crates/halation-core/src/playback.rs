//! Audio preview: a waveform summary and playback. FFmpeg decodes as a separate program (like every conversion) and
//! the samples go to the system's shared audio output (WASAPI on Windows). Nothing runs at rest: pausing or seeking
//! ends the decoder, and playing again starts a new one at the position reached.
#![allow(unsafe_code)]

use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

/* ===== waveform ===== */

/// Columns of the waveform summary. Drawn as one vector envelope, so it scales to any canvas width.
pub const WAVE_BINS: usize = 480;
/// Decoding rate for the summary: enough to find peaks, cheap to decode (mono, 16 bit).
const WAVE_RATE: u32 = 4000;
/// Longer sources are played but not summarised (a flat line is drawn instead).
pub const WAVE_MAX_SECONDS: f64 = 4.0 * 3600.0;

/// Peak level (0..1, normalised to the loudest column) of the first audio stream, [`WAVE_BINS`] columns.
/// `duration` comes from the probe; 0 when unknown. `cancelled` is checked between reads and ends the decoder.
pub fn waveform(
    ffmpeg: &Path,
    input: &Path,
    duration: f64,
    cancelled: &dyn Fn() -> bool,
) -> Result<Vec<f32>, String> {
    if duration > WAVE_MAX_SECONDS {
        return Ok(vec![0.0; WAVE_BINS]);
    }
    let rate = WAVE_RATE.to_string();
    let mut decoder = Decoder::start(
        ffmpeg,
        &[
            "-i", "<input>", "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", &rate, "-f",
            "s16le", "-",
        ],
        input,
        None,
    )?;
    // Known duration: samples go straight to their column. Unknown: 0.1 s blocks, reduced at the end.
    let per_bin = (duration > 0.0).then(|| {
        ((duration * f64::from(WAVE_RATE)) / WAVE_BINS as f64)
            .ceil()
            .max(1.0) as u64
    });
    let block = per_bin.unwrap_or(u64::from(WAVE_RATE) / 10);
    let limit = (WAVE_MAX_SECONDS * f64::from(WAVE_RATE)) as u64;
    let mut peaks: Vec<f32> = Vec::with_capacity(if per_bin.is_some() { WAVE_BINS } else { 4096 });
    let mut current = 0_u16;
    let mut count = 0_u64;
    let mut total = 0_u64;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut filled = 0;
    loop {
        if cancelled() {
            return Err("Cancelled".into());
        }
        let read = decoder.read(&mut buffer[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
        let whole = filled / 2 * 2;
        for sample in buffer[..whole].chunks_exact(2) {
            current = current.max(i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs());
            count += 1;
            total += 1;
            if count == block {
                if per_bin.is_none() || peaks.len() + 1 < WAVE_BINS {
                    peaks.push(f32::from(current) / 32768.0);
                    current = 0;
                }
                count = 0;
            }
        }
        buffer.copy_within(whole..filled, 0);
        filled -= whole;
        if total >= limit {
            break;
        }
    }
    if count > 0 || peaks.is_empty() {
        peaks.push(f32::from(current) / 32768.0);
    }
    decoder.finish(total > 0)?;
    Ok(normalise(reduce(&peaks, WAVE_BINS)))
}

/// Maximum over ranges, so `values` of any length become exactly `bins` columns.
fn reduce(values: &[f32], bins: usize) -> Vec<f32> {
    if values.len() == bins {
        return values.to_vec();
    }
    (0..bins)
        .map(|bin| {
            let start = bin * values.len() / bins;
            let end = ((bin + 1) * values.len() / bins)
                .max(start + 1)
                .min(values.len());
            values
                .get(start..end)
                .map_or(0.0, |range| range.iter().copied().fold(0.0, f32::max))
        })
        .collect()
}

fn normalise(mut values: Vec<f32>) -> Vec<f32> {
    let loudest = values.iter().copied().fold(0.0, f32::max);
    if loudest > 0.001 {
        for value in &mut values {
            *value = (*value / loudest).clamp(0.0, 1.0);
        }
    }
    values
}

/// The waveform as a closed, mirrored envelope in a `bins` × 2 view box (centre line at y = 1), for a vector path.
/// Silence keeps a hairline so the timeline stays visible.
pub fn envelope_path(peaks: &[f32]) -> String {
    use std::fmt::Write;
    let mut path = String::with_capacity(peaks.len() * 24 + 16);
    let level = |p: f32| p.clamp(0.0, 1.0).max(0.012) * 0.96;
    path.push_str("M 0 1");
    for (x, peak) in peaks.iter().enumerate() {
        let _ = write!(path, " L {x}.5 {:.3}", 1.0 - level(*peak));
    }
    let _ = write!(path, " L {} 1", peaks.len());
    for (x, peak) in peaks.iter().enumerate().rev() {
        let _ = write!(path, " L {x}.5 {:.3}", 1.0 + level(*peak));
    }
    path.push_str(" Z");
    path
}

/// `m:ss` (or `h:mm:ss`), for the player's clock.
pub fn clock(seconds: f64) -> String {
    let total = if seconds.is_finite() {
        seconds.max(0.0) as u64
    } else {
        0
    };
    let (h, m, s) = (total / 3600, total / 60 % 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/* ===== decoder ===== */

/// One FFmpeg decoding to raw samples on its standard output. Killed when dropped.
struct Decoder {
    child: Arc<Mutex<Option<Child>>>,
    stdout: std::process::ChildStdout,
    error: Arc<Mutex<String>>,
}

impl Decoder {
    /// `args` follow FFmpeg's input options; the string `<input>` is replaced by the path. `at` seeks first.
    fn start(ffmpeg: &Path, args: &[&str], input: &Path, at: Option<f64>) -> Result<Self, String> {
        let mut command = Command::new(ffmpeg);
        command.args([
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
        ]);
        if let Some(at) = at.filter(|t| *t > 0.0) {
            command.args(["-ss", &format!("{at:.3}")]);
        }
        for arg in args {
            if *arg == "<input>" {
                command.arg(input);
            } else {
                command.arg(arg);
            }
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = ffmpeg.parent().filter(|d| d.is_dir()) {
            command.current_dir(dir);
        }
        crate::convert::quiet(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("{}: {e}", ffmpeg.display()))?;
        let stdout = child.stdout.take().ok_or("FFmpeg gave no output")?;
        let error = Arc::new(Mutex::new(String::new()));
        // Drained apart so a file that keeps reporting errors can never block the decoder on a full pipe.
        if let Some(mut stderr) = child.stderr.take() {
            let error = error.clone();
            let _ = std::thread::Builder::new()
                .name("preview-decoder-log".into())
                .spawn(move || {
                    let mut chunk = [0_u8; 1024];
                    while let Ok(read @ 1..) = stderr.read(&mut chunk) {
                        let mut text = hold(&error);
                        if text.len() > 4096 {
                            text.clear();
                        }
                        text.push_str(&String::from_utf8_lossy(&chunk[..read]));
                    }
                });
        }
        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            stdout,
            error,
        })
    }

    fn read(&mut self, buffer: &mut [u8]) -> Result<usize, String> {
        loop {
            match self.stdout.read(buffer) {
                Ok(read) => return Ok(read),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    /// After the end of the output: an exit failure is an error only when nothing usable was decoded.
    fn finish(self, decoded: bool) -> Result<(), String> {
        let status = hold(&self.child).take().map(|mut c| c.wait());
        let ok = matches!(status, Some(Ok(s)) if s.success());
        if ok || decoded {
            Ok(())
        } else {
            let error = hold(&self.error).trim().to_owned();
            Err(if error.is_empty() {
                "This file has no audio that can be played".into()
            } else {
                error.lines().last().unwrap_or_default().to_owned()
            })
        }
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        if let Some(mut child) = hold(&self.child).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/* ===== output ===== */

/// Where decoded samples go: interleaved stereo `f32` at [`Output::rate`].
pub trait Output {
    fn rate(&self) -> u32;
    /// Queues every frame unless `stop` is raised; blocks while the device buffer is full and keeps `played`
    /// (frames actually heard since the start) current.
    fn write(
        &mut self,
        samples: &[f32],
        stop: &AtomicBool,
        played: &AtomicU64,
    ) -> Result<(), String>;
    /// Waits until everything queued has been heard (or `stop`).
    fn drain(&mut self, stop: &AtomicBool, played: &AtomicU64) -> Result<(), String>;
}

/// Makes the output inside the playback thread (audio clients belong to the thread that created them).
pub type OutputFactory = Box<dyn FnOnce() -> Result<Box<dyn Output>, String> + Send>;

/// The default shared output device. Elsewhere than Windows (development and tests) a silent real-time clock.
pub fn system_output() -> OutputFactory {
    #[cfg(windows)]
    {
        Box::new(|| wasapi::Wasapi::open().map(|o| Box::new(o) as Box<dyn Output>))
    }
    #[cfg(not(windows))]
    {
        Box::new(|| Ok(Box::new(Paced::new(48_000)) as Box<dyn Output>))
    }
}

/// Consumes samples at real-time speed without a device: the same timing as a sound card, for tests.
pub struct Paced {
    rate: u32,
    start: Option<Instant>,
    written: u64,
}

impl Paced {
    pub fn new(rate: u32) -> Self {
        Self {
            rate,
            start: None,
            written: 0,
        }
    }
    fn heard(&self) -> u64 {
        self.start.map_or(0, |start| {
            ((start.elapsed().as_secs_f64() * f64::from(self.rate)) as u64).min(self.written)
        })
    }
}

impl Output for Paced {
    fn rate(&self) -> u32 {
        self.rate
    }
    fn write(
        &mut self,
        samples: &[f32],
        stop: &AtomicBool,
        played: &AtomicU64,
    ) -> Result<(), String> {
        self.start.get_or_insert_with(Instant::now);
        self.written += samples.len() as u64 / 2;
        // A device buffer of 0.1 s: block while more than that is queued.
        let ahead = u64::from(self.rate) / 10;
        while self.written > self.heard() + ahead && !stop.load(Ordering::Acquire) {
            played.store(self.heard(), Ordering::Release);
            std::thread::sleep(Duration::from_millis(10));
        }
        played.store(self.heard(), Ordering::Release);
        Ok(())
    }
    fn drain(&mut self, stop: &AtomicBool, played: &AtomicU64) -> Result<(), String> {
        while self.heard() < self.written && !stop.load(Ordering::Acquire) {
            played.store(self.heard(), Ordering::Release);
            std::thread::sleep(Duration::from_millis(10));
        }
        played.store(self.heard(), Ordering::Release);
        Ok(())
    }
}

#[cfg(windows)]
mod wasapi {
    //! Shared-mode, event-driven WASAPI render client. Stereo `f32` at the device's mix rate; Windows converts the
    //! channel layout (AUTOCONVERTPCM).
    use super::Output;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        Media::Audio::{
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            IAudioClient, IAudioRenderClient, IMMDeviceEnumerator, MMDeviceEnumerator,
            WAVEFORMATEX, eConsole, eRender,
        },
        System::{
            Com::{
                CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
                CoUninitialize,
            },
            Threading::{CreateEventW, WaitForSingleObject},
        },
    };

    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    /// 200 ms of device buffer, in 100 ns units
    const BUFFER: i64 = 2_000_000;

    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            // SAFETY: paired with the successful CoInitializeEx of `Wasapi::open` on this thread.
            unsafe { CoUninitialize() };
        }
    }

    pub struct Wasapi {
        client: IAudioClient,
        render: IAudioRenderClient,
        event: HANDLE,
        frames: u32,
        rate: u32,
        written: u64,
        started: bool,
        // Dropped last: the COM objects above are released before COM is uninitialised.
        _com: Com,
    }

    fn text(error: windows::core::Error) -> String {
        format!("Audio output: {}", error.message())
    }

    impl Wasapi {
        pub fn open() -> Result<Self, String> {
            // SAFETY: plain COM and WASAPI calls on this thread; every pointer comes from the API itself and the
            // mix format is freed once, after it was read.
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED)
                    .ok()
                    .map_err(text)?;
                let com = Com;
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(text)?;
                let device = enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|_| "No audio output device is available".to_owned())?;
                let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(text)?;
                let mix = client.GetMixFormat().map_err(text)?;
                let rate = (*mix).nSamplesPerSec;
                CoTaskMemFree(Some(mix as *const _));
                let format = WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
                    nChannels: 2,
                    nSamplesPerSec: rate,
                    nAvgBytesPerSec: rate * 8,
                    nBlockAlign: 8,
                    wBitsPerSample: 32,
                    cbSize: 0,
                };
                client
                    .Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                        BUFFER,
                        0,
                        &format,
                        None,
                    )
                    .map_err(text)?;
                let event = CreateEventW(None, false, false, None).map_err(text)?;
                if let Err(error) = client.SetEventHandle(event) {
                    let _ = CloseHandle(event);
                    return Err(text(error));
                }
                let frames = client.GetBufferSize().map_err(text)?;
                let render: IAudioRenderClient = client.GetService().map_err(text)?;
                Ok(Self {
                    client,
                    render,
                    event,
                    frames,
                    rate,
                    written: 0,
                    started: false,
                    _com: com,
                })
            }
        }

        fn padding(&self) -> Result<u32, String> {
            // SAFETY: an initialised client.
            unsafe { self.client.GetCurrentPadding().map_err(text) }
        }

        fn wait(&self) {
            // SAFETY: the event handle stays open for the life of `self`.
            unsafe {
                let _ = WaitForSingleObject(self.event, 100);
            }
        }
    }

    impl Output for Wasapi {
        fn rate(&self) -> u32 {
            self.rate
        }

        fn write(
            &mut self,
            samples: &[f32],
            stop: &AtomicBool,
            played: &AtomicU64,
        ) -> Result<(), String> {
            let mut rest = samples;
            while !rest.is_empty() && !stop.load(Ordering::Acquire) {
                let padding = self.padding()?;
                played.store(
                    self.written.saturating_sub(u64::from(padding)),
                    Ordering::Release,
                );
                let free = self
                    .frames
                    .saturating_sub(padding)
                    .min((rest.len() / 2) as u32);
                if free == 0 {
                    self.wait();
                    continue;
                }
                let count = free as usize * 2;
                // SAFETY: GetBuffer returns room for `free` frames of the stereo f32 format initialised above
                // (8 bytes each); exactly that many are copied and released.
                unsafe {
                    let buffer = self.render.GetBuffer(free).map_err(text)?;
                    std::ptr::copy_nonoverlapping(rest.as_ptr(), buffer.cast::<f32>(), count);
                    self.render.ReleaseBuffer(free, 0).map_err(text)?;
                }
                self.written += u64::from(free);
                rest = &rest[count..];
                if !self.started {
                    // SAFETY: an initialised client with data queued.
                    unsafe { self.client.Start().map_err(text)? };
                    self.started = true;
                }
            }
            Ok(())
        }

        fn drain(&mut self, stop: &AtomicBool, played: &AtomicU64) -> Result<(), String> {
            loop {
                let padding = self.padding()?;
                played.store(
                    self.written.saturating_sub(u64::from(padding)),
                    Ordering::Release,
                );
                if padding == 0 || !self.started || stop.load(Ordering::Acquire) {
                    return Ok(());
                }
                self.wait();
            }
        }
    }

    impl Drop for Wasapi {
        fn drop(&mut self) {
            // SAFETY: the client and the event are owned by `self` and released once here.
            unsafe {
                let _ = self.client.Stop();
                let _ = CloseHandle(self.event);
            }
        }
    }
}

/* ===== player ===== */

struct Shared {
    stop: AtomicBool,
    finished: AtomicBool,
    played: AtomicU64,
    rate: AtomicU32,
    error: Mutex<Option<String>>,
    decoder: Mutex<Option<Arc<Mutex<Option<Child>>>>>,
}

/// One playback from a position to the end. Stopping (or dropping) ends the decoder and the output at once and
/// never waits for the thread.
pub struct Player {
    shared: Arc<Shared>,
    from: f64,
}

impl Player {
    pub fn start(ffmpeg: &Path, input: &Path, from: f64, output: OutputFactory) -> Self {
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            played: AtomicU64::new(0),
            rate: AtomicU32::new(0),
            error: Mutex::new(None),
            decoder: Mutex::new(None),
        });
        let thread_shared = shared.clone();
        let ffmpeg = ffmpeg.to_owned();
        let input = input.to_owned();
        let spawned = std::thread::Builder::new()
            .name("audio-preview".into())
            .spawn(move || {
                let shared = thread_shared;
                if let Err(error) = play(&shared, &ffmpeg, &input, from, output)
                    && !shared.stop.load(Ordering::Acquire)
                {
                    *hold(&shared.error) = Some(error);
                }
                shared.finished.store(true, Ordering::Release);
            });
        if let Err(error) = spawned {
            *hold(&shared.error) = Some(error.to_string());
            shared.finished.store(true, Ordering::Release);
        }
        Self { shared, from }
    }

    /// Seconds into the source that have been heard.
    pub fn position(&self) -> f64 {
        let rate = self.shared.rate.load(Ordering::Acquire);
        if rate == 0 {
            return self.from;
        }
        self.from + self.shared.played.load(Ordering::Acquire) as f64 / f64::from(rate)
    }

    /// The end was reached, or playback failed ([`Player::error`]).
    pub fn finished(&self) -> bool {
        self.shared.finished.load(Ordering::Acquire)
    }

    pub fn error(&self) -> Option<String> {
        hold(&self.shared.error).clone()
    }

    pub fn stop(&self) {
        self.shared.stop.store(true, Ordering::Release);
        if let Some(child) = hold(&self.shared.decoder).take()
            && let Some(mut child) = hold(&child).take()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.stop();
    }
}

fn play(
    shared: &Shared,
    ffmpeg: &Path,
    input: &Path,
    from: f64,
    output: OutputFactory,
) -> Result<(), String> {
    let mut output = output()?;
    let rate = output.rate();
    let rate_text = rate.to_string();
    let mut decoder = Decoder::start(
        ffmpeg,
        &[
            "-i", "<input>", "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-ar", &rate_text,
            "-f", "f32le", "-",
        ],
        input,
        Some(from),
    )?;
    *hold(&shared.decoder) = Some(decoder.child.clone());
    if shared.stop.load(Ordering::Acquire) {
        return Ok(());
    }
    shared.rate.store(rate, Ordering::Release);
    // About 21 ms per read at 48 kHz; partial frames carry over to the next read.
    let mut bytes = vec![0_u8; 8 * 1024];
    let mut samples: Vec<f32> = Vec::with_capacity(2 * 1024);
    let mut filled = 0;
    let mut decoded = false;
    loop {
        if shared.stop.load(Ordering::Acquire) {
            return Ok(());
        }
        let read = decoder.read(&mut bytes[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
        let whole = filled / 8 * 8;
        samples.clear();
        samples.extend(
            bytes[..whole]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        );
        bytes.copy_within(whole..filled, 0);
        filled -= whole;
        decoded |= !samples.is_empty();
        output.write(&samples, &shared.stop, &shared.played)?;
    }
    output.drain(&shared.stop, &shared.played)?;
    decoder.finish(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduce_keeps_the_peak_of_each_range() {
        let values = [0.1, 0.9, 0.2, 0.3, 0.8, 0.0];
        assert_eq!(reduce(&values, 3), vec![0.9, 0.3, 0.8]);
        assert_eq!(reduce(&values, 6), values.to_vec());
        assert_eq!(reduce(&[0.5], 4), vec![0.5, 0.5, 0.5, 0.5]);
        assert_eq!(reduce(&[], 2), vec![0.0, 0.0]);
    }

    #[test]
    fn envelope_is_closed_and_mirrored() {
        let path = envelope_path(&normalise(vec![0.0, 0.5, 1.0]));
        assert!(path.starts_with("M 0 1") && path.ends_with(" Z"));
        assert!(path.contains("L 2.5 0.040") && path.contains("L 2.5 1.960"));
        // Silence keeps a hairline on both sides of the centre line
        assert!(path.contains("L 0.5 0.988") && path.contains("L 0.5 1.012"));
    }

    #[test]
    fn clock_formats_minutes_and_hours() {
        assert_eq!(clock(0.0), "0:00");
        assert_eq!(clock(83.9), "1:23");
        assert_eq!(clock(3725.0), "1:02:05");
        assert_eq!(clock(f64::NAN), "0:00");
    }

    #[test]
    fn paced_output_follows_real_time() {
        let mut output = Paced::new(1000);
        let stop = AtomicBool::new(false);
        let played = AtomicU64::new(0);
        let started = Instant::now();
        output.write(&vec![0.0; 2 * 300], &stop, &played).unwrap();
        output.drain(&stop, &played).unwrap();
        assert!(started.elapsed() >= Duration::from_millis(290));
        assert_eq!(played.load(Ordering::Acquire), 300);
    }
}
