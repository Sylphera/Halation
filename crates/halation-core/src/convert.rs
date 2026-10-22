//! Media-only adaptation of the Tauri backend's convert.rs. No UI or Tauri types.
//! Detection reads content; the curated table and planner never execute processes.
use crate::{engine::TaskContext, process::ProcessSpec};
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
    process::Command,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Image,
    Animated,
    Audio,
    Video,
    Unsupported,
}

impl Class {
    pub fn label(self) -> &'static str {
        match self {
            Self::Image => "Image",
            Self::Animated => "Animated image",
            Self::Audio => "Audio",
            Self::Video => "Video",
            Self::Unsupported => "Unsupported file",
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct Stream {
    pub index: u32,
    pub kind: String,
    pub codec: String,
    pub cover: bool,
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub rate: u32,
    pub bits: u32,
    pub float: bool,
}

#[derive(Debug, Clone)]
pub struct Source {
    pub class: Class,
    pub format: String,
    pub named: String,
    pub streams: Vec<Stream>,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub alpha: bool,
    pub hdr: bool,
    pub few_colours: bool,
    pub size: u64,
    pub needs_ffmpeg: bool,
}

impl Source {
    pub fn summary(&self) -> String {
        let mut parts = vec![self.class.label().to_owned(), self.format.to_uppercase()];
        if self.width > 0 {
            parts.push(format!("{} × {}", self.width, self.height));
        }
        if self.duration > 0.0 {
            parts.push(if self.duration < 10.0 {
                format!("{:.1} s", self.duration)
            } else {
                crate::playback::clock(self.duration)
            });
        }
        let codecs = self
            .streams
            .iter()
            .filter(|s| !s.cover && matches!(s.kind.as_str(), "video" | "audio"))
            .map(|s| s.codec.to_uppercase())
            .collect::<Vec<_>>();
        if !codecs.is_empty() {
            parts.push(codecs.join(" + "));
        }
        if !self.named.is_empty() && self.named != self.format {
            parts.push(format!("named .{}", self.named));
        }
        parts.join(" · ")
    }
}

fn canonical(ext: &str) -> &str {
    match ext {
        "jpeg" | "jpe" => "jpg",
        "tif" => "tiff",
        "aif" => "aiff",
        "oga" => "ogg",
        "m4v" => "mp4",
        e => e,
    }
}

pub(crate) fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

pub fn decode(path: &Path) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    let mut reader = ImageReader::open(path).map_err(|e| e.to_string())?;
    let tga = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("tga"));
    if !tga {
        reader.clear_format();
    }
    // TGA's extension is a fallback only: a recognizable signature must still win over it.
    reader = reader.with_guessed_format().map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let icc = decoder.icc_profile().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    Ok((image, icc))
}

pub fn probe(path: &Path, ffprobe: Option<&Path>) -> Result<Source, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Select a local file".into());
    }
    let named = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    let named = canonical(&named).to_owned();
    let mut source = Source {
        class: Class::Unsupported,
        format: named.clone(),
        named,
        streams: vec![],
        duration: 0.0,
        width: 0,
        height: 0,
        alpha: false,
        hdr: false,
        few_colours: false,
        size: metadata.len(),
        needs_ffmpeg: false,
    };
    let mut head = [0; 64];
    let length = fs::File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .map_err(|e| e.to_string())?;
    let format = image::guess_format(&head[..length])
        .ok()
        .or_else(|| (source.named == "tga").then_some(ImageFormat::Tga));
    if let Some(format) = format {
        source.format = canonical(format.extensions_str()[0]).into();
        source.class = Class::Image;
        if format == ImageFormat::Avif {
            if let Some(bin) = ffprobe {
                let json = inspect(bin, path)?;
                source = from_ffprobe(&json, source);
                source.class = Class::Image;
                source.format = "avif".into();
            } else {
                source.needs_ffmpeg = true;
            }
            return Ok(source);
        }
        if format == ImageFormat::Gif {
            use image::AnimationDecoder;
            let mut decoder = image::codecs::gif::GifDecoder::new(BufReader::new(
                fs::File::open(path).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
            decoder
                .set_limits(image_limits())
                .map_err(|e| e.to_string())?;
            (source.width, source.height) = decoder.dimensions();
            if source.width > 16_384 || source.height > 16_384 {
                return Err("Image exceeds the 16384 px limit".into());
            }
            let frames = decoder
                .into_frames()
                .take(2)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if frames.len() > 1 {
                source.class = Class::Animated;
                source.alpha = true;
                return Ok(source);
            }
        }
        if format == ImageFormat::WebP {
            let mut decoder = image::codecs::webp::WebPDecoder::new(BufReader::new(
                fs::File::open(path).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
            decoder
                .set_limits(image_limits())
                .map_err(|e| e.to_string())?;
            if decoder.has_animation() {
                source.class = Class::Animated;
                (source.width, source.height) = decoder.dimensions();
                source.alpha = decoder.color_type().has_alpha();
                return Ok(source);
            }
        }
        let (image, _) = decode(path)?;
        (source.width, source.height) = (image.width(), image.height());
        let rgba = image.to_rgba8();
        source.alpha = rgba.pixels().any(|p| p[3] < 255);
        if format == ImageFormat::Png {
            let mut colours = HashSet::new();
            source.few_colours = rgba.pixels().all(|p| {
                colours.insert(p.0);
                colours.len() <= 256
            });
        }
        return Ok(source);
    }
    // HEIC is deliberately outside v1; do not misclassify it as video.
    if length >= 12
        && &head[4..8] == b"ftyp"
        && head[..length]
            .windows(4)
            .any(|b| matches!(b, b"heic" | b"heix" | b"mif1"))
    {
        source.format = "heic".into();
        return Ok(source);
    }
    if let Some(bin) = ffprobe {
        let json = inspect(bin, path)?;
        source = from_ffprobe(&json, source);
    } else {
        source.class = match source.named.as_str() {
            "mp3" | "m4a" | "aac" | "flac" | "wav" | "ogg" | "opus" | "aiff" | "wma" | "ape" => {
                Class::Audio
            }
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "wmv" | "ts" | "mts" | "mpg" | "mpeg"
            | "flv" | "3gp" => Class::Video,
            _ => Class::Unsupported,
        };
        source.needs_ffmpeg = matches!(source.class, Class::Audio | Class::Video);
    }
    Ok(source)
}

fn inspect(bin: &Path, input: &Path) -> Result<Value, String> {
    let mut arguments = args(&[
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
    ]);
    arguments.push(input.to_string_lossy().into_owned());
    let (out, _) = crate::process::capture(
        ProcessSpec {
            program: bin.to_owned(),
            args: arguments,
            ..Default::default()
        },
        std::time::Duration::from_secs(30),
    )?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

fn number(value: &Value, key: &str) -> u32 {
    value[key]
        .as_u64()
        .or_else(|| value[key].as_str()?.parse().ok())
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

fn from_ffprobe(value: &Value, mut source: Source) -> Source {
    source.streams = value["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| {
            let sample = text(s, "sample_fmt");
            Stream {
                index: number(s, "index"),
                kind: text(s, "codec_type").into(),
                codec: text(s, "codec_name").into(),
                cover: number(&s["disposition"], "attached_pic") == 1,
                width: number(s, "width"),
                height: number(s, "height"),
                channels: number(s, "channels"),
                rate: number(s, "sample_rate"),
                bits: number(s, "bits_per_raw_sample").max(number(s, "bits_per_sample")),
                float: sample.starts_with("flt") || sample.starts_with("dbl"),
            }
        })
        .collect();
    let video = source
        .streams
        .iter()
        .find(|s| s.kind == "video" && !s.cover);
    source.class = if let Some(video) = video {
        (source.width, source.height) = (video.width, video.height);
        Class::Video
    } else if source.streams.iter().any(|s| s.kind == "audio") {
        Class::Audio
    } else {
        Class::Unsupported
    };
    let format = text(&value["format"], "format_name");
    source.format = match format.split(',').next().unwrap_or("") {
        "matroska" => {
            if source.named == "webm" {
                "webm"
            } else {
                "mkv"
            }
        }
        "mov" => {
            if source.class == Class::Audio {
                "m4a"
            } else if source.named == "mov" {
                "mov"
            } else {
                "mp4"
            }
        }
        "ogg" if source.streams.iter().any(|s| s.codec == "opus") => "opus",
        "mpegts" => "ts",
        f => f,
    }
    .into();
    source.duration = text(&value["format"], "duration")
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(0.0);
    if let Some(s) = value["streams"].as_array().and_then(|a| {
        a.iter().find(|s| {
            text(s, "codec_type") == "video" && number(&s["disposition"], "attached_pic") == 0
        })
    }) {
        source.hdr = matches!(text(s, "color_transfer"), "smpte2084" | "arib-std-b67");
        let pix = text(s, "pix_fmt");
        source.alpha = pix.contains("rgba") || pix.starts_with("yuva") || pix.starts_with("gbrap");
    }
    source
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub target: &'static str,
    pub args: Vec<String>,
    pub notes: Vec<&'static str>,
    pub copy: bool,
    pub image: bool,
    pub needs: Vec<&'static str>,
    pub weight: u8,
}

impl Plan {
    pub fn description(&self) -> &'static str {
        if self.copy {
            return "Copies streams · no quality loss";
        }
        match self.target {
            "png" => "Lossless · preserves transparency",
            "jpg" => "Lossy · quality 90 · plays everywhere",
            "webp" => "Compact · quality 90 · supports transparency",
            "tiff" => "Lossless · preserves colour depth",
            "bmp" => "Uncompressed · large files",
            "ico" => "Icon · 16, 32, 48 and 256 px",
            "gif" => "256 colours · supports animation",
            "mp4" | "mov" => "H.264 + AAC · high quality",
            "mkv" => "Flexible container · keeps compatible streams",
            "webm" => "VP9 + Opus · for the web",
            "mp3" => "Lossy · VBR about 245 kbps · plays everywhere",
            "m4a" => "AAC · 256 kbps · compact audio",
            "flac" => "Lossless · compressed audio",
            "wav" | "aiff" => "Uncompressed · preserves source depth",
            "ogg" => "Vorbis · quality 6",
            "opus" => "Opus · 160 kbps · 48 kHz",
            _ => "",
        }
    }
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| (*s).to_owned()).collect()
}

pub fn targets(source: &Source, encoders: Option<&HashSet<String>>) -> Vec<Plan> {
    let table: &[&str] = match source.class {
        Class::Image => &["png", "jpg", "webp", "tiff", "bmp", "ico", "gif"],
        Class::Animated if source.format == "webp" => &["gif", "png"],
        Class::Animated => &["mp4", "webm", "webp", "png"],
        Class::Audio => &["mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff"],
        Class::Video => &[
            "mp4", "mkv", "webm", "mov", "gif", "mp3", "m4a", "flac", "wav", "opus",
        ],
        Class::Unsupported => &[],
    };
    let mut plans: Vec<_> = table
        .iter()
        .filter(|t| **t != source.format)
        .filter_map(|t| plan(source, t))
        .filter(|p| encoders.is_none_or(|e| p.needs.iter().all(|n| e.contains(*n))))
        .collect();
    // Preserve curated order within the two partitions; prefer a lossless remux when possible.
    if let Some(index) = plans.iter().position(|p| p.copy && !is_audio(p.target)) {
        let p = plans.remove(index);
        plans.insert(0, p);
    }
    plans
}

fn is_audio(target: &str) -> bool {
    matches!(
        target,
        "mp3" | "m4a" | "flac" | "wav" | "ogg" | "opus" | "aiff"
    )
}

fn audio_codec(
    target: &str,
    stream: &Stream,
    index: usize,
    in_video: bool,
) -> (Vec<String>, bool, &'static str) {
    let codec = stream.codec.as_str();
    let fits = if in_video {
        match target {
            "mkv" => true,
            "webm" => matches!(codec, "vorbis" | "opus"),
            "mov" => matches!(
                codec,
                "aac"
                    | "mp3"
                    | "ac3"
                    | "alac"
                    | "pcm_s16le"
                    | "pcm_s24le"
                    | "pcm_s16be"
                    | "pcm_s24be"
            ),
            _ => matches!(codec, "aac" | "mp3" | "ac3" | "eac3" | "alac"),
        }
    } else {
        match target {
            "mp3" => codec == "mp3",
            "m4a" => matches!(codec, "aac" | "alac"),
            "flac" => codec == "flac",
            "wav" => codec.starts_with("pcm_") && codec.ends_with("le"),
            "aiff" => codec.starts_with("pcm_") && codec.ends_with("be"),
            "ogg" => codec == "vorbis",
            "opus" => codec == "opus",
            _ => false,
        }
    };
    let flag = |s: &str| format!("-{s}:a:{index}");
    if fits {
        return (vec![flag("c"), "copy".into()], true, "");
    }
    let target = if in_video {
        if target == "webm" { "opus" } else { "m4a" }
    } else {
        target
    };
    let deep = !matches!(
        codec,
        "mp3"
            | "aac"
            | "vorbis"
            | "opus"
            | "ac3"
            | "eac3"
            | "wmav1"
            | "wmav2"
            | "wmapro"
            | "mp2"
            | "amr_nb"
            | "amr_wb"
            | "dts"
    ) && (stream.float || stream.bits > 16);
    let (encoder, options) = match target {
        "mp3" => ("libmp3lame", vec![("q", "0")]),
        "m4a" => ("aac", vec![("b", if in_video { "192k" } else { "256k" })]),
        "flac" => (
            "flac",
            vec![("sample_fmt", if deep { "s32" } else { "s16" })],
        ),
        "wav" => (if deep { "pcm_s24le" } else { "pcm_s16le" }, vec![]),
        "aiff" => (if deep { "pcm_s24be" } else { "pcm_s16be" }, vec![]),
        "ogg" => ("libvorbis", vec![("q", "6")]),
        "opus" => ("libopus", vec![("b", "160k"), ("ar", "48000")]),
        _ => ("aac", vec![]),
    };
    let mut result = vec![flag("c"), encoder.into()];
    for (key, value) in options {
        result.extend([flag(key), value.into()]);
    }
    if target == "mp3" && stream.rate > 48000 {
        result.extend([flag("ar"), "48000".into()]);
    }
    if target == "mp3" && stream.channels > 2 {
        result.extend([flag("ac"), "2".into()]);
    }
    if target == "opus" && stream.channels > 2 {
        result.extend(args(&["-mapping_family", "1"]));
    }
    if target == "flac" {
        result.extend(args(&["-compression_level", "5"]));
        if deep {
            result.extend(args(&["-bits_per_raw_sample", "24"]));
        }
    }
    (result, false, encoder)
}

pub fn plan(source: &Source, target: &'static str) -> Option<Plan> {
    if source.class == Class::Unsupported {
        return None;
    }
    let mut p = Plan {
        target,
        args: vec![],
        notes: vec![],
        copy: false,
        image: false,
        needs: vec![],
        weight: 0,
    };
    if source.class == Class::Image
        || source.class == Class::Animated && matches!(target, "png" | "gif")
    {
        if !["png", "jpg", "webp", "tiff", "bmp", "ico", "gif"].contains(&target) {
            return None;
        }
        p.image = true;
        if source.alpha && target == "jpg" {
            p.notes.push("Transparency becomes white");
        }
        if source.class == Class::Animated && target == "png" {
            p.notes.push("Only the first frame");
        }
        return Some(p);
    }
    let audios: Vec<_> = source
        .streams
        .iter()
        .filter(|s| s.kind == "audio")
        .collect();
    if is_audio(target) {
        let stream = audios.first()?;
        p.args
            .extend(["-map".into(), format!("0:{}", stream.index)]);
        let (codec, copied, need) = audio_codec(target, stream, 0, false);
        p.args.extend(codec);
        p.copy = copied;
        if !need.is_empty() {
            p.needs.push(need);
        }
        if matches!(target, "mp3" | "m4a" | "flac")
            && source.class == Class::Audio
            && let Some(cover) = source
                .streams
                .iter()
                .find(|s| s.cover && matches!(s.codec.as_str(), "mjpeg" | "png"))
        {
            p.args.extend(args(&[
                "-map",
                &format!("0:{}", cover.index),
                "-c:v",
                "copy",
                "-disposition:v:0",
                "attached_pic",
            ]));
        }
        p.args.extend(args(&["-map_metadata", "0"]));
        p.weight = u8::from(!copied);
        p.notes.push(if copied {
            "Copies streams · no quality loss"
        } else {
            "Re-encodes audio"
        });
        if audios.len() > 1 {
            p.notes.push("Only the first audio track");
        }
        if matches!(target, "flac" | "wav" | "aiff")
            && matches!(stream.codec.as_str(), "mp3" | "aac" | "opus" | "vorbis")
        {
            p.notes.push("Won't improve quality");
        }
        return Some(p);
    }
    let video = source
        .streams
        .iter()
        .find(|s| s.kind == "video" && !s.cover);
    let index = video.map_or(0, |s| s.index);
    if target == "gif" {
        p.args = args(&[
            "-filter_complex",
            &format!(
                "[0:{index}]fps=15,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a[out]"
            ),
            "-map",
            "[out]",
            "-an",
            "-loop",
            "0",
        ]);
        p.needs.push("gif");
        p.weight = 2;
        p.notes.push("15 fps · up to 480 px wide");
        if source.duration > 30.0 {
            p.notes.push("Long GIF: output may be very large");
        }
        return Some(p);
    }
    let fits = video.is_some_and(|v| match target {
        "mkv" => true,
        "mp4" => matches!(v.codec.as_str(), "h264" | "hevc" | "av1"),
        "mov" => matches!(v.codec.as_str(), "h264" | "hevc" | "prores" | "mjpeg"),
        "webm" => matches!(v.codec.as_str(), "vp8" | "vp9" | "av1"),
        _ => false,
    });
    p.args.extend(args(&["-map", &format!("0:{index}")]));
    if fits {
        p.args.extend(args(&["-c:v", "copy"]));
    } else {
        match target {
            "mp4" | "mov" => {
                if source.class == Class::Animated {
                    p.args.extend(args(&[
                        "-vf",
                        r"scale=max(2\,trunc(iw/2)*2):max(2\,trunc(ih/2)*2)",
                    ]));
                }
                p.args.extend(args(&[
                    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
                ]));
                p.needs.push("libx264");
            }
            "webm" => {
                p.args.extend(args(&[
                    "-c:v",
                    "libvpx-vp9",
                    "-crf",
                    "31",
                    "-b:v",
                    "0",
                    "-row-mt",
                    "1",
                    "-deadline",
                    "good",
                    "-pix_fmt",
                    if source.alpha { "yuva420p" } else { "yuv420p" },
                ]));
                p.needs.push("libvpx-vp9");
            }
            "webp" if source.class == Class::Animated => {
                p.args.extend(args(&[
                    "-c:v",
                    "libwebp_anim",
                    "-quality",
                    "90",
                    "-loop",
                    "0",
                ]));
                p.needs.push("libwebp_anim");
            }
            _ => return None,
        }
        p.args.extend(args(&["-fps_mode", "passthrough"]));
    }
    let mut audio_copy = true;
    for (k, stream) in audios.iter().enumerate() {
        p.args
            .extend(args(&["-map", &format!("0:{}", stream.index)]));
        let (codec, copied, need) = audio_codec(target, stream, k, true);
        p.args.extend(codec);
        audio_copy &= copied;
        if !need.is_empty() {
            p.needs.push(need);
        }
    }
    let mut subs = 0;
    for s in source.streams.iter().filter(|s| s.kind == "subtitle") {
        if target == "mkv"
            || matches!(
                s.codec.as_str(),
                "subrip" | "srt" | "ass" | "ssa" | "mov_text" | "webvtt" | "text"
            )
        {
            p.args.extend(args(&["-map", &format!("0:{}", s.index)]));
            subs += 1;
        } else {
            p.notes.push("Image subtitles are discarded");
        }
    }
    if subs > 0 {
        let encoder = match target {
            "mp4" | "mov" => "mov_text",
            "webm" => "webvtt",
            _ => "copy",
        };
        p.args.extend(args(&["-c:s", encoder]));
        if encoder != "copy" {
            p.needs.push(encoder);
        }
    }
    if target == "mkv" {
        p.args.extend(args(&["-map", "0:t?", "-c:t", "copy"]));
    }
    p.args
        .extend(args(&["-map_metadata", "0", "-map_chapters", "0"]));
    if matches!(target, "mp4" | "mov") {
        p.args.extend(args(&["-movflags", "+faststart"]));
    }
    if target == "mp4" && video.is_some_and(|v| v.codec == "hevc") {
        p.args.extend(args(&["-tag:v", "hvc1"]));
    }
    p.copy = fits && audio_copy;
    p.weight = if !fits { 2 } else { u8::from(!audio_copy) };
    p.notes.insert(
        0,
        if p.copy {
            "Copies streams · no quality loss"
        } else if fits {
            "Copies video · re-encodes audio"
        } else {
            "Re-encodes video"
        },
    );
    if source.hdr && !fits {
        p.notes.push("HDR source: colors may look flat");
    }
    Some(p)
}

pub fn encoders(bin: &Path) -> Result<HashSet<String>, String> {
    type Cache = Option<(std::path::PathBuf, std::time::SystemTime, HashSet<String>)>;
    static CACHE: std::sync::Mutex<Cache> = std::sync::Mutex::new(None);
    let stamp = fs::metadata(bin)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    if let Some((path, time, encoders)) = CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        && path == bin
        && *time == stamp
    {
        return Ok(encoders.clone());
    }
    let (out, _) = crate::process::capture(
        ProcessSpec {
            program: bin.to_owned(),
            args: args(&["-hide_banner", "-encoders"]),
            ..Default::default()
        },
        std::time::Duration::from_secs(10),
    )?;
    let encoders: HashSet<_> = out
        .lines()
        .skip_while(|l| !l.trim_start().starts_with("---"))
        .skip(1)
        .filter_map(|l| l.split_whitespace().nth(1).map(str::to_owned))
        .collect();
    if encoders.is_empty() {
        return Err("The installed FFmpeg returned no encoders".into());
    }
    *CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some((bin.to_owned(), stamp, encoders.clone()));
    Ok(encoders)
}

fn muxer(target: &str) -> &str {
    match target {
        "mkv" => "matroska",
        "m4a" => "ipod",
        t => t,
    }
}

fn image_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(512 * 1024 * 1024);
    limits
}

/// A unique workspace is supplied by the caller. Only a successful job publishes its staged output.
pub fn execute(
    context: &TaskContext,
    input: &Path,
    output: &Path,
    workspace: &Path,
    source: &Source,
    plan: &Plan,
    ffmpeg: Option<&Path>,
) -> Result<(), String> {
    execute_export(
        context,
        Conversion {
            input,
            output,
            workspace,
            source,
            plan,
            ffmpeg,
            replace_confirmed: false,
        },
    )
}

/// `replace_confirmed` is only for an existing destination confirmed by the native Save dialog.
pub struct Conversion<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    pub workspace: &'a Path,
    pub source: &'a Source,
    pub plan: &'a Plan,
    pub ffmpeg: Option<&'a Path>,
    pub replace_confirmed: bool,
}

pub fn execute_export(context: &TaskContext, request: Conversion<'_>) -> Result<(), String> {
    let Conversion {
        input,
        output,
        workspace,
        source,
        plan,
        ffmpeg,
        replace_confirmed,
    } = request;
    context.check_cancelled()?;
    if input == output
        || fs::canonicalize(input)
            .ok()
            .zip(fs::canonicalize(output).ok())
            .is_some_and(|(a, b)| a == b)
    {
        return Err("The original cannot be replaced".into());
    }
    fs::create_dir_all(workspace).map_err(|e| e.to_string())?;
    let part = workspace.join(format!("output.{}.part", plan.target));
    let decoded = workspace.join("decoded.png");
    let publish = output.with_file_name(format!(
        "{}.{}.part",
        output.file_name().unwrap_or_default().to_string_lossy(),
        workspace.file_name().unwrap_or_default().to_string_lossy()
    ));
    let mut owns_publish = false;
    let result = (|| {
        context.progress(Some(0.0), "Converting");
        if plan.image {
            if source.format == "avif" {
                if source.width == 0
                    || source.height == 0
                    || source.width > 16_384
                    || source.height > 16_384
                    || source.width as u64 * source.height as u64 * 8 > 512 * 1024 * 1024
                {
                    return Err("Image exceeds the decode limits".into());
                }
                context.run_process(
                    ProcessSpec {
                        program: ffmpeg.ok_or("Needs FFmpeg · Install")?.to_owned(),
                        args: args(&[
                            "-hide_banner",
                            "-nostdin",
                            "-n",
                            "-protocol_whitelist",
                            "file,pipe",
                            "-i",
                            &input.to_string_lossy(),
                            "-frames:v",
                            "1",
                            &decoded.to_string_lossy(),
                        ]),
                        low_priority: true,
                        ..Default::default()
                    },
                    0.0,
                )?;
            }
            encode_image(
                if source.format == "avif" {
                    &decoded
                } else {
                    input
                },
                &part,
                source,
                plan,
                context,
            )?;
        } else {
            let mut command = args(&[
                "-hide_banner",
                "-nostdin",
                "-n",
                "-progress",
                "pipe:1",
                "-nostats",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
            ]);
            command.push(input.to_string_lossy().into_owned());
            command.extend(plan.args.clone());
            command.extend(args(&["-f", muxer(plan.target)]));
            command.push(part.to_string_lossy().into_owned());
            context.run_process(
                ProcessSpec {
                    program: ffmpeg.ok_or("Needs FFmpeg · Install")?.to_owned(),
                    args: command,
                    low_priority: true,
                    ..Default::default()
                },
                source.duration,
            )?;
        }
        context.check_cancelled()?;
        // Copy with create_new: no race can replace an original or an unrelated output.
        let mut source_file = fs::File::open(&part).map_err(|e| e.to_string())?;
        let mut destination = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&publish)
            .map_err(|e| e.to_string())?;
        owns_publish = true;
        let mut buffer = vec![0_u8; 256 * 1024];
        loop {
            context.check_cancelled()?;
            let count = source_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            destination
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
        }
        destination.flush().map_err(|e| e.to_string())?;
        drop(destination);
        drop(source_file);
        context.check_cancelled()?;
        context.complete(|| {
            if replace_confirmed {
                fs::rename(&publish, output)
            } else {
                publish_new(&publish, output)
            }
            .map_err(|e| {
                format!("Could not publish output without replacing an existing file: {e}")
            })?;
            // Cleanup precedes the terminal state: observers never see Done with live partial files.
            fs::remove_file(&part).map_err(|e| e.to_string())?;
            if decoded.exists() {
                fs::remove_file(&decoded).map_err(|e| e.to_string())?;
            }
            fs::remove_dir(workspace).map_err(|e| e.to_string())?;
            Ok(())
        })?;
        Ok(())
    })();
    let _ = fs::remove_file(&part);
    let _ = fs::remove_file(&decoded);
    if owns_publish {
        let _ = fs::remove_file(&publish);
    }
    let _ = fs::remove_dir(workspace);
    result
}

#[cfg(windows)]
fn publish_new(source: &Path, target: &Path) -> std::io::Result<()> {
    #[allow(unsafe_code)]
    fn move_file(source: &Path, target: &Path) -> std::io::Result<()> {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: both paths are owned, NUL-terminated UTF-16 buffers live across this call.
        // No REPLACE_EXISTING flag: publication cannot overwrite a path that appeared during encoding.
        if unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0)
        } == 0
        {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    move_file(source, target)
}

#[cfg(not(windows))]
fn publish_new(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::hard_link(source, target)?;
    fs::remove_file(source)
}

fn encode_image(
    input: &Path,
    part: &Path,
    source: &Source,
    plan: &Plan,
    context: &TaskContext,
) -> Result<(), String> {
    use image::codecs::{
        gif::{GifEncoder, Repeat},
        ico::{IcoEncoder, IcoFrame},
        jpeg::JpegEncoder,
        png::PngEncoder,
    };
    if source.class == Class::Animated && plan.target == "gif" {
        use image::AnimationDecoder;
        let mut decoder = image::codecs::webp::WebPDecoder::new(BufReader::new(
            fs::File::open(input).map_err(|e| e.to_string())?,
        ))
        .map_err(|e| e.to_string())?;
        decoder
            .set_limits(image_limits())
            .map_err(|e| e.to_string())?;
        let file = fs::File::create(part).map_err(|e| e.to_string())?;
        let mut encoder = GifEncoder::new(file);
        encoder
            .set_repeat(Repeat::Infinite)
            .map_err(|e| e.to_string())?;
        for frame in decoder.into_frames() {
            context.check_cancelled()?;
            encoder
                .encode_frame(frame.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let (mut image, icc) = decode(input)?;
    context.check_cancelled()?;
    if plan.target == "bmp" && !source.alpha {
        image = DynamicImage::ImageRgb8(image.to_rgb8());
    }
    if plan.target == "jpg" {
        let mut rgb = image.to_rgb8();
        let rgba = image.to_rgba8();
        for (out, pixel) in rgb.pixels_mut().zip(rgba.pixels()) {
            for channel in 0..3 {
                out[channel] = ((pixel[channel] as u32 * pixel[3] as u32
                    + 255 * (255 - pixel[3] as u32)
                    + 127)
                    / 255) as u8;
            }
        }
        image = DynamicImage::ImageRgb8(rgb);
    }
    let mut file = BufWriter::new(fs::File::create(part).map_err(|e| e.to_string())?);
    let result = match plan.target {
        "jpg" => {
            let mut encoder = JpegEncoder::new_with_quality(&mut file, 90);
            if let Some(icc) = icc {
                encoder.set_icc_profile(icc).map_err(|e| e.to_string())?;
            }
            encoder.encode_image(&image)
        }
        "png" => {
            let mut encoder = PngEncoder::new(&mut file);
            if let Some(icc) = icc {
                encoder.set_icc_profile(icc).map_err(|e| e.to_string())?;
            }
            image.write_with_encoder(encoder)
        }
        "tiff" => {
            use tiff::encoder::{Compression, TiffEncoder, colortype};
            let mut encoder = TiffEncoder::new(&mut file)
                .map_err(|e| e.to_string())?
                .with_compression(Compression::Lzw);
            let alpha = image.color().has_alpha();
            let sixteen = image.color().bits_per_pixel() / image.color().channel_count() as u16 > 8;
            macro_rules! put {
                ($colour:ty,$data:expr) => {{
                    let mut output = encoder
                        .new_image::<$colour>(image.width(), image.height())
                        .map_err(|e| e.to_string())?;
                    if let Some(profile) = &icc {
                        output
                            .encoder()
                            .write_tag(tiff::tags::Tag::IccProfile, profile.as_slice())
                            .map_err(|e| e.to_string())?;
                    }
                    output.write_data($data).map_err(|e| e.to_string())?;
                }};
            }
            match (sixteen, alpha) {
                (false, false) => put!(colortype::RGB8, image.to_rgb8().as_raw()),
                (false, true) => put!(colortype::RGBA8, image.to_rgba8().as_raw()),
                (true, false) => put!(colortype::RGB16, image.to_rgb16().as_raw()),
                (true, true) => put!(colortype::RGBA16, image.to_rgba16().as_raw()),
            }
            Ok(())
        }
        "webp" => {
            if source.few_colours {
                let mut encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut file);
                if let Some(icc) = icc {
                    encoder.set_icc_profile(icc).map_err(|e| e.to_string())?;
                }
                image
                    .write_with_encoder(encoder)
                    .map_err(|e| e.to_string())?;
                return file.flush().map_err(|e| e.to_string());
            }
            let rgba = image.to_rgba8();
            let encoder = webp::Encoder::from_rgba(rgba.as_raw(), image.width(), image.height());
            let bytes = encoder.encode(90.0);
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            Ok(())
        }
        "ico" => {
            let thumbnail = image.thumbnail(256, 256);
            let side = thumbnail.width().max(thumbnail.height());
            let mut square = image::RgbaImage::new(side, side);
            image::imageops::overlay(
                &mut square,
                &thumbnail.to_rgba8(),
                ((side - thumbnail.width()) / 2) as i64,
                ((side - thumbnail.height()) / 2) as i64,
            );
            let mut frames = Vec::new();
            for size in [16, 32, 48, 256] {
                let resized = image::imageops::resize(
                    &square,
                    size,
                    size,
                    image::imageops::FilterType::Lanczos3,
                );
                frames.push(
                    IcoFrame::as_png(
                        resized.as_raw(),
                        size,
                        size,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| e.to_string())?,
                );
            }
            IcoEncoder::new(&mut file).encode_images(&frames)
        }
        "bmp" => image.write_to(&mut file, ImageFormat::Bmp),
        "gif" => image.write_to(&mut file, ImageFormat::Gif),
        _ => return Err("Unsupported image output".into()),
    };
    result.map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}
