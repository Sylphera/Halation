//! Frame Capture backend: probe, exact frame extraction, preview windows, keyframe index and strip, sharpness,
//! crop math, the queue and the session. FFmpeg and ffprobe are external programs (the beta installs them on demand);
//! nothing here depends on Slint or Tauri.
//!
//! The video is never read whole: preview windows decode a bounded range, captures decode one native frame, and the
//! keyframe index reads packets only. Stepping uses one decode for a window of frames, never one process per frame.

use crate::{
    atomic_file,
    engine::TaskContext,
    names,
    process::{self, ProcessSpec},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::Duration,
};

/// Preview frames are never wider than this (the page scales them down further).
pub const PREVIEW_WIDTH: u32 = 1920;
/// Decoded preview frames kept around the playhead, in bytes (the Tauri viewer uses 400 MB).
pub const CACHE_BYTES: usize = 400 * 1024 * 1024;
/// Queue cap (`QMAX` in the Tauri viewer).
pub const QUEUE_MAX: usize = 8;
/// Sharpest-frame search radius and the width it analyses.
pub const SHARP_RADIUS: u64 = 12;
pub const SHARP_WIDTH: u32 = 360;
/// Keyframe strip: thumbnail width, at most this many keyframes, and the strip's pixel width.
pub const KEY_WIDTH: u32 = 256;
pub const MAX_KEYFRAMES: usize = 300;
pub const STRIP_WIDTH: u32 = 1920;
/// Frames decoded on each side of the playhead for stepping.
pub const WINDOW_RADIUS: u64 = 12;
/// Result list length.
pub const RESULT_KEEP: usize = 12;
/// A single range read is capped, like the Tauri backend.
const SAMPLE_BYTES: u64 = 64 * 1024;

/* ===== probe ===== */

/// A video's identity and timing. `fps_num / fps_den` is the rational rate: frame times are derived from it, never
/// from a rounded float, so `n / fps` never drifts.
#[derive(Debug, Clone, PartialEq)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub frames: u64,
    pub duration: f64,
    pub has_audio: bool,
}

impl VideoInfo {
    pub fn fps(&self) -> f64 {
        if self.fps_den == 0 {
            0.0
        } else {
            f64::from(self.fps_num) / f64::from(self.fps_den)
        }
    }

    /// Seconds of frame `n` from the rational rate.
    pub fn time(&self, n: u64) -> f64 {
        if self.fps_num == 0 {
            0.0
        } else {
            n as f64 * f64::from(self.fps_den) / f64::from(self.fps_num)
        }
    }

    /// The frame under `seconds`, clamped to the video.
    pub fn frame_at(&self, seconds: f64) -> u64 {
        if !seconds.is_finite() || seconds <= 0.0 || self.fps_num == 0 {
            return 0;
        }
        let n = (seconds * f64::from(self.fps_num) / f64::from(self.fps_den)).round() as u64;
        n.min(self.frames.saturating_sub(1))
    }

    pub fn last(&self) -> u64 {
        self.frames.saturating_sub(1)
    }

    /// `m:ss.cc` (or `h:mm:ss.cc`), as the viewer shows it.
    pub fn time_label(&self, n: u64) -> String {
        time_label(self.time(n))
    }

    pub fn summary(&self) -> String {
        format!(
            "{} × {} · {:.3} fps · {} frame{}",
            self.width,
            self.height,
            self.fps(),
            self.frames,
            if self.frames == 1 { "" } else { "s" }
        )
    }
}

pub fn time_label(seconds: f64) -> String {
    let centis = if seconds.is_finite() {
        (seconds.max(0.0) * 100.0).round() as u64
    } else {
        0
    };
    let (h, m, s, c) = (
        centis / 360_000,
        centis / 6_000 % 60,
        centis / 100 % 60,
        centis % 100,
    );
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{c:02}")
    } else {
        format!("{m}:{s:02}.{c:02}")
    }
}

/// Reads the first video stream. `ffprobe` is the program path. Packet counting is only used when the container does
/// not state `nb_frames`; it reads packets, never decodes pictures.
pub fn probe(ffprobe: &Path, input: &Path) -> Result<VideoInfo, String> {
    let json = run_probe(
        ffprobe,
        &[
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration",
            "-of",
            "json",
        ],
        input,
    )?;
    let value: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("Could not read the video's details: {e}"))?;
    let streams = value["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("This file has no video track")?;
    let width = number(video, "width") as u32;
    let height = number(video, "height") as u32;
    if width == 0 || height == 0 {
        return Err("This video's size could not be read".into());
    }
    let (fps_num, fps_den) = rate(
        video["r_frame_rate"]
            .as_str()
            .or_else(|| video["avg_frame_rate"].as_str())
            .unwrap_or(""),
    )
    .ok_or("This video's frame rate could not be read")?;
    let has_audio = streams
        .iter()
        .any(|s| s["codec_type"].as_str() == Some("audio"));
    let mut frames = number(video, "nb_frames");
    if frames == 0 {
        frames = count_packets(ffprobe, input)?;
    }
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            video["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
        })
        .filter(|d| d.is_finite() && *d > 0.0)
        .unwrap_or_else(|| {
            if fps_num > 0 {
                frames as f64 * f64::from(fps_den) / f64::from(fps_num)
            } else {
                0.0
            }
        });
    if frames == 0 {
        frames = (duration * f64::from(fps_num) / f64::from(fps_den))
            .round()
            .max(1.0) as u64;
    }
    Ok(VideoInfo {
        width,
        height,
        fps_num,
        fps_den,
        frames,
        duration,
        has_audio,
    })
}

fn run_probe(ffprobe: &Path, args: &[&str], input: &Path) -> Result<String, String> {
    let mut all: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
    all.push(input.to_string_lossy().into_owned());
    let (out, _) = process::capture(
        ProcessSpec {
            program: ffprobe.to_path_buf(),
            args: all,
            low_priority: true,
            ..Default::default()
        },
        Duration::from_secs(120),
    )?;
    Ok(out)
}

fn count_packets(ffprobe: &Path, input: &Path) -> Result<u64, String> {
    let json = run_probe(
        ffprobe,
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_packets",
            "-show_entries",
            "stream=nb_read_packets",
            "-of",
            "json",
        ],
        input,
    )?;
    let value: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    Ok(value["streams"][0]["nb_read_packets"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| value["streams"][0]["nb_read_packets"].as_u64())
        .unwrap_or(0))
}

fn number(value: &serde_json::Value, key: &str) -> u64 {
    value[key]
        .as_u64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse::<u64>().ok()))
        .unwrap_or(0)
}

fn rate(text: &str) -> Option<(u32, u32)> {
    let (num, den) = text.split_once('/')?;
    let num: u32 = num.parse().ok()?;
    let den: u32 = den.parse().ok()?;
    (num > 0 && den > 0).then_some((num, den))
}

/* ===== access and identity ===== */

/// The backend only reads a file inside one of these roots (the Halation folder, a linked Library folder) or one the
/// user chose in the picker / dropped on the page (`picked`).
pub fn allowed(input: &Path, roots: &[PathBuf], picked: bool) -> bool {
    picked || roots.iter().any(|root| inside(root, input))
}

pub fn inside(root: &Path, path: &Path) -> bool {
    let (Ok(root), Ok(path)) = (root.canonicalize(), path.canonicalize()) else {
        return false;
    };
    path.starts_with(root)
}

/// FNV-1a over the size and three 64 KiB samples (start, middle, end), so a copy elsewhere reuses the same cache.
pub fn content_key(input: &Path) -> Result<String, String> {
    let mut file = fs::File::open(input).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    hash = fnv(hash, &size.to_le_bytes());
    let starts = [0, size / 2, size.saturating_sub(SAMPLE_BYTES)];
    let mut buffer = vec![0_u8; SAMPLE_BYTES as usize];
    for start in starts {
        if start >= size {
            continue;
        }
        let want = (size - start).min(SAMPLE_BYTES) as usize;
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut buffer[..want])
            .map_err(|e| e.to_string())?;
        hash = fnv(hash, &buffer[..want]);
    }
    Ok(format!("{hash:016x}"))
}

fn fnv(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/* ===== layouts and crop ===== */

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Layout {
    #[default]
    Widescreen,
    Portrait,
    Square,
    FourFive,
    Original,
}

impl Layout {
    pub const ALL: [Layout; 5] = [
        Layout::Widescreen,
        Layout::Portrait,
        Layout::Square,
        Layout::FourFive,
        Layout::Original,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Widescreen => "16:9",
            Self::Portrait => "9:16",
            Self::Square => "1:1",
            Self::FourFive => "4:5",
            Self::Original => "original",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Widescreen => "16:9",
            Self::Portrait => "9:16",
            Self::Square => "1:1",
            Self::FourFive => "4:5",
            Self::Original => "Original",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|layout| layout.id() == id)
    }

    pub fn ratio(self) -> Option<(u32, u32)> {
        match self {
            Self::Widescreen => Some((16, 9)),
            Self::Portrait => Some((9, 16)),
            Self::Square => Some((1, 1)),
            Self::FourFive => Some((4, 5)),
            Self::Original => None,
        }
    }
}

/// The crop as fractions of the video (0..1), so it survives scrubbing and resizing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Crop {
    pub const FULL: Crop = Crop {
        x: 0.0,
        y: 0.0,
        w: 1.0,
        h: 1.0,
    };

    pub fn is_full(self) -> bool {
        self.x <= 0.0001 && self.y <= 0.0001 && self.w >= 0.9999 && self.h >= 0.9999
    }

    /// Keeps the crop inside the video; fractions are clamped to a sane size.
    pub fn clamped(mut self) -> Crop {
        self.w = self.w.clamp(0.02, 1.0);
        self.h = self.h.clamp(0.02, 1.0);
        self.x = self.x.clamp(0.0, 1.0 - self.w);
        self.y = self.y.clamp(0.0, 1.0 - self.h);
        self
    }
}

/// The largest exact-ratio crop, centred; the whole frame when the video already has the layout's shape.
pub fn default_crop(info: &VideoInfo, layout: Layout) -> Crop {
    let Some((rw, rh)) = layout.ratio() else {
        return Crop::FULL;
    };
    let video = f64::from(info.width) / f64::from(info.height.max(1));
    let target = f64::from(rw) / f64::from(rh);
    if (video - target).abs() < 0.01 {
        return Crop::FULL;
    }
    if target > video {
        // Wider than the video: full width, less height
        let h = video / target;
        Crop {
            x: 0.0,
            y: (1.0 - h) / 2.0,
            w: 1.0,
            h,
        }
    } else {
        let w = target / video;
        Crop {
            x: (1.0 - w) / 2.0,
            y: 0.0,
            w,
            h: 1.0,
        }
    }
}

/// Moves the crop by fractions of the video, keeping it inside.
pub fn move_crop(crop: Crop, dx: f64, dy: f64) -> Crop {
    Crop {
        x: crop.x + dx,
        y: crop.y + dy,
        ..crop
    }
    .clamped()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelCrop {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl PixelCrop {
    pub fn is_full(self, info: &VideoInfo) -> bool {
        self.x == 0 && self.y == 0 && self.w == info.width && self.h == info.height
    }
}

/// Rounds a fractional crop to pixels. Sizes and offsets are even for 4:2:0 sources; the crop never leaves the frame.
pub fn pixel_crop(info: &VideoInfo, crop: Crop) -> PixelCrop {
    let crop = crop.clamped();
    let mut w = ((crop.w * f64::from(info.width)).round() as u32).max(2);
    let mut h = ((crop.h * f64::from(info.height)).round() as u32).max(2);
    w = (w.min(info.width) / 2 * 2).max(2);
    h = (h.min(info.height) / 2 * 2).max(2);
    let mut x =
        ((crop.x * f64::from(info.width)).round() as u32 / 2 * 2).min(info.width.saturating_sub(w));
    let mut y = ((crop.y * f64::from(info.height)).round() as u32 / 2 * 2)
        .min(info.height.saturating_sub(h));
    if x + w > info.width {
        x = info.width.saturating_sub(w);
    }
    if y + h > info.height {
        y = info.height.saturating_sub(h);
    }
    PixelCrop { x, y, w, h }
}

/* ===== decoding ===== */

/// One decoded picture, RGBA, row-major.
#[derive(Debug, Clone)]
pub struct RawFrame {
    pub index: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl RawFrame {
    pub fn bytes(&self) -> usize {
        self.rgba.len()
    }
}

/// A video's preview size, fitted inside `max_width` and never enlarged.
pub fn fit_size(width: u32, height: u32, max_width: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (2, 2);
    }
    if max_width == 0 || width <= max_width {
        return (width, height);
    }
    let fitted_width = (max_width / 2 * 2).max(2);
    let fitted_height =
        ((f64::from(height) * f64::from(fitted_width) / f64::from(width)).round() as u32 / 2 * 2)
            .max(2);
    (fitted_width, fitted_height)
}

/// The seek used before `-i`: a quarter frame before `n`, as the Tauri viewer does, so `-frames:v 1` lands on it.
pub fn seek_seconds(info: &VideoInfo, n: u64) -> f64 {
    if n == 0 || info.fps_num == 0 {
        0.0
    } else {
        ((n as f64 - 0.25) * f64::from(info.fps_den) / f64::from(info.fps_num)).max(0.0)
    }
}

/// The job that owns the process, the FFmpeg binary and the clip being read: what every decode needs besides frame
/// positions and output paths.
#[derive(Clone, Copy)]
pub struct DecodeSource<'a> {
    pub context: &'a TaskContext,
    pub ffmpeg: &'a Path,
    pub input: &'a Path,
    pub info: &'a VideoInfo,
}

/// Decodes `count` frames from `from` at a preview width (`max_width == 0` keeps the native size), writing the raw
/// RGBA stream to `raw`. One FFmpeg process serves the whole window; the process belongs to the job, so cancelling
/// kills it. The temporary file is removed before returning.
pub fn decode_window(
    source: DecodeSource<'_>,
    from: u64,
    count: u32,
    max_width: u32,
    raw: &Path,
) -> Result<Vec<RawFrame>, String> {
    let info = source.info;
    let count = count.min(info.frames.saturating_sub(from) as u32);
    if count == 0 {
        return Ok(Vec::new());
    }
    let (width, height) = if max_width == 0 {
        (info.width, info.height)
    } else {
        fit_size(info.width, info.height, max_width)
    };
    let scale = (max_width > 0 && (width != info.width || height != info.height))
        .then(|| format!("scale={width}:{height}:flags=bilinear"));
    run_decode(&source, from, count, scale.as_deref(), raw)?;
    let bytes = fs::read(raw).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(raw);
    let size = width as usize * height as usize * 4;
    if size == 0 {
        return Ok(Vec::new());
    }
    let frames = bytes.len() / size;
    Ok((0..frames.min(count as usize))
        .map(|i| RawFrame {
            index: from + i as u64,
            width,
            height,
            rgba: bytes[i * size..(i + 1) * size].to_vec(),
        })
        .collect())
}

/// One exact preview frame; the last frame falls back to `n - 1` when the seek lands past the end.
pub fn preview_frame(
    source: DecodeSource<'_>,
    n: u64,
    max_width: u32,
    raw: &Path,
) -> Result<RawFrame, String> {
    let info = source.info;
    let n = n.min(info.last());
    let mut frames = decode_window(source, n, 1, max_width, raw)?;
    if frames.is_empty() && n > 0 {
        frames = decode_window(source, n - 1, 1, max_width, raw)?;
    }
    frames
        .into_iter()
        .next()
        .ok_or_else(|| format!("Frame {} could not be decoded", n + 1))
}

/// The native-resolution PNG of frame `n` with `crop` applied. The picture is encoded in Rust and published
/// atomically; the temporary raw file never becomes the output.
pub fn capture_png(
    source: DecodeSource<'_>,
    n: u64,
    crop: Crop,
    output: &Path,
    raw: &Path,
) -> Result<(u32, u32), String> {
    let n = n.min(source.info.last());
    let mut result = capture_once(&source, n, crop, output, raw)?;
    if result.is_none() && n > 0 {
        result = capture_once(&source, n - 1, crop, output, raw)?;
    }
    result.ok_or_else(|| format!("Frame {} could not be decoded", n + 1))
}

fn capture_once(
    source: &DecodeSource<'_>,
    n: u64,
    crop: Crop,
    output: &Path,
    raw: &Path,
) -> Result<Option<(u32, u32)>, String> {
    let info = source.info;
    let pixel = pixel_crop(info, crop);
    let filter = (!pixel.is_full(info))
        .then(|| format!("crop={}:{}:{}:{}", pixel.w, pixel.h, pixel.x, pixel.y));
    run_decode(source, n, 1, filter.as_deref(), raw)?;
    let bytes = fs::read(raw).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(raw);
    let size = pixel.w as usize * pixel.h as usize * 4;
    if size == 0 || bytes.len() < size {
        return Ok(None);
    }
    let image = image::RgbaImage::from_raw(pixel.w, pixel.h, bytes[..size].to_vec())
        .ok_or("The decoded frame has an unexpected size")?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("Could not encode the PNG: {e}"))?;
    atomic_file::write_atomic(output, &png).map_err(|e| e.to_string())?;
    Ok(Some((pixel.w, pixel.h)))
}

fn run_decode(
    source: &DecodeSource<'_>,
    from: u64,
    count: u32,
    filter: Option<&str>,
    raw: &Path,
) -> Result<(), String> {
    let DecodeSource {
        context,
        ffmpeg,
        input,
        info,
    } = *source;
    if let Some(parent) = raw.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut args: Vec<String> = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
    ]
    .map(String::from)
    .into();
    let seek = seek_seconds(info, from);
    if seek > 0.0 {
        args.extend(["-ss".into(), format!("{seek:.6}")]);
    }
    args.extend([
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-an".into(),
        "-sn".into(),
        "-dn".into(),
        "-frames:v".into(),
        count.to_string(),
        "-fps_mode".into(),
        "passthrough".into(),
    ]);
    if let Some(filter) = filter {
        args.extend(["-vf".into(), filter.to_owned()]);
    }
    args.extend([
        "-pix_fmt".into(),
        "rgba".into(),
        "-f".into(),
        "rawvideo".into(),
        raw.to_string_lossy().into_owned(),
    ]);
    context.run_process(
        ProcessSpec {
            program: ffmpeg.to_path_buf(),
            args,
            low_priority: true,
            ..Default::default()
        },
        0.0,
    )
}

/* ===== keyframes ===== */

/// Frame indices of the video's keyframes, from packet flags (stream copy: nothing is decoded). The first frame is
/// always present.
pub fn keyframes(ffprobe: &Path, input: &Path, info: &VideoInfo) -> Result<Vec<u64>, String> {
    let json = run_probe(
        ffprobe,
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "packet=pts_time,flags",
            "-of",
            "json",
        ],
        input,
    )?;
    let value: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    let mut frames: Vec<u64> = value["packets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["flags"].as_str().is_some_and(|f| f.contains('K')))
        .filter_map(|p| {
            p["pts_time"]
                .as_str()
                .and_then(|t| t.parse::<f64>().ok())
                .filter(|t| t.is_finite())
                .map(|t| info.frame_at(t))
        })
        .collect();
    frames.push(0);
    frames.sort_unstable();
    frames.dedup();
    Ok(frames)
}

/// A keyframe strip image (RGBA) aligned with the timeline: each sampled keyframe sits at its time's position.
#[derive(Debug, Clone)]
pub struct Strip {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Decodes only keyframes (`-skip_frame nokey`) in one pass and composites up to [`MAX_KEYFRAMES`] thumbnails.
pub fn keyframe_strip(
    context: &TaskContext,
    ffmpeg: &Path,
    input: &Path,
    info: &VideoInfo,
    keys: &[u64],
    raw: &Path,
) -> Result<Option<Strip>, String> {
    if keys.is_empty() {
        return Ok(None);
    }
    let step = keys.len().div_ceil(MAX_KEYFRAMES).max(1);
    let sampled = keys.len().div_ceil(step);
    let (width, height) = fit_size(info.width, info.height, KEY_WIDTH);
    let select = (step > 1).then(|| format!("select='not(mod(n,{step}))',"));
    let filter = format!(
        "{}scale={width}:{height}:flags=bilinear",
        select.unwrap_or_default()
    );
    if let Some(parent) = raw.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let args = vec![
        "-hide_banner".to_owned(),
        "-nostdin".to_owned(),
        "-y".to_owned(),
        "-v".to_owned(),
        "error".to_owned(),
        "-skip_frame".to_owned(),
        "nokey".to_owned(),
        "-i".to_owned(),
        input.to_string_lossy().into_owned(),
        "-map".to_owned(),
        "0:v:0".to_owned(),
        "-an".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-frames:v".to_owned(),
        sampled.to_string(),
        "-fps_mode".to_owned(),
        "passthrough".to_owned(),
        "-vf".to_owned(),
        filter,
        "-pix_fmt".to_owned(),
        "rgba".to_owned(),
        "-f".to_owned(),
        "rawvideo".to_owned(),
        raw.to_string_lossy().into_owned(),
    ];
    context.run_process(
        ProcessSpec {
            program: ffmpeg.to_path_buf(),
            args,
            low_priority: true,
            ..Default::default()
        },
        0.0,
    )?;
    let bytes = fs::read(raw).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(raw);
    let size = width as usize * height as usize * 4;
    if size == 0 {
        return Ok(None);
    }
    let decoded = (bytes.len() / size).min(sampled);
    if decoded == 0 {
        return Ok(None);
    }
    let mut canvas =
        image::RgbaImage::from_pixel(STRIP_WIDTH, height, image::Rgba([10, 10, 11, 255]));
    for i in 0..decoded {
        let thumb =
            image::RgbaImage::from_raw(width, height, bytes[i * size..(i + 1) * size].to_vec())
                .ok_or("A keyframe thumbnail has an unexpected size")?;
        let key = keys[(i * step).min(keys.len() - 1)];
        let x = if info.duration > 0.0 {
            ((info.time(key) / info.duration) * f64::from(STRIP_WIDTH - width)).round()
        } else {
            (i as f64 / decoded.max(2) as f64 * f64::from(STRIP_WIDTH - width)).round()
        };
        let x = (x as i64).clamp(0, i64::from(STRIP_WIDTH - width)) as i64;
        image::imageops::replace(&mut canvas, &thumb, x, 0);
    }
    Ok(Some(Strip {
        width: canvas.width(),
        height: canvas.height(),
        rgba: canvas.into_raw(),
    }))
}

/* ===== sharpness ===== */

/// Variance of the Laplacian of luma: the Tauri viewer's sharpness score.
pub fn laplacian_variance(rgba: &[u8], width: u32, height: u32) -> f64 {
    let (w, h) = (width as usize, height as usize);
    if w < 3 || h < 3 || rgba.len() < w * h * 4 {
        return 0.0;
    }
    let luma = |x: usize, y: usize| {
        let i = (y * w + x) * 4;
        0.299 * f32::from(rgba[i]) + 0.587 * f32::from(rgba[i + 1]) + 0.114 * f32::from(rgba[i + 2])
    };
    let mut sum = 0.0_f64;
    let mut sum2 = 0.0_f64;
    let mut count = 0_u64;
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let value = f64::from(
                4.0 * luma(x, y)
                    - luma(x - 1, y)
                    - luma(x + 1, y)
                    - luma(x, y - 1)
                    - luma(x, y + 1),
            );
            sum += value;
            sum2 += value * value;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    let mean = sum / count as f64;
    (sum2 / count as f64 - mean * mean).max(0.0)
}

/// The frame with the highest Laplacian variance within ±[`SHARP_RADIUS`] of `center`. The position is not changed.
pub fn sharpest_near(source: DecodeSource<'_>, center: u64, raw: &Path) -> Result<u64, String> {
    let info = source.info;
    let from = center.saturating_sub(SHARP_RADIUS);
    let count = (SHARP_RADIUS * 2 + 1).min(info.frames.saturating_sub(from)) as u32;
    let frames = decode_window(source, from, count, SHARP_WIDTH, raw)?;
    frames
        .into_iter()
        .max_by(|a, b| {
            laplacian_variance(&a.rgba, a.width, a.height)
                .partial_cmp(&laplacian_variance(&b.rgba, b.width, b.height))
                .unwrap_or(std::cmp::Ordering::Equal)
                // A tie goes to the frame nearest the playhead
                .then_with(|| {
                    let da = a.index.abs_diff(center);
                    let db = b.index.abs_diff(center);
                    db.cmp(&da)
                })
        })
        .map(|frame| frame.index)
        .ok_or_else(|| "No frame could be analysed".into())
}

/* ===== cache ===== */

/// A byte-bounded cache of decoded preview frames; the frame farthest from the playhead is dropped first.
#[derive(Debug)]
pub struct FrameCache {
    budget: usize,
    bytes: usize,
    frames: HashMap<u64, RawFrame>,
}

impl FrameCache {
    pub fn new(budget: usize) -> Self {
        Self {
            budget,
            bytes: 0,
            frames: HashMap::new(),
        }
    }

    pub fn get(&self, n: u64) -> Option<&RawFrame> {
        self.frames.get(&n)
    }

    pub fn insert(&mut self, frame: RawFrame, center: u64) {
        let bytes = frame.bytes();
        if bytes > self.budget {
            return;
        }
        if let Some(old) = self.frames.insert(frame.index, frame) {
            self.bytes = self.bytes.saturating_sub(old.bytes());
        }
        self.bytes += bytes;
        while self.bytes > self.budget {
            let farthest = self
                .frames
                .keys()
                .max_by_key(|n| n.abs_diff(center))
                .copied();
            let Some(farthest) = farthest else {
                break;
            };
            if let Some(frame) = self.frames.remove(&farthest) {
                self.bytes = self.bytes.saturating_sub(frame.bytes());
            }
        }
    }

    pub fn clear(&mut self) {
        self.frames.clear();
        self.bytes = 0;
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

/* ===== queue ===== */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueuedFrame {
    pub n: u64,
    #[serde(default = "selected_by_default")]
    pub selected: bool,
}

fn selected_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddOutcome {
    Added,
    Selected,
    Full,
}

/// At most [`QUEUE_MAX`] frames, in time order; adding a frame already present only selects it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Queue {
    items: Vec<QueuedFrame>,
}

impl Queue {
    pub fn items(&self) -> &[QueuedFrame] {
        &self.items
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn selected(&self) -> Vec<u64> {
        self.items
            .iter()
            .filter(|item| item.selected)
            .map(|item| item.n)
            .collect()
    }

    pub fn add(&mut self, n: u64) -> AddOutcome {
        if let Some(item) = self.items.iter_mut().find(|item| item.n == n) {
            item.selected = true;
            return AddOutcome::Selected;
        }
        if self.items.len() >= QUEUE_MAX {
            return AddOutcome::Full;
        }
        self.items.push(QueuedFrame { n, selected: true });
        self.items.sort_by_key(|item| item.n);
        AddOutcome::Added
    }

    pub fn remove(&mut self, n: u64) -> bool {
        let before = self.items.len();
        self.items.retain(|item| item.n != n);
        self.items.len() != before
    }

    pub fn toggle(&mut self, n: u64) -> bool {
        if let Some(item) = self.items.iter_mut().find(|item| item.n == n) {
            item.selected = !item.selected;
            return true;
        }
        false
    }

    pub fn set_all(&mut self, selected: bool) {
        for item in &mut self.items {
            item.selected = selected;
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn restore(&mut self, items: Vec<QueuedFrame>) {
        self.items = items;
        self.items.truncate(QUEUE_MAX);
        self.items.sort_by_key(|item| item.n);
        self.items.dedup_by_key(|item| item.n);
    }
}

/// `{stem} - frame {n+1}.png`, the Tauri viewer's naming.
pub fn capture_name(input: &Path, n: u64) -> String {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".into());
    format!("{} - frame {}.png", names::file_stem(&stem), n + 1)
}

/* ===== destinations and session ===== */

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Destination {
    #[default]
    Library,
    Image,
}

impl Destination {
    pub const ALL: [Destination; 2] = [Destination::Library, Destination::Image];

    pub fn id(self) -> &'static str {
        match self {
            Self::Library => "library",
            Self::Image => "image",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Image => "Image",
        }
    }

    pub fn detail(self) -> &'static str {
        match self {
            Self::Library => "Saved in Library\\Frames.",
            Self::Image => "A PNG through the save location policy.",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.id() == id)
    }
}

/// What survives a restart: the video reference, the frame, sound, layout, crops, destination and queue. Decoded
/// pictures and results are not stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Session {
    pub video: Option<PathBuf>,
    /// The user chose this file (picker or drop); it stays authorized after a restart.
    pub picked: bool,
    pub n: u64,
    pub volume: f32,
    pub muted: bool,
    pub layout: String,
    pub crops: BTreeMap<String, Crop>,
    pub destination: String,
    pub queue: Vec<QueuedFrame>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            video: None,
            picked: false,
            n: 0,
            volume: 0.8,
            muted: false,
            layout: Layout::Widescreen.id().into(),
            crops: BTreeMap::new(),
            destination: Destination::Library.id().into(),
            queue: Vec::new(),
        }
    }
}

impl Session {
    pub fn read(path: &Path) -> Session {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(self).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::Ffmpeg;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP: AtomicU64 = AtomicU64::new(0);

    fn info(width: u32, height: u32) -> VideoInfo {
        VideoInfo {
            width,
            height,
            fps_num: 30,
            fps_den: 1,
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
        if let Some(found) = std::env::var_os("HALATION_FFMPEG")
            .and_then(|dir| Ffmpeg::in_directory(Path::new(&dir)))
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
            let mut image =
                image::RgbaImage::from_pixel(320, 180, image::Rgba([110, 110, 110, 255]));
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
            move |context| {
                keyframe_strip(&context, &ffmpeg.ffmpeg, &video, &info, &keys, &strip_raw)
            }
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
}
