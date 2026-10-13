//! Converter (docs/CONVERTER_SPEC.md): any file → a format → Convert. Detection by content, a curated table of outputs
//! per class of input, a plan for each output (a pure function, tested below) and the image engine in Rust. FFmpeg
//! runs in the page's job (jobs.js ctx.proc) with the arguments planned here, so cancelling works like everywhere.
//! Documents (v2): LibreOffice and Pandoc run the same way, as steps planned here; PDF pages are drawn by PDFium.

use crate::{framegrab::Picked, paths::*, tools::*};
use image::{codecs, DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageFormat, ImageReader, Limits};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{ipc::Response, AppHandle, Manager};

/* ===== probe ===== */

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    Image,
    Animated,
    Audio,
    Video,
    /// text documents (DOCX, DOC, ODT, RTF), spreadsheets, presentations: LibreOffice
    Document,
    Sheet,
    Slides,
    /// Markdown, HTML, EPUB, LaTeX, Org, DocBook: Pandoc
    Markup,
    /// PDF pages to pictures: PDFium
    Pdf,
    Unsupported,
}

/// One stream of a media file, as ffprobe reports it
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub index: u32,
    /// "video" | "audio" | "subtitle" | "attachment" | "data"
    pub kind: String,
    pub codec: String,
    /// a cover picture (attached_pic), not real video
    pub cover: bool,
    pub width: u32,
    pub height: u32,
    pub pix_fmt: String,
    pub transfer: String,
    pub channels: u32,
    pub rate: u32,
    /// bits per sample (0: unknown); float samples count as 32 with `float`
    pub bits: u32,
    pub float: bool,
    pub lang: String,
}

/// What a file is: its class, its real format (by content) and what the plan needs to know
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub class: Class,
    /// the format by content: "png", "jpg", "mkv", "wav"…
    pub format: String,
    /// the extension it is named with
    pub named: String,
    /// the extension says another format (a WAV named .mp3)
    pub mismatch: bool,
    pub streams: Vec<Stream>,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pub alpha: bool,
    pub hdr: bool,
    /// a picture of at most 256 colours (a WebP of it is lossless)
    pub few_colours: bool,
    pub size: u64,
    /// audio or video, or an AVIF, found without FFmpeg installed: it can be converted once it is
    pub needs_ffmpeg: bool,
    /// a PDF's pages (0: not counted, PDFium missing)
    pub pages: u32,
}

impl Source {
    fn empty(class: Class, format: &str, named: &str, size: u64) -> Self {
        Source { class, format: format.into(), named: named.into(), mismatch: false, streams: vec![], duration: 0.0, width: 0, height: 0, frames: 0, alpha: false, hdr: false, few_colours: false, size, needs_ffmpeg: false, pages: 0 }
    }
    fn video(&self) -> Option<&Stream> {
        self.streams.iter().find(|s| s.kind == "video" && !s.cover)
    }
    fn audio(&self) -> impl Iterator<Item = &Stream> {
        self.streams.iter().filter(|s| s.kind == "audio")
    }
    fn covers(&self) -> impl Iterator<Item = &Stream> {
        self.streams.iter().filter(|s| s.kind == "video" && s.cover)
    }
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "ico", "tga", "qoi", "avif"];
const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus", "aif", "aiff", "wma", "ac3", "alac", "ape", "wv", "caf", "mka", "w64"];
const DOC_EXT: &[&str] = &["pdf", "docx", "doc", "odt", "rtf", "xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp", "md", "markdown", "html", "htm", "xhtml", "epub", "tex", "latex", "org", "dbk"];
const VIDEO_EXT: &[&str] = &["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "ts", "mts", "m2ts", "mpg", "mpeg", "3gp", "ogv", "vob"];

/// One spelling per format: jpeg → jpg, tif → tiff, aif → aiff…
fn canonical(ext: &str) -> String {
    match ext {
        "jpeg" | "jpe" => "jpg",
        "tif" => "tiff",
        "aif" | "aifc" => "aiff",
        "oga" => "ogg",
        "m4v" => "mp4",
        "mts" | "m2ts" => "ts",
        "mpeg" => "mpg",
        "markdown" => "md",
        "htm" | "xhtml" => "html",
        "latex" => "tex",
        e => e,
    }
    .to_string()
}

fn image_format_id(f: ImageFormat) -> Option<&'static str> {
    Some(match f {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        ImageFormat::Gif => "gif",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        ImageFormat::Ico => "ico",
        ImageFormat::Tga => "tga",
        ImageFormat::Qoi => "qoi",
        _ => return None,
    })
}

/// "avif" or "heic" for an ISO-BMFF picture (an ftyp box with such a brand), from its first bytes
fn heif_brand(head: &[u8]) -> Option<&'static str> {
    if head.len() < 16 || &head[4..8] != b"ftyp" {
        return None;
    }
    let size = (u32::from_be_bytes([head[0], head[1], head[2], head[3]]) as usize).clamp(16, head.len());
    let brands: Vec<&[u8]> = std::iter::once(&head[8..12]).chain(head[16..size].chunks_exact(4)).collect();
    if brands.iter().any(|b| *b == b"avif" || *b == b"avis") {
        Some("avif")
    } else if brands.iter().any(|b| matches!(*b, b"heic" | b"heix" | b"hevc" | b"heim" | b"heis" | b"mif1" | b"msf1")) {
        Some("heic")
    } else {
        None
    }
}

/// A file read as a picture by the image crate: still or animated, its size, alpha and colours
fn probe_image(path: &Path, named: &str, size: u64) -> Option<Source> {
    let mut reader = ImageReader::open(path).ok()?;
    // TGA has no signature: the extension tells it; any other format is read from the bytes
    if named != "tga" {
        reader = reader.with_guessed_format().ok()?;
    }
    let format = image_format_id(reader.format()?)?;
    let mut src = Source::empty(Class::Image, format, named, size);
    match format {
        "gif" => {
            use image::AnimationDecoder;
            let file = std::io::BufReader::new(fs::File::open(path).ok()?);
            let dec = codecs::gif::GifDecoder::new(file).ok()?;
            let (w, h) = dec.dimensions();
            (src.width, src.height) = (w, h);
            src.frames = dec.into_frames().take(2).count() as u32;
        }
        "webp" => {
            let file = std::io::BufReader::new(fs::File::open(path).ok()?);
            let dec = codecs::webp::WebPDecoder::new(file).ok()?;
            (src.width, src.height) = dec.dimensions();
            src.alpha = dec.color_type().has_alpha();
            src.frames = if dec.has_animation() { 2 } else { 1 };
        }
        _ => {}
    }
    if src.frames > 1 {
        src.class = Class::Animated;
        if format == "gif" {
            src.alpha = true;
        }
        return Some(src);
    }
    // a still picture: decoded once for its alpha and colours (the limits of §4.1 apply)
    let img = decode(path, named).ok()?;
    (src.width, src.height) = (img.width(), img.height());
    src.frames = 1;
    src.alpha = img.color().has_alpha() && img.to_rgba8().pixels().any(|p| p.0[3] < 255);
    src.few_colours = format == "png" && few_colours(&img);
    Some(src)
}

/// At most 256 different colours (a palette PNG, a logo)
fn few_colours(img: &DynamicImage) -> bool {
    let rgba = img.to_rgba8();
    let mut seen = HashSet::new();
    for p in rgba.pixels() {
        if seen.insert(p.0) && seen.len() > 256 {
            return false;
        }
    }
    true
}

fn tag(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string()))).unwrap_or_default()
}
fn num(v: &Value, key: &str) -> u32 {
    v.get(key).and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0) as u32
}

/// The container's format from ffprobe's format_name and the extension (one name for each family)
fn container(format_name: &str, ext: &str, streams: &[Stream]) -> String {
    let only_audio = !streams.iter().any(|s| s.kind == "video" && !s.cover);
    let first_audio = streams.iter().find(|s| s.kind == "audio").map(|s| s.codec.as_str()).unwrap_or("");
    let first = format_name.split(',').next().unwrap_or("");
    if format_name.contains("matroska") {
        return match ext {
            "webm" => "webm",
            "mka" => "mka",
            _ => "mkv",
        }
        .into();
    }
    if format_name.starts_with("mov,mp4") {
        return match ext {
            "mov" | "m4a" | "mp4" | "3gp" => ext,
            _ if only_audio => "m4a",
            _ => "mp4",
        }
        .into();
    }
    match first {
        "ogg" if first_audio == "opus" && only_audio => "opus".into(),
        "ogg" if !only_audio => "ogv".into(),
        "asf" => if only_audio { "wma" } else { "wmv" }.into(),
        "mpegts" => "ts".into(),
        "mpeg" => "mpg".into(),
        "wav" | "w64" | "mp3" | "flac" | "ogg" | "aiff" | "aac" | "ac3" | "avi" | "flv" | "caf" | "ape" | "wv" => first.into(),
        "" => ext.into(),
        f => f.into(),
    }
}

/// Families whose extensions name the same container (a .m4a and a .mp4 are both MP4)
fn same_family(a: &str, b: &str) -> bool {
    const FAMILIES: &[&[&str]] = &[&["mp4", "m4a", "mov", "3gp"], &["mkv", "webm", "mka"], &["ogg", "opus", "ogv"], &["wma", "wmv"]];
    a == b || FAMILIES.iter().any(|f| f.contains(&a) && f.contains(&b))
}

/// Reads ffprobe's JSON (-show_streams -show_format) into a Source
pub(crate) fn from_ffprobe(v: &Value, named: &str, size: u64) -> Source {
    let streams: Vec<Stream> = v
        .get("streams")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|s| {
                    let sample_fmt = tag(s, "sample_fmt");
                    let float = sample_fmt.starts_with("flt") || sample_fmt.starts_with("dbl");
                    let raw = num(s, "bits_per_raw_sample");
                    let bits = if float {
                        32
                    } else if raw > 0 {
                        raw
                    } else if sample_fmt.starts_with("s16") {
                        16
                    } else if sample_fmt.starts_with("s32") {
                        let per = num(s, "bits_per_sample");
                        if per > 0 { per } else { 24 }
                    } else if sample_fmt.starts_with("u8") {
                        8
                    } else {
                        num(s, "bits_per_sample")
                    };
                    Stream {
                        index: num(s, "index"),
                        kind: tag(s, "codec_type"),
                        codec: tag(s, "codec_name"),
                        cover: s.get("disposition").map(|d| num(d, "attached_pic") == 1).unwrap_or(false),
                        width: num(s, "width"),
                        height: num(s, "height"),
                        pix_fmt: tag(s, "pix_fmt"),
                        transfer: tag(s, "color_transfer"),
                        channels: num(s, "channels"),
                        rate: num(s, "sample_rate"),
                        bits,
                        float,
                        lang: s.get("tags").map(|t| tag(t, "language")).unwrap_or_default(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let format = v.get("format").cloned().unwrap_or(Value::Null);
    let format_name = tag(&format, "format_name");
    let duration = tag(&format, "duration").parse::<f64>().unwrap_or(0.0);
    let real_video = streams.iter().find(|s| s.kind == "video" && !s.cover).cloned();
    let has_audio = streams.iter().any(|s| s.kind == "audio");
    // a still picture read by FFmpeg (image2, *_pipe) is not a video
    let picture = format_name.ends_with("_pipe") || format_name == "image2";
    let class = match (&real_video, has_audio) {
        (Some(_), _) if !picture => Class::Video,
        (None, true) => Class::Audio,
        _ => Class::Unsupported,
    };
    let fmt = container(&format_name, named, &streams);
    let mut src = Source::empty(class, &fmt, named, size);
    src.duration = duration;
    if let Some(v) = &real_video {
        (src.width, src.height) = (v.width, v.height);
        src.alpha = v.pix_fmt.starts_with("yuva") || v.pix_fmt.contains("rgba") || v.pix_fmt.contains("argb") || v.pix_fmt.starts_with("gbrap") || v.pix_fmt.starts_with("ya");
        src.hdr = matches!(v.transfer.as_str(), "smpte2084" | "arib-std-b67");
    }
    src.mismatch = class != Class::Unsupported
        && (AUDIO_EXT.contains(&named) || VIDEO_EXT.contains(&named))
        && !same_family(&canonical(named), &fmt);
    src.streams = streams;
    src
}

/// A document by its first bytes: PDF, the zip of an Office or OpenDocument file or an EPUB (by its parts), the old
/// Office files (by the extension, they share one container), RTF; plain-text formats by their extension
fn probe_doc(path: &Path, head: &[u8], named: &str, size: u64) -> Option<Source> {
    const OLE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    let (class, format) = if head.starts_with(b"%PDF") {
        (Class::Pdf, "pdf")
    } else if head.starts_with(b"PK\x03\x04") {
        zip_kind(path)?
    } else if head.starts_with(&OLE) {
        match named {
            "doc" => (Class::Document, "doc"),
            "xls" => (Class::Sheet, "xls"),
            "ppt" => (Class::Slides, "ppt"),
            _ => return None,
        }
    } else if head.starts_with(b"{\\rtf") {
        (Class::Document, "rtf")
    } else if !head.is_empty() && !head.contains(&0) {
        match named {
            "md" | "html" | "tex" | "org" | "dbk" => (Class::Markup, ext_static(named)),
            "csv" => (Class::Sheet, "csv"),
            _ => return None,
        }
    } else {
        return None;
    };
    let mut src = Source::empty(class, format, named, size);
    src.mismatch = DOC_EXT.contains(&named) && named != format;
    Some(src)
}

/// What a zip holds: an OpenDocument file or an EPUB says it in its "mimetype" part, an Office file by its parts
fn zip_kind(path: &Path) -> Option<(Class, &'static str)> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).ok()?).ok()?;
    if let Ok(mut m) = zip.by_name("mimetype") {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut std::io::Read::take(&mut m, 200), &mut text);
        return match text.trim() {
            "application/epub+zip" => Some((Class::Markup, "epub")),
            "application/vnd.oasis.opendocument.text" => Some((Class::Document, "odt")),
            "application/vnd.oasis.opendocument.spreadsheet" => Some((Class::Sheet, "ods")),
            "application/vnd.oasis.opendocument.presentation" => Some((Class::Slides, "odp")),
            _ => None,
        };
    }
    let has = |n: &str| zip.file_names().any(|f| f == n);
    if has("word/document.xml") {
        Some((Class::Document, "docx"))
    } else if has("xl/workbook.xml") {
        Some((Class::Sheet, "xlsx"))
    } else if has("ppt/presentation.xml") {
        Some((Class::Slides, "pptx"))
    } else {
        None
    }
}

/// What `path` is. The image crate reads pictures; ffprobe everything else (when FFmpeg is installed).
pub(crate) fn probe(path: &Path, ffprobe: Option<&Path>) -> Result<Source, String> {
    let meta = fs::metadata(path).map_err(|_| "the file no longer exists".to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let named = canonical(&ext_of(&path.to_string_lossy()));
    let mut head = [0u8; 64];
    let n = fs::File::open(path).and_then(|mut f| std::io::Read::read(&mut f, &mut head)).unwrap_or(0);
    let head = &head[..n];
    if let Some(brand) = heif_brand(head) {
        // AVIF: decoded by FFmpeg, then the image engine; HEIC is not in v1
        let mut src = Source::empty(if brand == "avif" { Class::Image } else { Class::Unsupported }, brand, &named, size);
        src.mismatch = named != brand && IMAGE_EXT.contains(&named.as_str());
        if brand == "avif" {
            src.frames = 1;
            match ffprobe.and_then(|p| run_ffprobe(p, path).ok()) {
                Some(v) => {
                    let s = from_ffprobe(&v, &named, size);
                    (src.width, src.height, src.alpha) = (s.width, s.height, s.alpha || s.streams.iter().filter(|x| x.kind == "video").count() > 1);
                }
                None => src.needs_ffmpeg = true,
            }
        }
        return Ok(src);
    }
    if let Some(src) = probe_doc(path, head, &named, size) {
        return Ok(src);
    }
    if let Some(mut src) = probe_image(path, &named, size) {
        let known = IMAGE_EXT.contains(&named.as_str()) || AUDIO_EXT.contains(&named.as_str()) || VIDEO_EXT.contains(&named.as_str()) || DOC_EXT.contains(&named.as_str());
        src.mismatch = known && named != src.format;
        return Ok(src);
    }
    let Some(ffprobe) = ffprobe else {
        let mut src = Source::empty(Class::Unsupported, &named, &named, size);
        if AUDIO_EXT.contains(&named.as_str()) {
            src.class = Class::Audio;
            src.needs_ffmpeg = true;
        } else if VIDEO_EXT.contains(&named.as_str()) {
            src.class = Class::Video;
            src.needs_ffmpeg = true;
        }
        return Ok(src);
    };
    match run_ffprobe(ffprobe, path) {
        Ok(v) => Ok(from_ffprobe(&v, &named, size)),
        Err(_) => Ok(Source::empty(Class::Unsupported, &named, &named, size)),
    }
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// ffprobe's JSON; with ffmpeg itself as `bin` (an install without ffprobe), the same read from `ffmpeg -i`
fn run_ffprobe(bin: &Path, path: &Path) -> Result<Value, String> {
    if bin.file_stem().is_some_and(|n| n.eq_ignore_ascii_case("ffmpeg")) {
        let out = quiet(Command::new(bin).args(["-hide_banner", "-nostdin", "-i"]).arg(path)).output().map_err(|e| e.to_string())?;
        return from_ffmpeg_info(&String::from_utf8_lossy(&out.stderr)).ok_or_else(|| "not a media file".to_string());
    }
    let out = quiet(Command::new(bin).args(["-v", "error", "-show_streams", "-show_format", "-of", "json"]).arg(path))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// Splits at ", " outside parentheses ("yuv420p(tv, bt709), 1920x1080" → two parts)
fn split_top(text: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut start) = (vec![], 0i32, 0);
    let b = text.as_bytes();
    for i in 0..b.len() {
        match b[i] {
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            b',' if depth == 0 => {
                parts.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// `ffmpeg -i`'s description of the input ("Input #0, wav, from…", "Duration:", "Stream #0:1(eng): Audio: …") in
/// ffprobe's JSON shape; None when there is no stream
pub(crate) fn from_ffmpeg_info(text: &str) -> Option<Value> {
    let mut format_name = String::new();
    let mut duration = String::new();
    let mut streams = vec![];
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("Input #0, ") {
            format_name = rest.split(", from").next().unwrap_or("").to_string();
        } else if let Some(rest) = line.strip_prefix("Duration: ") {
            let hms = rest.split(',').next().unwrap_or("");
            let v: Vec<f64> = hms.split(':').filter_map(|x| x.trim().parse().ok()).collect();
            if v.len() == 3 {
                duration = (v[0] * 3600.0 + v[1] * 60.0 + v[2]).to_string();
            }
        } else if let Some(rest) = line.strip_prefix("Stream #0:") {
            let index: u32 = rest.chars().take_while(char::is_ascii_digit).collect::<String>().parse().ok()?;
            let Some((kind, id, body)) = ["Audio", "Video", "Subtitle", "Data", "Attachment"].iter().find_map(|k| rest.split_once(&format!(": {k}: ")).map(|(h, b)| (*k, h, b))) else { continue };
            let lang = id.split_once('(').and_then(|(_, l)| l.split(')').next()).filter(|l| *l != "und").unwrap_or("");
            let parts = split_top(body);
            let codec = parts[0].split_whitespace().next().unwrap_or("").to_string();
            let mut st = json!({ "index": index, "codec_type": kind.to_lowercase(), "codec_name": codec, "tags": { "language": lang } });
            if line.contains("(attached pic)") {
                st["disposition"] = json!({ "attached_pic": 1 });
            }
            if kind == "Audio" {
                for p in &parts[1..] {
                    if let Some(hz) = p.strip_suffix(" Hz") {
                        st["sample_rate"] = json!(hz.trim());
                    } else if let Some(n) = p.strip_suffix(" channels") {
                        st["channels"] = json!(n.trim().parse::<u32>().unwrap_or(0));
                    } else if matches!(*p, "mono" | "stereo") || p.starts_with(|c: char| c.is_ascii_digit()) && p.contains('.') && !p.contains(' ') {
                        let ch = match *p { "mono" => 1, "stereo" => 2, l => l.split(['(', '.']).take(2).filter_map(|x| x.parse::<u32>().ok()).sum() };
                        st["channels"] = json!(ch);
                    } else if ["u8", "s16", "s32", "s64", "flt", "dbl"].iter().any(|f| p.starts_with(f)) {
                        st["sample_fmt"] = json!(p.split_whitespace().next().unwrap_or(""));
                        if let Some(b) = p.split_once('(').and_then(|(_, b)| b.strip_suffix(" bit)")) {
                            st["bits_per_raw_sample"] = json!(b.trim());
                        }
                    }
                }
            } else if kind == "Video" {
                if let Some(pix) = parts.get(1) {
                    st["pix_fmt"] = json!(pix.split('(').next().unwrap_or("").trim());
                    for t in ["smpte2084", "arib-std-b67"] {
                        if pix.contains(t) {
                            st["color_transfer"] = json!(t);
                        }
                    }
                }
                if let Some((w, h)) = parts.iter().flat_map(|p| p.split_whitespace()).find_map(|t| t.split_once('x').and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))) {
                    (st["width"], st["height"]) = (json!(w), json!(h));
                }
            }
            streams.push(st);
        }
    }
    (!streams.is_empty()).then(|| json!({ "streams": streams, "format": { "format_name": format_name, "duration": duration } }))
}

/* ===== table ===== */

/// The outputs of each class (§3), in the selector's order; "audio" marks the "Audio only" group of a video
pub(crate) fn table(src: &Source) -> Vec<(&'static str, bool)> {
    let v: &[&str] = match src.class {
        Class::Image => &["png", "jpg", "webp", "tiff", "bmp", "ico", "gif"],
        // FFmpeg reads animated GIF; an animated WebP is read by the image crate only (GIF and its first frame)
        Class::Animated if src.format == "webp" => &["gif", "png"],
        Class::Animated => &["mp4", "webm", "gif", "webp", "png"],
        Class::Audio => &["mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff"],
        Class::Video => &["mp4", "mkv", "webm", "mov", "gif"],
        Class::Document => &["pdf", "docx", "odt", "rtf", "md", "html", "epub"],
        Class::Sheet => &["pdf", "xlsx", "ods", "csv"],
        Class::Slides => &["pdf", "pptx", "odp"],
        Class::Markup => &["html", "docx", "odt", "epub", "md", "pdf"],
        Class::Pdf => &["png", "jpg"],
        Class::Unsupported => &[],
    };
    let mut out: Vec<(&'static str, bool)> = v.iter().map(|t| (*t, false)).collect();
    if src.class == Class::Video && src.audio().next().is_some() {
        out.extend(["mp3", "m4a", "flac", "wav", "opus"].iter().map(|t| (*t, true)));
    }
    // the input's own format is not offered
    out.retain(|(t, audio)| *audio || *t != src.format);
    out
}

/// The encoders of the FFmpeg in use (`ffmpeg -encoders`), read once per binary (path + modified time)
fn encoders(bin: &Path) -> Option<HashSet<String>> {
    static CACHE: Mutex<Option<(PathBuf, u64, HashSet<String>)>> = Mutex::new(None);
    let stamp = fs::metadata(bin).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    if let Some((p, s, set)) = hold(&CACHE).as_ref() {
        if p == bin && *s == stamp {
            return Some(set.clone());
        }
    }
    let out = quiet(Command::new(bin).args(["-hide_banner", "-encoders"])).output().ok()?;
    let set = parse_encoders(&String::from_utf8_lossy(&out.stdout));
    *hold(&CACHE) = Some((bin.to_path_buf(), stamp, set.clone()));
    Some(set)
}

/// " V....D libx264  libx264 H.264…" → "libx264" (lines after the "------" separator)
pub(crate) fn parse_encoders(text: &str) -> HashSet<String> {
    text.lines()
        .skip_while(|l| !l.trim_start().starts_with("---"))
        .skip(1)
        .filter_map(|l| l.split_whitespace().nth(1).map(str::to_string))
        .collect()
}

/// An output of the selector: its id, its group, whether it needs FFmpeg, the consequence line's notes
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: &'static str,
    pub audio: bool,
    pub ffmpeg: bool,
    /// the components it needs ("ffmpeg", "pandoc", "libreoffice", "pdfium")
    pub tools: Vec<&'static str>,
    pub notes: Vec<&'static str>,
    pub copy: bool,
}

/// The table filtered by what the installed FFmpeg can encode (§3.5). Without FFmpeg (None) its outputs stay,
/// marked: the card offers the install.
pub(crate) fn outputs(src: &Source, enc: Option<&HashSet<String>>) -> Vec<Output> {
    // audio or video found without FFmpeg: its streams are not known yet, so the rows are planned on typical ones
    // (re-encodes); the real plan is made once FFmpeg reads the file
    let assumed;
    let src = if src.needs_ffmpeg && src.streams.is_empty() && matches!(src.class, Class::Audio | Class::Video) {
        let mut a = src.clone();
        let blank = Stream { index: 0, kind: "audio".into(), codec: String::new(), cover: false, width: 0, height: 0, pix_fmt: String::new(), transfer: String::new(), channels: 2, rate: 48000, bits: 16, float: false, lang: String::new() };
        if a.class == Class::Video {
            a.streams.push(Stream { kind: "video".into(), width: 1920, height: 1080, pix_fmt: "yuv420p".into(), ..blank.clone() });
            a.streams.push(Stream { index: 1, ..blank });
        } else {
            a.streams.push(blank);
        }
        assumed = a;
        &assumed
    } else {
        src
    };
    table(src)
        .into_iter()
        .filter_map(|(id, audio)| {
            let p = plan(src, id, audio)?;
            if let Some(enc) = enc {
                if !p.needs.iter().all(|n| enc.contains(*n)) {
                    return None;
                }
            }
            Some(Output { id, audio, ffmpeg: p.tools.contains(&"ffmpeg"), tools: p.tools, notes: p.notes, copy: p.copy })
        })
        .collect()
}

/* ===== plan ===== */

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Ffmpeg,
    Image,
    /// LibreOffice and Pandoc, one or two steps (doc_steps)
    Docs,
    /// PDFium, page by page
    Pdf,
}

/// How one output is made: FFmpeg's arguments between the input and the output (no paths), or the image engine
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub engine: Engine,
    /// an AVIF: FFmpeg decodes it to PNG first, then the image engine
    pub decode: bool,
    pub args: Vec<String>,
    pub muxer: &'static str,
    pub ext: &'static str,
    /// the consequence line (§4.5), most important first
    pub notes: Vec<&'static str>,
    /// every stream copied as it is
    pub copy: bool,
    /// FFmpeg encoders it needs
    pub needs: Vec<&'static str>,
    /// the components it needs
    pub tools: Vec<&'static str>,
    /// lane: 0 light (images, copies), 1 audio, 2 video
    pub weight: u8,
}

const LOSSY: &[&str] = &["mp3", "aac", "vorbis", "opus", "ac3", "eac3", "wmav1", "wmav2", "wmapro", "mp2", "amr_nb", "amr_wb", "dts"];
const TEXT_SUBS: &[&str] = &["subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"];

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

/// Depth of a lossless output: 16 bits, or 24 for deeper or float sources (lossy ones decode to 16)
fn deep(a: &Stream) -> bool {
    !LOSSY.contains(&a.codec.as_str()) && (a.float || a.bits > 16)
}

/// One audio stream into `target` (an audio format); k: its number among the output's audio streams.
/// Returns (arguments, copied, encoder needed)
fn audio_codec(target: &str, a: &Stream, k: usize) -> (Vec<String>, bool, Option<&'static str>) {
    let c = |x: &str| format!("-{x}:a:{k}");
    let copy = |ok: bool| ok.then(|| (vec![c("c"), "copy".into()], true, None));
    let pcm = |be: bool| {
        let enc = match (deep(a), be) {
            (false, false) => "pcm_s16le",
            (true, false) => "pcm_s24le",
            (false, true) => "pcm_s16be",
            (true, true) => "pcm_s24be",
        };
        (vec![c("c"), enc.into()], false, Some(enc))
    };
    let codec = a.codec.as_str();
    match target {
        "mp3" => copy(codec == "mp3").unwrap_or_else(|| {
            let mut v = vec![c("c"), "libmp3lame".into(), c("q"), "0".into()];
            if a.rate > 48000 {
                v.extend([c("ar"), "48000".into()]);
            }
            if a.channels > 2 {
                v.extend([c("ac"), "2".into()]);
            }
            (v, false, Some("libmp3lame"))
        }),
        "m4a" | "aac" => copy(codec == "aac" || codec == "alac").unwrap_or_else(|| (vec![c("c"), "aac".into(), c("b"), "256k".into()], false, Some("aac"))),
        "flac" => copy(codec == "flac").unwrap_or_else(|| {
            let mut v = vec![c("c"), "flac".into(), "-compression_level".into(), "5".into()];
            if deep(a) {
                v.extend([c("sample_fmt"), "s32".into(), "-bits_per_raw_sample".into(), "24".into()]);
            } else {
                v.extend([c("sample_fmt"), "s16".into()]);
            }
            (v, false, Some("flac"))
        }),
        "wav" => copy(codec.starts_with("pcm_") && (codec.ends_with("le") || codec == "pcm_u8")).unwrap_or_else(|| pcm(false)),
        "aiff" => copy(codec.starts_with("pcm_") && codec.ends_with("be")).unwrap_or_else(|| pcm(true)),
        "ogg" => copy(codec == "vorbis").unwrap_or_else(|| (vec![c("c"), "libvorbis".into(), c("q"), "6".into()], false, Some("libvorbis"))),
        "opus" => copy(codec == "opus").unwrap_or_else(|| {
            let mut v = vec![c("c"), "libopus".into(), c("b"), "160k".into(), c("ar"), "48000".into()];
            if a.channels > 2 {
                v.extend(["-mapping_family".into(), "1".into()]);
            }
            (v, false, Some("libopus"))
        }),
        _ => (vec![], false, None),
    }
}

/// An audio stream inside a video container: copied when the container holds it, else its codec
fn audio_in_video(target: &str, a: &Stream, k: usize) -> (Vec<String>, bool, Option<&'static str>) {
    let codec = a.codec.as_str();
    let fits = match target {
        "mp4" => matches!(codec, "aac" | "mp3" | "ac3" | "eac3" | "alac"),
        "mov" => matches!(codec, "aac" | "mp3" | "ac3" | "alac") || matches!(codec, "pcm_s16le" | "pcm_s16be" | "pcm_s24le" | "pcm_s24be"),
        "webm" => matches!(codec, "vorbis" | "opus"),
        "mkv" => true,
        _ => false,
    };
    if fits {
        return (vec![format!("-c:a:{k}"), "copy".into()], true, None);
    }
    if target == "webm" {
        let mut v = vec![format!("-c:a:{k}"), "libopus".into(), format!("-b:a:{k}"), "160k".into(), format!("-ar:a:{k}"), "48000".into()];
        if a.channels > 2 {
            v.extend(["-mapping_family".into(), "1".into()]);
        }
        (v, false, Some("libopus"))
    } else {
        (vec![format!("-c:a:{k}"), "aac".into(), format!("-b:a:{k}"), "192k".into()], false, Some("aac"))
    }
}

fn muxer(ext: &str) -> &'static str {
    match ext {
        "mp4" => "mp4",
        "mov" => "mov",
        "mkv" => "matroska",
        "webm" => "webm",
        "gif" => "gif",
        "webp" => "webp",
        "mp3" => "mp3",
        "m4a" => "ipod",
        "flac" => "flac",
        "wav" => "wav",
        "ogg" => "ogg",
        "opus" => "opus",
        "aiff" => "aiff",
        _ => "",
    }
}

fn ext_static(t: &str) -> &'static str {
    ["png", "jpg", "webp", "tiff", "bmp", "ico", "gif", "mp4", "webm", "mkv", "mov", "mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff",
     "pdf", "docx", "odt", "rtf", "md", "html", "epub", "xlsx", "ods", "csv", "pptx", "odp", "tex", "org", "dbk"]
        .into_iter()
        .find(|x| *x == t)
        .unwrap_or("")
}

const H264: &[&str] = &["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"];

/// The plan for `target` (§3, §4); None for an output the table does not have
pub(crate) fn plan(src: &Source, target: &str, audio_only: bool) -> Option<Plan> {
    let ext = ext_static(target);
    if ext.is_empty() {
        return None;
    }
    let base = |engine| Plan { engine, decode: false, args: vec![], muxer: muxer(ext), ext, notes: vec![], copy: false, needs: vec![], tools: if engine == Engine::Ffmpeg { vec!["ffmpeg"] } else { vec![] }, weight: 0 };
    let p = match src.class {
        Class::Unsupported => None,
        Class::Document | Class::Sheet | Class::Slides | Class::Markup => {
            let mut p = base(Engine::Docs);
            p.weight = 1;
            let route = route(src.class, &src.format, target)?;
            p.tools = match route {
                Route::Office => vec!["libreoffice"],
                Route::Pandoc => vec!["pandoc"],
                Route::OfficePandoc | Route::PandocOffice => vec!["libreoffice", "pandoc"],
            };
            if route == Route::Office {
                if target != "pdf" {
                    p.notes.push("layout");
                }
            } else {
                p.notes.push("structure");
            }
            if target == "md" && src.class != Class::Markup {
                p.notes.push("noPictures");
            }
            if target == "csv" && src.format != "csv" {
                p.notes.push("firstSheet");
            }
            Some(p)
        }
        Class::Pdf => {
            let mut p = base(Engine::Pdf);
            p.weight = 1;
            p.tools = vec!["pdfium"];
            if src.pages != 1 {
                p.notes.push("pages");
            }
            Some(p)
        }
        Class::Image => {
            let mut p = base(Engine::Image);
            p.muxer = "";
            p.decode = src.format == "avif";
            if p.decode {
                p.tools.push("ffmpeg");
            }
            if src.alpha && target == "jpg" {
                p.notes.push("white");
            }
            Some(p)
        }
        Class::Animated => {
            if target == "png" {
                let mut p = base(Engine::Image);
                p.muxer = "";
                p.notes.push("firstFrame");
                return Some(p);
            }
            if src.format == "webp" {
                // only GIF: the image crate writes it frame by frame
                let mut p = base(Engine::Image);
                p.muxer = "";
                return (target == "gif").then_some(p);
            }
            let mut p = base(Engine::Ffmpeg);
            p.weight = 1;
            p.args = s(&["-map", "0:v:0", "-an", "-sn"]);
            match target {
                "mp4" => {
                    p.args.extend(s(&["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]));
                    p.args.extend(s(H264));
                    p.args.extend(s(&["-movflags", "+faststart"]));
                    p.needs.push("libx264");
                }
                "webm" => {
                    p.args.extend(s(&["-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-row-mt", "1", "-deadline", "good"]));
                    p.args.extend(s(&["-pix_fmt", if src.alpha { "yuva420p" } else { "yuv420p" }]));
                    p.needs.push("libvpx-vp9");
                }
                "webp" => {
                    p.args.extend(s(&["-c:v", "libwebp_anim", "-lossless", "0", "-quality", "90", "-loop", "0"]));
                    p.needs.push("libwebp_anim");
                }
                "gif" => {
                    p.args = s(&["-filter_complex", "[0:v:0]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse[out]", "-map", "[out]", "-an", "-sn", "-loop", "0"]);
                    p.needs.push("gif");
                }
                _ => return None,
            }
            Some(p)
        }
        Class::Audio => {
            let a = src.audio().next()?;
            let mut p = base(Engine::Ffmpeg);
            let (codec, copied, need) = audio_codec(target, a, 0);
            p.args = vec!["-map".into(), format!("0:{}", a.index)];
            // the cover goes along where the format holds one (MP3, M4A, FLAC)
            let cover = matches!(target, "mp3" | "m4a" | "flac").then(|| src.covers().find(|c| matches!(c.codec.as_str(), "mjpeg" | "png"))).flatten();
            if let Some(c) = cover {
                p.args.extend(["-map".into(), format!("0:{}", c.index), "-c:v".into(), "copy".into(), "-disposition:v:0".into(), "attached_pic".into()]);
            }
            p.args.extend(codec);
            p.args.extend(s(&["-map_metadata", "0"]));
            if target == "mp3" {
                p.args.extend(s(&["-id3v2_version", "3"]));
            }
            p.copy = copied;
            p.weight = if copied { 0 } else { 1 };
            p.needs.extend(need);
            p.notes.push(if copied { "copy" } else { "reencodeAudio" });
            if !copied && LOSSY.contains(&a.codec.as_str()) && matches!(target, "flac" | "wav" | "aiff") {
                p.notes.push("noBetter");
            }
            Some(p)
        }
        Class::Video if audio_only => {
            let audio: Vec<&Stream> = src.audio().collect();
            let a = *audio.first()?;
            let mut p = base(Engine::Ffmpeg);
            let (codec, copied, need) = audio_codec(target, a, 0);
            p.args = vec!["-map".into(), format!("0:{}", a.index), "-vn".into(), "-sn".into()];
            p.args.extend(codec);
            p.args.extend(s(&["-map_metadata", "0"]));
            p.copy = copied;
            p.weight = if copied { 0 } else { 1 };
            p.needs.extend(need);
            p.notes.push(if copied { "copy" } else { "reencodeAudio" });
            if audio.len() > 1 {
                p.notes.push("firstTrack");
            }
            if !copied && LOSSY.contains(&a.codec.as_str()) && matches!(target, "flac" | "wav" | "aiff") {
                p.notes.push("noBetter");
            }
            Some(p)
        }
        Class::Video => {
            let v = src.video()?;
            let mut p = base(Engine::Ffmpeg);
            if target == "gif" {
                // 15 fps, at most 480 wide, one palette for the whole clip (§4.4)
                let graph = format!("[0:{}]fps=15,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a[out]", v.index);
                p.args = vec!["-filter_complex".into(), graph, "-map".into(), "[out]".into(), "-an".into(), "-sn".into(), "-loop".into(), "0".into()];
                p.needs.push("gif");
                p.weight = 2;
                p.notes.push("reencode");
                if src.duration > 30.0 {
                    p.notes.push("longGif");
                }
                return Some(p);
            }
            // video: copied when the container holds its codec (MKV holds everything)
            let vfits = match target {
                "mp4" => matches!(v.codec.as_str(), "h264" | "hevc" | "av1"),
                "mov" => matches!(v.codec.as_str(), "h264" | "hevc" | "prores" | "mjpeg"),
                "webm" => matches!(v.codec.as_str(), "vp8" | "vp9" | "av1"),
                "mkv" => true,
                _ => return None,
            };
            p.args = vec!["-map".into(), format!("0:{}", v.index)];
            let audio: Vec<&Stream> = src.audio().collect();
            for a in &audio {
                p.args.extend(["-map".into(), format!("0:{}", a.index)]);
            }
            // subtitles: text ones are converted for MP4/MOV (mov_text) and WebM (WebVTT); pictures only fit MKV
            let subs: Vec<&Stream> = src.streams.iter().filter(|x| x.kind == "subtitle").collect();
            let kept: Vec<&&Stream> = subs.iter().filter(|x| target == "mkv" || TEXT_SUBS.contains(&x.codec.as_str())).collect();
            for x in &kept {
                p.args.extend(["-map".into(), format!("0:{}", x.index)]);
            }
            if target == "mkv" {
                p.args.extend(s(&["-map", "0:t?"]));
            }
            if vfits {
                p.args.extend(s(&["-c:v", "copy"]));
                if target == "mp4" && v.codec == "hevc" {
                    p.args.extend(s(&["-tag:v", "hvc1"]));
                }
            } else if target == "webm" {
                p.args.extend(s(&["-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-row-mt", "1", "-deadline", "good"]));
                p.args.extend(s(&["-pix_fmt", if src.alpha { "yuva420p" } else { "yuv420p" }]));
                p.needs.push("libvpx-vp9");
            } else {
                p.args.extend(s(H264));
                p.needs.push("libx264");
            }
            if !vfits {
                p.args.extend(s(&["-fps_mode", "passthrough"]));
            }
            let mut acopy = true;
            for (k, a) in audio.iter().enumerate() {
                let (codec, copied, need) = audio_in_video(target, a, k);
                p.args.extend(codec);
                acopy &= copied;
                p.needs.extend(need);
            }
            if !kept.is_empty() {
                p.args.extend(s(&["-c:s", match target {
                    "mp4" | "mov" => "mov_text",
                    "webm" => "webvtt",
                    _ => "copy",
                }]));
                if matches!(target, "mp4" | "mov") {
                    p.needs.push("mov_text");
                } else if target == "webm" {
                    p.needs.push("webvtt");
                }
            }
            if target == "mkv" {
                p.args.extend(s(&["-c:t", "copy"]));
            }
            p.args.extend(s(&["-map_metadata", "0"]));
            if matches!(target, "mp4" | "mov") {
                p.args.extend(s(&["-movflags", "+faststart"]));
            }
            p.copy = vfits && acopy;
            p.weight = if vfits { if acopy { 0 } else { 1 } } else { 2 };
            p.notes.push(if p.copy { "copy" } else if vfits { "copyVideo" } else { "reencode" });
            if kept.len() < subs.len() {
                p.notes.push("subsDropped");
            }
            if src.hdr && !vfits {
                p.notes.push("hdr");
            }
            p.needs.sort();
            p.needs.dedup();
            Some(p)
        }
    };
    p
}

/* ===== documents ===== */

/// Which engine makes a document's output: LibreOffice reads and writes office files, Pandoc the markup formats
/// (and reads DOCX, ODT, RTF); PDF from markup goes through a DOCX, Markdown from an old .doc through one too
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    Office,
    Pandoc,
    OfficePandoc,
    PandocOffice,
}

pub(crate) fn route(class: Class, format: &str, target: &str) -> Option<Route> {
    let to_markup = matches!(target, "md" | "html" | "epub");
    Some(match class {
        Class::Document if to_markup => if format == "doc" { Route::OfficePandoc } else { Route::Pandoc },
        Class::Document | Class::Sheet | Class::Slides => Route::Office,
        Class::Markup if target == "pdf" => Route::PandocOffice,
        Class::Markup => Route::Pandoc,
        _ => return None,
    })
}

fn pandoc_reader(format: &str) -> &'static str {
    match format {
        "html" => "html",
        "epub" => "epub",
        "tex" => "latex",
        "org" => "org",
        "dbk" => "docbook",
        "docx" => "docx",
        "odt" => "odt",
        "rtf" => "rtf",
        _ => "markdown",
    }
}

fn pandoc_writer(target: &str) -> &'static str {
    match target {
        "html" => "html5",
        "epub" => "epub3",
        "docx" => "docx",
        "odt" => "odt",
        _ => "gfm",
    }
}

/// LibreOffice's --convert-to: the extension, with the export filter where one input could pick another
fn office_filter(target: &str) -> &'static str {
    match target {
        "docx" => "docx:MS Word 2007 XML",
        "xlsx" => "xlsx:Calc MS Excel 2007 XML",
        "pptx" => "pptx:Impress MS PowerPoint 2007 XML",
        // UTF-8, commas, quoted text
        "csv" => "csv:Text - txt - csv (StarCalc):44,34,76,1",
        t => ext_static(t),
    }
}

/// A folder as a file URL (LibreOffice's -env:UserInstallation)
fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let s: String = s.split('/').map(|c| c.replace('%', "%25").replace(' ', "%20").replace('#', "%23")).collect::<Vec<_>>().join("/");
    if s.starts_with('/') { format!("file://{s}") } else { format!("file:///{s}") }
}

/// One process of a document conversion
#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub tool: &'static str,
    pub args: Vec<String>,
}

/// The steps that turn `input` into `target` inside `work`, and the file the last one leaves. LibreOffice runs with
/// its own profile in the work folder (it does not touch the user's LibreOffice, open or not) and names its output
/// after the input; Pandoc writes where it is told, finding pictures next to the input.
pub(crate) fn doc_steps(class: Class, format: &str, target: &str, input: &Path, work: &Path) -> Option<(Vec<Step>, PathBuf)> {
    let office = |from: &Path, to: &str, outdir: &Path| -> (Step, PathBuf) {
        let mut args = vec![
            format!("-env:UserInstallation={}", file_url(&work.join("lo-profile"))),
            "--headless".into(),
            "--invisible".into(),
            "--norestore".into(),
            "--nolockcheck".into(),
            "--nodefault".into(),
        ];
        if from.extension().is_some_and(|e| e.eq_ignore_ascii_case("csv")) {
            args.push("--infilter=CSV:44,34,76,1".into());
        }
        args.extend(["--convert-to".into(), office_filter(to).into(), "--outdir".into(), outdir.to_string_lossy().into_owned(), from.to_string_lossy().into_owned()]);
        let stem = from.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        (Step { tool: "soffice", args }, outdir.join(format!("{stem}.{}", ext_static(to))))
    };
    let pandoc = |from: &Path, reader: &str, to: &str, out: PathBuf| -> (Step, PathBuf) {
        let mut args = vec![from.to_string_lossy().into_owned(), "-f".into(), reader.into(), "-t".into(), pandoc_writer(to).into(), "-s".into()];
        if let Some(d) = input.parent() {
            args.extend(["--resource-path".into(), d.to_string_lossy().into_owned()]);
        }
        if to == "html" {
            args.push("--embed-resources".into());
        }
        args.extend(["-o".into(), out.to_string_lossy().into_owned()]);
        (Step { tool: "pandoc", args }, out)
    };
    let out_dir = work.join("out");
    let (steps, result) = match route(class, format, target)? {
        Route::Office => {
            let (a, r) = office(input, target, &out_dir);
            (vec![a], r)
        }
        Route::Pandoc => {
            let (a, r) = pandoc(input, pandoc_reader(format), target, out_dir.join(format!("converted.{}", ext_static(target))));
            (vec![a], r)
        }
        Route::OfficePandoc => {
            let (a, mid) = office(input, "docx", &work.join("mid"));
            let (b, r) = pandoc(&mid, "docx", target, out_dir.join(format!("converted.{}", ext_static(target))));
            (vec![a, b], r)
        }
        Route::PandocOffice => {
            let (a, mid) = pandoc(input, pandoc_reader(format), "docx", work.join("mid").join("converted.docx"));
            let (b, r) = office(&mid, target, &out_dir);
            (vec![a, b], r)
        }
    };
    Some((steps, result))
}

/// PDFium, bound once per run (pdfium-render keeps its bindings for the whole process)
fn pdfium(app: &AppHandle) -> Result<pdfium_render::prelude::Pdfium, String> {
    use pdfium_render::prelude::*;
    let lib = find_pdfium(app).ok_or("PDFium is not installed")?;
    match Pdfium::bind_to_library(&lib) {
        Ok(b) => Ok(Pdfium::new(b)),
        Err(PdfiumError::PdfiumLibraryBindingsAlreadyInitialized) => Ok(Pdfium::default()),
        Err(e) => Err(format!("PDFium: {e}")),
    }
}

/// Pages are drawn at 200 dpi (an A4 page is 1654 × 2339), never over 8000 px a side
const PDF_DPI: f32 = 200.0;

pub(crate) fn pdf_pages(pdfium: &pdfium_render::prelude::Pdfium, path: &Path) -> Result<u32, String> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(|e| pdf_error(&e))?;
    Ok(doc.pages().len().max(0) as u32)
}

fn pdf_error(e: &pdfium_render::prelude::PdfiumError) -> String {
    let t = format!("{e:?}");
    if t.contains("Password") { "the PDF is protected with a password".into() } else { format!("PDFium could not read the PDF ({t})") }
}

/// Page `page` (from 0) of a PDF as a PNG or a JPG
pub(crate) fn pdf_page_to(pdfium: &pdfium_render::prelude::Pdfium, path: &Path, page: u32, target: &str, out: &Path) -> Result<(), String> {
    use pdfium_render::prelude::*;
    let doc = pdfium.load_pdf_from_file(path, None).map_err(|e| pdf_error(&e))?;
    let p = doc.pages().get(page as PdfPageIndex).map_err(|e| pdf_error(&e))?;
    let cfg = PdfRenderConfig::new().scale_page_by_factor(PDF_DPI / 72.0).set_maximum_width(8000).set_maximum_height(8000);
    let img = p.render_with_config(&cfg).map_err(|e| pdf_error(&e))?.as_image().map_err(|e| pdf_error(&e))?;
    encode_image(&img, None, target, false, out)
}

/* ===== image ===== */

/// Pictures larger than this are refused (§4.1)
const MAX_SIDE: u32 = 16384;
const MAX_BYTES: u64 = 512 * 1024 * 1024;
const ICO_SIZES: [u32; 4] = [16, 32, 48, 256];

fn limits() -> Limits {
    let mut l = Limits::default();
    l.max_image_width = Some(MAX_SIDE);
    l.max_image_height = Some(MAX_SIDE);
    l.max_alloc = Some(MAX_BYTES);
    l
}

fn decode(path: &Path, named: &str) -> Result<DynamicImage, String> {
    decode_full(path, named).map(|(img, _)| img)
}

/// The picture with its EXIF orientation applied to the pixels, and its ICC profile
fn decode_full(path: &Path, named: &str) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    let mut reader = ImageReader::open(path).map_err(|e| e.to_string())?;
    if named != "tga" {
        reader = reader.with_guessed_format().map_err(|e| e.to_string())?;
    }
    reader.limits(limits());
    let mut dec = reader.into_decoder().map_err(too_big)?;
    let orientation = dec.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let icc = dec.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(dec).map_err(too_big)?;
    img.apply_orientation(orientation);
    Ok((img, icc))
}

fn too_big(e: image::ImageError) -> String {
    match e {
        image::ImageError::Limits(_) => "too big: more than 16384 px a side or 512 MB".into(),
        e => e.to_string(),
    }
}

/// Flattened over white (JPG has no alpha)
fn over_white(img: &DynamicImage) -> image::RgbImage {
    let rgba = img.to_rgba8();
    let mut out = image::RgbImage::new(rgba.width(), rgba.height());
    for (o, p) in out.pixels_mut().zip(rgba.pixels()) {
        let a = p.0[3] as u32;
        for c in 0..3 {
            o.0[c] = ((p.0[c] as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
        }
    }
    out
}

fn has_alpha(img: &DynamicImage) -> bool {
    img.color().has_alpha() && img.to_rgba8().pixels().any(|p| p.0[3] < 255)
}

/// Writes `img` as `target` into `out`; icc: the source's profile, kept where the format holds one
pub(crate) fn encode_image(img: &DynamicImage, icc: Option<Vec<u8>>, target: &str, few: bool, out: &Path) -> Result<(), String> {
    let file = fs::File::create(out).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(file);
    let (width, height) = (img.width(), img.height());
    let err = |e: image::ImageError| e.to_string();
    match target {
        "png" => {
            let mut enc = codecs::png::PngEncoder::new(&mut w);
            if let Some(p) = icc {
                let _ = enc.set_icc_profile(p);
            }
            // PNG keeps 8 or 16 bits per channel; float pictures go to 16
            let img = match img {
                DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgba16(img.to_rgba16()),
                i => i.clone(),
            };
            enc.write_image(img.as_bytes(), width, height, img.color().into()).map_err(err)?;
        }
        "jpg" => {
            let rgb = over_white(img);
            let mut enc = codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 90);
            if let Some(p) = icc {
                let _ = enc.set_icc_profile(p);
            }
            enc.write_image(rgb.as_raw(), width, height, ExtendedColorType::Rgb8).map_err(err)?;
        }
        "webp" => {
            if few {
                // a palette picture: lossless, with its profile
                let rgba = img.to_rgba8();
                let mut enc = codecs::webp::WebPEncoder::new_lossless(&mut w);
                if let Some(p) = icc {
                    let _ = enc.set_icc_profile(p);
                }
                enc.write_image(rgba.as_raw(), width, height, ExtendedColorType::Rgba8).map_err(err)?;
            } else {
                // with loss at quality 90 (libwebp); alpha kept
                let mem = if has_alpha(img) {
                    let rgba = img.to_rgba8();
                    webp::Encoder::from_rgba(rgba.as_raw(), width, height).encode(90.0).to_vec()
                } else {
                    let rgb = img.to_rgb8();
                    webp::Encoder::from_rgb(rgb.as_raw(), width, height).encode(90.0).to_vec()
                };
                if mem.is_empty() {
                    return Err("WebP: the encoder gave nothing".into());
                }
                w.write_all(&mem).map_err(|e| e.to_string())?;
            }
        }
        "tiff" => {
            use tiff::encoder::{colortype, Compression, TiffEncoder};
            let te = |e: tiff::TiffError| e.to_string();
            let mut enc = TiffEncoder::new(&mut w).map_err(te)?.with_compression(Compression::Lzw);
            let alpha = has_alpha(img);
            let sixteen = matches!(img, DynamicImage::ImageLuma16(_) | DynamicImage::ImageLumaA16(_) | DynamicImage::ImageRgb16(_) | DynamicImage::ImageRgba16(_) | DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_));
            macro_rules! put {
                ($ct:ty, $data:expr) => {{
                    let mut im = enc.new_image::<$ct>(width, height).map_err(te)?;
                    if let Some(p) = &icc {
                        im.encoder().write_tag(tiff::tags::Tag::IccProfile, p.as_slice()).map_err(te)?;
                    }
                    im.write_data($data).map_err(te)?;
                }};
            }
            match (sixteen, alpha) {
                (false, false) => put!(colortype::RGB8, img.to_rgb8().as_raw()),
                (false, true) => put!(colortype::RGBA8, img.to_rgba8().as_raw()),
                (true, false) => put!(colortype::RGB16, img.to_rgb16().as_raw()),
                (true, true) => put!(colortype::RGBA16, img.to_rgba16().as_raw()),
            }
        }
        "bmp" => {
            // 24 bits, 32 with alpha
            let mut enc = codecs::bmp::BmpEncoder::new(&mut w);
            if has_alpha(img) {
                enc.encode(img.to_rgba8().as_raw(), width, height, ExtendedColorType::Rgba8).map_err(err)?;
            } else {
                enc.encode(img.to_rgb8().as_raw(), width, height, ExtendedColorType::Rgb8).map_err(err)?;
            }
        }
        "ico" => {
            // square (centred on a transparent canvas), at 16, 32, 48 and 256 px (never larger than the picture,
            // always at least 16)
            let side = width.max(height);
            let mut square = image::RgbaImage::new(side, side);
            image::imageops::overlay(&mut square, &img.to_rgba8(), ((side - width) / 2) as i64, ((side - height) / 2) as i64);
            let mut frames = vec![];
            for (i, &n) in ICO_SIZES.iter().enumerate() {
                if i > 0 && n > side {
                    break;
                }
                let small = image::imageops::resize(&square, n, n, image::imageops::FilterType::Lanczos3);
                let mut png = vec![];
                codecs::png::PngEncoder::new(&mut png).write_image(small.as_raw(), n, n, ExtendedColorType::Rgba8).map_err(err)?;
                frames.push(codecs::ico::IcoFrame::with_encoded(png, n, n, ExtendedColorType::Rgba8).map_err(err)?);
            }
            codecs::ico::IcoEncoder::new(&mut w).encode_images(&frames).map_err(err)?;
        }
        "gif" => {
            // 256 colours (NeuQuant), alpha on or off
            let mut rgba = img.to_rgba8();
            for p in rgba.pixels_mut() {
                p.0[3] = if p.0[3] >= 128 { 255 } else { 0 };
            }
            let mut enc = codecs::gif::GifEncoder::new_with_speed(&mut w, 10);
            enc.encode_frame(image::Frame::new(rgba)).map_err(err)?;
        }
        _ => return Err(format!("unknown output {target}")),
    }
    w.flush().map_err(|e| e.to_string())
}

/// An animated WebP as a GIF, frame by frame with its timing
fn webp_to_gif(path: &Path, out: &Path) -> Result<(), String> {
    use image::AnimationDecoder;
    let file = std::io::BufReader::new(fs::File::open(path).map_err(|e| e.to_string())?);
    let mut dec = codecs::webp::WebPDecoder::new(file).map_err(|e| e.to_string())?;
    dec.set_limits(limits()).map_err(too_big)?;
    let w = BufWriter::new(fs::File::create(out).map_err(|e| e.to_string())?);
    let mut enc = codecs::gif::GifEncoder::new_with_speed(w, 10);
    enc.set_repeat(codecs::gif::Repeat::Infinite).map_err(|e| e.to_string())?;
    for f in dec.into_frames() {
        let mut f = f.map_err(too_big)?;
        for p in f.buffer_mut().pixels_mut() {
            p.0[3] = if p.0[3] >= 128 { 255 } else { 0 };
        }
        enc.encode_frame(f).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The image engine: `path` (a picture, or a decoded AVIF) → `target` written to `out`
pub(crate) fn convert_image_file(path: &Path, target: &str, out: &Path) -> Result<(), String> {
    let named = canonical(&ext_of(&path.to_string_lossy()));
    let src = probe_image(path, &named, 0).ok_or("not a picture Halation can read")?;
    if src.class == Class::Animated && src.format == "webp" && target == "gif" {
        return webp_to_gif(path, out);
    }
    let (img, icc) = decode_full(path, &named)?;
    encode_image(&img, icc, target, src.few_colours, out)
}

/* ===== commands ===== */

/// Output paths reserved by running conversions (their .part files): two jobs never take the same name, and only
/// these are renamed or deleted
#[derive(Default)]
pub struct Reserved(Mutex<HashSet<PathBuf>>);

fn allow(app: &AppHandle, p: &Path) {
    if let Ok(c) = p.canonicalize() {
        hold(&app.state::<Picked>().0).insert(c);
    }
}

/// A file the Converter may read or show: picked by the user, made by it, or inside the Halation folder
fn allowed(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path).canonicalize().map_err(|_| "the file no longer exists".to_string())?;
    if hold(&app.state::<Picked>().0).contains(&p) || inside_base(app, path).is_ok() {
        Ok(p)
    } else {
        Err("path not opened in Halation".into())
    }
}

/// What a file is, and the outputs it can become with what is installed
#[tauri::command]
pub async fn convert_probe(app: AppHandle, path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = allowed(&app, &path)?;
        let ffprobe = find_ffprobe(&app).or_else(|| find_ffmpeg(&app));
        let src = probe(&p, ffprobe.as_deref())?;
        let enc = find_ffmpeg(&app).and_then(|b| encoders(&b));
        let outs = outputs(&src, enc.as_ref());
        let mut v = serde_json::to_value(&src).map_err(|e| e.to_string())?;
        v["outputs"] = serde_json::to_value(outs).map_err(|e| e.to_string())?;
        v["ffmpeg"] = json!(find_ffmpeg(&app).is_some());
        v["have"] = json!({ "ffmpeg": find_ffmpeg(&app).is_some(), "pandoc": find_pandoc(&app).is_some(), "libreoffice": find_soffice(&app).is_some(), "pdfium": find_pdfium(&app).is_some() });
        if src.class == Class::Pdf && find_pdfium(&app).is_some() {
            match pdfium(&app).and_then(|pd| pdf_pages(&pd, &p)) {
                Ok(n) => {
                    v["pages"] = json!(n);
                    let mut counted = src.clone();
                    counted.pages = n;
                    v["outputs"] = serde_json::to_value(outputs(&counted, enc.as_ref())).map_err(|e| e.to_string())?;
                }
                Err(e) => return Err(e),
            }
        }
        Ok(v)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Everything one conversion needs: FFmpeg's full arguments (or the image engine, a document's steps, a PDF's pages),
/// the .part file and the final name. name: the original's name (a dropped file's copy has another); work: the job's
/// work folder (an AVIF is decoded there, documents are made there).
#[derive(serde::Deserialize)]
pub struct Request {
    path: String,
    name: String,
    target: String,
    audio: bool,
    work: Option<String>,
    rel: Option<String>,
}

#[tauri::command]
pub async fn convert_prepare(app: AppHandle, request: Request) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Request { path, name, target, audio, work, rel } = request;
        let input = allowed(&app, &path)?;
        let mut src = probe(&input, find_ffprobe(&app).or_else(|| find_ffmpeg(&app)).as_deref())?;
        let pd = if src.class == Class::Pdf { Some(pdfium(&app)?) } else { None };
        if let Some(pd) = &pd {
            src.pages = pdf_pages(pd, &input)?;
        }
        let plan = plan(&src, &target, audio).ok_or("this file cannot become that format")?;
        let stem = Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        // a PDF of several pages becomes a folder of pictures named after it
        let pages_dir = plan.engine == Engine::Pdf && src.pages > 1;
        let filename = clean_filename(&if pages_dir { stem.clone() } else { format!("{stem}.{}", plan.ext) });
        let filename = if stem.is_empty() { if pages_dir { "converted".into() } else { format!("converted.{}", plan.ext) } } else { filename };
        let Some(out) = crate::save_location::resolve_in(&app, &filename, Some("converted"), rel.as_deref())? else { return Ok(Value::Null) };
        if out == input { return Err("Choose a destination different from the source".into()); }
        if !hold(&app.state::<Reserved>().0).insert(out.clone()) { return Err("This destination is already being exported".into()); }
        let part = PathBuf::from(format!("{}.part", out.display()));
        if pages_dir {
            fs::create_dir_all(&part).map_err(|e| e.to_string())?;
        }
        let mut v = json!({
            "engine": plan.engine, "out": out.to_string_lossy(), "part": part.to_string_lossy(), "notes": plan.notes,
            "copy": plan.copy, "weight": plan.weight, "duration": src.duration, "class": src.class,
        });
        if plan.engine == Engine::Ffmpeg {
            let mut args = s(&["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i"]);
            args.push(input.to_string_lossy().into_owned());
            args.extend(plan.args);
            args.extend(["-f".into(), plan.muxer.into(), part.to_string_lossy().into_owned()]);
            v["args"] = json!(args);
        } else if plan.engine == Engine::Docs {
            let work = PathBuf::from(work.ok_or("no work folder")?);
            if !crate::workspace::inside(&app, &work.canonicalize().map_err(|e| e.to_string())?) {
                return Err("work folder outside the workspace".into());
            }
            let (steps, result) = doc_steps(src.class, &src.format, &target, &input, &work).ok_or("this file cannot become that format")?;
            for d in ["out", "mid"] {
                fs::create_dir_all(work.join(d)).map_err(|e| e.to_string())?;
            }
            v["steps"] = json!(steps);
            v["result"] = json!(result.to_string_lossy());
        } else if plan.engine == Engine::Pdf {
            v["source"] = json!(input.to_string_lossy());
            v["pages"] = json!(src.pages);
            v["folder"] = json!(pages_dir);
        } else if plan.decode {
            let work = PathBuf::from(work.ok_or("no work folder")?);
            if !crate::workspace::inside(&app, &work.canonicalize().map_err(|e| e.to_string())?) {
                return Err("work folder outside the workspace".into());
            }
            let png = work.join("decoded.png");
            v["decode"] = json!(["-hide_banner", "-nostdin", "-y", "-i", input.to_string_lossy(), "-frames:v", "1", "-c:v", "png", "-f", "image2", png.to_string_lossy()]);
            v["source"] = json!(png.to_string_lossy());
        } else {
            v["source"] = json!(input.to_string_lossy());
        }
        Ok(v)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn reserved_part(app: &AppHandle, part: &str) -> Result<PathBuf, String> {
    let out = PathBuf::from(part.strip_suffix(".part").ok_or("not a conversion")?);
    if hold(&app.state::<Reserved>().0).contains(&out) {
        Ok(out)
    } else {
        Err("not a conversion in progress".into())
    }
}

/// The image engine on a prepared conversion: `source` (the picture, or the decoded AVIF) into its .part
#[tauri::command]
pub async fn convert_image(app: AppHandle, source: String, target: String, part: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reserved_part(&app, &part)?;
        let src = allowed(&app, &source)?;
        convert_image_file(&src, &target, Path::new(&part))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One page of a prepared PDF conversion: into the .part file, or into the .part folder as "name-001.png"
#[tauri::command]
pub async fn convert_pdf_page(app: AppHandle, source: String, target: String, part: String, page: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = reserved_part(&app, &part)?;
        let src = allowed(&app, &source)?;
        let pd = pdfium(&app)?;
        let part = PathBuf::from(&part);
        let file = if part.is_dir() {
            let stem = out.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            part.join(format!("{stem}-{:03}.{}", page + 1, ext_static(&target)))
        } else {
            part
        };
        pdf_page_to(&pd, &src, page, &target, &file)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A PDF's first page for the preview, as a PNG at most 1400 px wide
#[tauri::command]
pub async fn convert_pdf_preview(app: AppHandle, path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use pdfium_render::prelude::*;
        let src = allowed(&app, &path)?;
        let pd = pdfium(&app)?;
        let doc = pd.load_pdf_from_file(&src, None).map_err(|e| pdf_error(&e))?;
        let p = doc.pages().get(0).map_err(|e| pdf_error(&e))?;
        let cfg = PdfRenderConfig::new().set_target_width(1400).set_maximum_height(2000);
        let img = p.render_with_config(&cfg).map_err(|e| pdf_error(&e))?.as_image().map_err(|e| pdf_error(&e))?;
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        Ok(Response::new(png.into_inner()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves a file, across drives too (a document made in the workspace, saved next to its original)
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(from);
    Ok(())
}

/// The .part becomes the output (never over an existing file): {path, size, files}. from: what a document's last
/// step left in the work folder, moved in first. A folder of pages lists its pictures in files.
#[tauri::command]
pub fn convert_finish(app: AppHandle, part: String, from: Option<String>) -> Result<Value, String> {
    let out = reserved_part(&app, &part)?;
    if let Some(from) = from {
        let f = PathBuf::from(&from);
        let ok = f.canonicalize().is_ok_and(|c| crate::workspace::inside(&app, &c));
        if !ok {
            hold(&app.state::<Reserved>().0).remove(&out);
            return Err("the conversion wrote nothing".into());
        }
        move_file(&f, Path::new(&part))?;
    }
    let meta = fs::metadata(&part).map_err(|_| "the conversion wrote nothing".to_string())?;
    let mut files: Vec<PathBuf> = vec![];
    if meta.is_dir() {
        files = fs::read_dir(&part).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        if files.is_empty() {
            return Err("the conversion wrote nothing".into());
        }
    }
    let size = if meta.is_dir() { files.iter().filter_map(|f| fs::metadata(f).ok()).map(|m| m.len()).sum() } else { meta.len() };
    let final_path = out.clone();
    let result = fs::rename(&part, &final_path).map_err(|e| e.to_string());
    hold(&app.state::<Reserved>().0).remove(&out);
    result?;
    allow(&app, &final_path);
    let files: Vec<PathBuf> = files.iter().filter_map(|f| f.file_name()).map(|n| final_path.join(n)).collect();
    for f in &files {
        allow(&app, f);
    }
    Ok(json!({ "path": final_path.to_string_lossy(), "size": size, "files": files }))
}

/// A cancelled or failed conversion: its .part goes
#[tauri::command]
pub fn convert_discard(app: AppHandle, part: String) -> Result<(), String> {
    let out = reserved_part(&app, &part)?;
    if Path::new(&part).is_dir() {
        let _ = fs::remove_dir_all(&part);
    } else {
        let _ = fs::remove_file(&part);
    }
    hold(&app.state::<Reserved>().0).remove(&out);
    Ok(())
}

/// Files, or every file of a folder (with its relative folder), from the system's dialog: [{path, name, rel}]
#[tauri::command]
pub fn convert_pick(app: AppHandle, folder: bool, kind: Option<String>) -> Vec<Value> {
    let mut out = vec![];
    if folder {
        if let Some(root) = rfd::FileDialog::new().pick_folder() {
            walk(&root, &root, 0, &mut out);
        }
    } else if let Some(files) = pick_filter(kind.as_deref()).map_or_else(rfd::FileDialog::new, |(name, ext)| rfd::FileDialog::new().add_filter(name, ext).add_filter("All files", &["*"])).pick_files() {
        out.extend(files.into_iter().map(|p| (p, String::new())));
    }
    out.into_iter()
        .take(2000)
        .map(|(p, rel)| {
            allow(&app, &p);
            json!({ "path": p.to_string_lossy(), "name": p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), "rel": rel })
        })
        .collect()
}

/// The start screen's buttons: the dialog shows only that kind of file (and "All files" one click away)
fn pick_filter(kind: Option<&str>) -> Option<(&'static str, &'static [&'static str])> {
    const DOCS: &[&str] = &["docx", "doc", "odt", "rtf", "md", "markdown", "html", "htm", "xhtml", "epub", "tex", "latex", "org", "dbk"];
    const OFFICE: &[&str] = &["xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp"];
    Some(match kind? {
        "video" => ("Video", VIDEO_EXT),
        "audio" => ("Audio", AUDIO_EXT),
        "image" => ("Images", IMAGE_EXT),
        "docs" => ("Documents", DOCS),
        "office" => ("Spreadsheets and presentations", OFFICE),
        "pdf" => ("PDF", &["pdf"]),
        _ => return None,
    })
}

/// The files of a folder, eight levels deep at most, hidden ones and partial conversions left out
fn walk(root: &Path, d: &Path, depth: u32, out: &mut Vec<(PathBuf, String)>) {
    let Ok(rd) = fs::read_dir(d) else { return };
    let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.starts_with('.') || name.ends_with(".part") || out.len() >= 2000 {
            continue;
        }
        if p.is_dir() {
            if depth < 8 {
                walk(root, &p, depth + 1, out);
            }
        } else if p.is_file() {
            let rel = p.parent().and_then(|x| x.strip_prefix(root).ok()).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let top = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            out.push((p.clone(), if rel.is_empty() { top } else { format!("{top}/{rel}") }));
        }
    }
}

/// The bytes of a file the Converter opened or made (a thumbnail, "Send to…")
#[tauri::command]
pub fn convert_read(app: AppHandle, path: String) -> Result<Response, String> {
    let p = allowed(&app, &path)?;
    Ok(Response::new(fs::read(p).map_err(|e| e.to_string())?))
}

/// "Open folder" for an output, wherever it went
#[tauri::command]
pub fn convert_reveal(app: AppHandle, path: String) -> Result<(), String> {
    allowed(&app, &path)?;
    crate::files::reveal_path(app, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(index: u32, kind: &str, codec: &str) -> Stream {
        Stream { index, kind: kind.into(), codec: codec.into(), ..Default::default() }
    }
    fn media(class: Class, format: &str, streams: Vec<Stream>) -> Source {
        let mut s = Source::empty(class, format, format, 1);
        s.streams = streams;
        s.duration = 10.0;
        s
    }
    fn ids(v: &[Output]) -> Vec<&str> {
        v.iter().map(|o| o.id).collect()
    }
    fn has(p: &Plan, pair: &[&str]) -> bool {
        p.args.windows(pair.len()).any(|w| w.iter().zip(pair).all(|(a, b)| a == b))
    }

    #[test]
    fn same_format_is_not_offered() {
        let png = Source::empty(Class::Image, "png", "png", 1);
        assert_eq!(ids(&outputs(&png, None)), ["jpg", "webp", "tiff", "bmp", "ico", "gif"]);
        let mp3 = media(Class::Audio, "mp3", vec![stream(0, "audio", "mp3")]);
        assert_eq!(ids(&outputs(&mp3, None)), ["m4a", "flac", "wav", "ogg", "opus", "aiff"]);
    }

    #[test]
    fn images_go_through_rust() {
        let mut png = Source::empty(Class::Image, "png", "png", 1);
        png.alpha = true;
        let p = plan(&png, "jpg", false).unwrap();
        assert_eq!((p.engine, p.notes.as_slice()), (Engine::Image, &["white"][..]));
        assert!(plan(&png, "webp", false).unwrap().notes.is_empty());
        let avif = Source::empty(Class::Image, "avif", "avif", 1);
        let p = plan(&avif, "png", false).unwrap();
        assert!(p.decode && p.engine == Engine::Image);
        assert!(outputs(&avif, None).iter().all(|o| o.ffmpeg));
        assert!(outputs(&png, None).iter().all(|o| !o.ffmpeg));
    }

    #[test]
    fn animated_rows() {
        let gif = Source { frames: 2, alpha: true, ..Source::empty(Class::Animated, "gif", "gif", 1) };
        assert_eq!(ids(&outputs(&gif, None)), ["mp4", "webm", "webp", "png"]);
        let mp4 = plan(&gif, "mp4", false).unwrap();
        assert!(has(&mp4, &["-c:v", "libx264"]) && has(&mp4, &["-pix_fmt", "yuv420p"]));
        assert!(has(&plan(&gif, "webm", false).unwrap(), &["-pix_fmt", "yuva420p"]));
        assert!(has(&plan(&gif, "webp", false).unwrap(), &["-c:v", "libwebp_anim"]));
        assert_eq!(plan(&gif, "png", false).unwrap().notes, ["firstFrame"]);
        let webp = Source { frames: 2, ..Source::empty(Class::Animated, "webp", "webp", 1) };
        assert_eq!(ids(&outputs(&webp, None)), ["gif", "png"]);
    }

    #[test]
    fn audio_rows() {
        let wav = media(Class::Audio, "wav", vec![Stream { bits: 24, channels: 2, rate: 96000, ..stream(0, "audio", "pcm_s24le") }]);
        let mp3 = plan(&wav, "mp3", false).unwrap();
        assert!(has(&mp3, &["-c:a:0", "libmp3lame"]) && has(&mp3, &["-q:a:0", "0"]) && has(&mp3, &["-ar:a:0", "48000"]));
        let flac = plan(&wav, "flac", false).unwrap();
        assert!(has(&flac, &["-sample_fmt:a:0", "s32"]) && has(&flac, &["-bits_per_raw_sample", "24"]));
        assert!(has(&plan(&wav, "aiff", false).unwrap(), &["-c:a:0", "pcm_s24be"]));
        assert!(has(&plan(&wav, "m4a", false).unwrap(), &["-b:a:0", "256k"]));
        assert!(has(&plan(&wav, "ogg", false).unwrap(), &["-q:a:0", "6"]));
        assert!(has(&plan(&wav, "opus", false).unwrap(), &["-b:a:0", "160k"]));
        // copies
        let m4a = media(Class::Audio, "m4a", vec![stream(0, "audio", "aac"), Stream { cover: true, ..stream(1, "video", "mjpeg") }]);
        let p = plan(&m4a, "m4a", false).unwrap();
        assert!(p.copy && p.notes == ["copy"]);
        let mp3 = plan(&m4a, "mp3", false).unwrap();
        assert!(has(&mp3, &["-map", "0:1"]) && has(&mp3, &["-disposition:v:0", "attached_pic"]));
        assert!(!has(&plan(&m4a, "ogg", false).unwrap(), &["-map", "0:1"]));
        // lossy into lossless: allowed, said
        assert_eq!(plan(&m4a, "flac", false).unwrap().notes, ["reencodeAudio", "noBetter"]);
        assert!(has(&plan(&m4a, "wav", false).unwrap(), &["-c:a:0", "pcm_s16le"]));
        let surround = media(Class::Audio, "flac", vec![Stream { channels: 6, ..stream(0, "audio", "flac") }]);
        assert!(has(&plan(&surround, "mp3", false).unwrap(), &["-ac:a:0", "2"]));
        assert!(has(&plan(&surround, "opus", false).unwrap(), &["-mapping_family", "1"]));
    }

    #[test]
    fn video_rows() {
        let mkv = media(Class::Video, "mkv", vec![Stream { width: 1920, height: 1080, ..stream(0, "video", "h264") }, stream(1, "audio", "aac")]);
        assert_eq!(ids(&outputs(&mkv, None)), ["mp4", "webm", "mov", "gif", "mp3", "m4a", "flac", "wav", "opus"]);
        let p = plan(&mkv, "mp4", false).unwrap();
        assert!(p.copy && has(&p, &["-c:v", "copy"]) && has(&p, &["-c:a:0", "copy"]) && p.notes == ["copy"] && p.weight == 0);
        let p = plan(&mkv, "webm", false).unwrap();
        assert!(has(&p, &["-c:v", "libvpx-vp9"]) && has(&p, &["-c:a:0", "libopus"]) && p.notes == ["reencode"] && p.weight == 2);
        let m4a = plan(&mkv, "m4a", true).unwrap();
        assert!(m4a.copy && has(&m4a, &["-vn"]));
        // MKV (H.264 + FLAC + PGS) → MP4: video copied, audio to AAC, the picture subtitles dropped and said (§11.3)
        let mut src = media(Class::Video, "mkv", vec![stream(0, "video", "h264"), stream(1, "audio", "flac"), stream(2, "subtitle", "hdmv_pgs_subtitle"), stream(3, "subtitle", "subrip")]);
        let p = plan(&src, "mp4", false).unwrap();
        assert!(has(&p, &["-c:v", "copy"]) && has(&p, &["-c:a:0", "aac"]) && has(&p, &["-map", "0:3"]) && !has(&p, &["-map", "0:2"]) && has(&p, &["-c:s", "mov_text"]));
        assert_eq!(p.notes, ["copyVideo", "subsDropped"]);
        assert!(has(&plan(&src, "mkv", false).unwrap(), &["-map", "0:2"]) || src.format == "mkv");
        src.format = "mp4".into();
        let k = plan(&src, "mkv", false).unwrap();
        assert!(k.copy && has(&k, &["-map", "0:2"]) && has(&k, &["-map", "0:t?"]));
        // HEVC keeps its Apple tag; HDR into H.264 is said
        let mut hdr = media(Class::Video, "mkv", vec![stream(0, "video", "vp9"), stream(1, "audio", "opus")]);
        hdr.hdr = true;
        let p = plan(&hdr, "mp4", false).unwrap();
        assert!(has(&p, &["-c:v", "libx264"]) && has(&p, &["-c:a:0", "aac"]) && p.notes.contains(&"hdr"));
        let hevc = media(Class::Video, "mkv", vec![stream(0, "video", "hevc")]);
        assert!(has(&plan(&hevc, "mp4", false).unwrap(), &["-tag:v", "hvc1"]));
        // GIF: 15 fps, 480 wide at most, the long ones said
        let mut long = media(Class::Video, "mp4", vec![stream(0, "video", "h264")]);
        long.duration = 45.0;
        let g = plan(&long, "gif", false).unwrap();
        assert!(g.args.iter().any(|a| a.contains("fps=15") && a.contains("min(480,iw)") && a.ends_with("[out]")) && has(&g, &["-map", "[out]"]));
        assert_eq!(g.notes, ["reencode", "longGif"]);
        // no audio: no "Audio only" outputs
        assert!(outputs(&long, None).iter().all(|o| !o.audio));
    }

    #[test]
    fn missing_encoders_hide_outputs() {
        let wav = media(Class::Audio, "wav", vec![stream(0, "audio", "pcm_s16le")]);
        let enc: HashSet<String> = ["libmp3lame", "aac", "flac", "pcm_s16le", "pcm_s16be", "libopus"].iter().map(|s| s.to_string()).collect();
        assert_eq!(ids(&outputs(&wav, Some(&enc))), ["mp3", "m4a", "flac", "opus", "aiff"]);
        let list = " V....D libx264              libx264 H.264\n";
        assert!(parse_encoders(&format!("Encoders:\n ------\n{list} A....D aac  AAC\n")).contains("aac"));
    }

    #[test]
    fn ffmpeg_info() {
        let text = "Input #0, wav, from 'a.wav':\n  Duration: 00:01:02.50, bitrate: 2116 kb/s\n  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s32 (24 bit), 2116 kb/s\n";
        let s = from_ffprobe(&from_ffmpeg_info(text).unwrap(), "wav", 1);
        assert_eq!((s.class, s.format.as_str(), s.duration), (Class::Audio, "wav", 62.5));
        let a = &s.streams[0];
        assert_eq!((a.codec.as_str(), a.rate, a.channels, a.bits), ("pcm_s24le", 44100, 2, 24));
        let text = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'b.mp4':\n  Duration: 00:00:10.00, start: 0.000000, bitrate: 5000 kb/s\n  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160 [SAR 1:1 DAR 16:9], 4800 kb/s, 25 fps\n  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, 5.1, fltp, 384 kb/s\n  Stream #0:2: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500, 90k tbn (attached pic)\n";
        let s = from_ffprobe(&from_ffmpeg_info(text).unwrap(), "mp4", 1);
        assert_eq!((s.class, s.format.as_str(), s.width, s.height, s.hdr), (Class::Video, "mp4", 3840, 2160, true));
        assert_eq!((s.streams[1].channels, s.streams[1].lang.as_str(), s.streams[1].float), (6, "eng", true));
        assert!(s.streams[2].cover);
        assert!(from_ffmpeg_info("a.txt: Invalid data found when processing input").is_none());
    }

    /// Audio or video found without FFmpeg still lists its outputs (the card offers the install)
    #[test]
    fn unprobed_media_lists_outputs() {
        let mut wav = Source::empty(Class::Audio, "wav", "wav", 1);
        wav.needs_ffmpeg = true;
        assert_eq!(outputs(&wav, None).iter().map(|o| o.id).collect::<Vec<_>>(), ["mp3", "m4a", "flac", "ogg", "opus", "aiff"]);
        let mut mov = Source::empty(Class::Video, "mov", "mov", 1);
        mov.needs_ffmpeg = true;
        assert!(outputs(&mov, None).iter().all(|o| o.ffmpeg) && outputs(&mov, None).len() > 4);
    }

    #[test]
    fn ffprobe_json() {
        let v = json!({ "streams": [
            { "index": 0, "codec_type": "audio", "codec_name": "pcm_s16le", "sample_fmt": "s16", "channels": 2, "sample_rate": "44100" }
        ], "format": { "format_name": "wav", "duration": "3.5" } });
        let s = from_ffprobe(&v, "mp3", 10);
        assert_eq!((s.class, s.format.as_str(), s.mismatch, s.duration), (Class::Audio, "wav", true, 3.5));
        let v = json!({ "streams": [
            { "index": 0, "codec_type": "video", "codec_name": "h264", "width": 640, "height": 360, "pix_fmt": "yuv420p" },
            { "index": 1, "codec_type": "video", "codec_name": "mjpeg", "disposition": { "attached_pic": 1 } }
        ], "format": { "format_name": "matroska,webm" } });
        let s = from_ffprobe(&v, "mkv", 10);
        assert_eq!((s.class, s.format.as_str(), s.mismatch, s.width), (Class::Video, "mkv", false, 640));
        let v = json!({ "streams": [{ "index": 0, "codec_type": "audio", "codec_name": "aac" }, { "index": 1, "codec_type": "video", "codec_name": "png", "disposition": { "attached_pic": 1 } }], "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" } });
        assert_eq!(from_ffprobe(&v, "m4a", 1).class, Class::Audio);
        assert!(heif_brand(b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf").is_some());
    }

    /// Real files: PNG with alpha → JPG over white, → WebP keeps alpha; an EXIF orientation 6 JPG comes out upright;
    /// ICO is square at its sizes; a picture too big is refused
    #[test]
    fn image_engine() {
        let d = std::env::temp_dir().join(format!("halation-convert-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let mut img = image::RgbaImage::new(40, 20);
        for (x, _, p) in img.enumerate_pixels_mut() {
            *p = if x < 20 { image::Rgba([255, 0, 0, 255]) } else { image::Rgba([0, 0, 255, 0]) };
        }
        let png = d.join("a.png");
        img.save(&png).unwrap();
        let src = probe(&png, None).unwrap();
        assert!(src.alpha && src.few_colours && src.class == Class::Image);
        for t in ["jpg", "webp", "tiff", "bmp", "ico", "gif"] {
            let out = d.join(format!("a.{t}.part"));
            convert_image_file(&png, t, &out).unwrap();
            assert!(fs::metadata(&out).unwrap().len() > 0, "{t}");
        }
        let jpg = image::load_from_memory(&fs::read(d.join("a.jpg.part")).unwrap()).unwrap().to_rgb8();
        assert!(jpg.get_pixel(35, 10).0.iter().all(|&c| c > 240), "transparent becomes white");
        let webp = image::load_from_memory(&fs::read(d.join("a.webp.part")).unwrap()).unwrap().to_rgba8();
        assert_eq!(webp.get_pixel(35, 10).0[3], 0, "WebP keeps alpha");
        let ico = image::load_from_memory_with_format(&fs::read(d.join("a.ico.part")).unwrap(), ImageFormat::Ico).unwrap();
        assert_eq!(ico.width(), ico.height());
        // lossy WebP for a photo-like picture
        let mut photo = image::RgbImage::new(64, 64);
        for (x, y, p) in photo.enumerate_pixels_mut() {
            *p = image::Rgb([(x * 4) as u8, (y * 4) as u8, ((x * y) % 256) as u8]);
        }
        let photo_png = d.join("photo.png");
        photo.save(&photo_png).unwrap();
        assert!(!probe(&photo_png, None).unwrap().few_colours);
        convert_image_file(&photo_png, "webp", &d.join("photo.webp")).unwrap();
        assert_eq!(&fs::read(d.join("photo.webp")).unwrap()[12..16], b"VP8 ", "lossy WebP");
        // EXIF orientation 6 (rotate 90° clockwise): a 40×20 JPG comes out 20×40
        let mut jpg_bytes = vec![];
        codecs::jpeg::JpegEncoder::new(&mut jpg_bytes).write_image(over_white(&DynamicImage::ImageRgba8(img.clone())).as_raw(), 40, 20, ExtendedColorType::Rgb8).unwrap();
        let exif: Vec<u8> = [b"Exif\0\0MM\0\x2a\0\0\0\x08\0\x01".as_slice(), &[0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0], &[0, 0, 0, 0]].concat();
        let mut app1 = vec![0xFF, 0xE1];
        app1.extend(((exif.len() + 2) as u16).to_be_bytes());
        app1.extend(exif);
        let rotated: Vec<u8> = [&jpg_bytes[..2], &app1[..], &jpg_bytes[2..]].concat();
        let rjpg = d.join("r.jpg");
        fs::write(&rjpg, rotated).unwrap();
        convert_image_file(&rjpg, "png", &d.join("r.png")).unwrap();
        let r = image::open(d.join("r.png")).unwrap();
        assert_eq!((r.width(), r.height()), (20, 40));
        // a .mp3 that is a PNG is read as what it is
        let liar = d.join("liar.mp3");
        fs::copy(&png, &liar).unwrap();
        let s = probe(&liar, None).unwrap();
        assert_eq!((s.format.as_str(), s.mismatch), ("png", true));
        let _ = fs::remove_dir_all(&d);
    }

    /// The plans run by the real FFmpeg (skipped where there is none): copies stay copies, re-encodes play
    #[test]
    fn ffmpeg_plans_run() {
        let (Some(ff), Some(fp)) = (on_path("ffmpeg"), on_path("ffprobe")) else { return };
        let d = std::env::temp_dir().join(format!("halation-convert-ff-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let run = |args: &[String]| assert!(Command::new(&ff).args(args).output().unwrap().status.success(), "{args:?}");
        let mkv = d.join("in.mkv");
        run(&s(&["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-y", &mkv.to_string_lossy()]));
        let src = probe(&mkv, Some(&fp)).unwrap();
        assert_eq!((src.class, src.format.as_str()), (Class::Video, "mkv"));
        let enc = encoders(&ff).unwrap();
        for o in outputs(&src, Some(&enc)) {
            let p = plan(&src, o.id, o.audio).unwrap();
            let out = d.join(format!("out-{}-{}.{}.part", o.id, o.audio, p.ext));
            let mut args = s(&["-v", "error", "-nostdin", "-y", "-i", &mkv.to_string_lossy()]);
            args.extend(p.args.clone());
            args.extend(["-f".into(), p.muxer.into(), out.to_string_lossy().into_owned()]);
            run(&args);
            let back = probe(&out, Some(&fp)).unwrap();
            let want = if o.audio { Class::Audio } else if o.id == "gif" { Class::Animated } else { Class::Video };
            assert!(back.class == want || (o.id == "gif" && back.class == Class::Unsupported), "{} → {:?}", o.id, back.class);
        }
        let wav = d.join("in.wav");
        run(&s(&["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s24le", "-y", &wav.to_string_lossy()]));
        let src = probe(&wav, Some(&fp)).unwrap();
        let alone = probe(&wav, Some(&ff)).unwrap();
        assert_eq!((alone.class, alone.format.as_str(), alone.streams[0].bits), (src.class, src.format.as_str(), src.streams[0].bits), "read by ffmpeg alone");
        for o in outputs(&src, Some(&enc)) {
            let p = plan(&src, o.id, false).unwrap();
            let out = d.join(format!("a.{}.part", p.ext));
            let mut args = s(&["-v", "error", "-nostdin", "-y", "-i", &wav.to_string_lossy()]);
            args.extend(p.args.clone());
            args.extend(["-f".into(), p.muxer.into(), out.to_string_lossy().into_owned()]);
            run(&args);
            let back = probe(&out, Some(&fp)).unwrap();
            assert_eq!(back.class, Class::Audio, "{}", o.id);
            if o.id == "flac" {
                assert_eq!(back.streams[0].bits, 24, "24 bits kept");
            }
        }
        let _ = fs::remove_dir_all(&d);
    }

    /// Documents are told by their content: the parts of a zip, PDF and RTF signatures; text formats by name
    #[test]
    fn documents_are_detected() {
        let d = std::env::temp_dir().join(format!("halation-convert-docs-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let zip_with = |name: &str, parts: &[(&str, &str)]| {
            let p = d.join(name);
            let mut z = zip::ZipWriter::new(fs::File::create(&p).unwrap());
            for (n, body) in parts {
                z.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
                z.write_all(body.as_bytes()).unwrap();
            }
            z.finish().unwrap();
            p
        };
        let cases = [
            (zip_with("a.docx", &[("[Content_Types].xml", "x"), ("word/document.xml", "x")]), Class::Document, "docx"),
            (zip_with("b.xlsx", &[("xl/workbook.xml", "x")]), Class::Sheet, "xlsx"),
            (zip_with("c.pptx", &[("ppt/presentation.xml", "x")]), Class::Slides, "pptx"),
            (zip_with("d.odt", &[("mimetype", "application/vnd.oasis.opendocument.text")]), Class::Document, "odt"),
            (zip_with("e.epub", &[("mimetype", "application/epub+zip")]), Class::Markup, "epub"),
            // a DOCX named .odt is a DOCX
            (zip_with("f.odt", &[("word/document.xml", "x")]), Class::Document, "docx"),
        ];
        for (p, class, format) in cases {
            let s = probe(&p, None).unwrap();
            assert_eq!((s.class, s.format.as_str()), (class, format), "{}", p.display());
        }
        assert!(probe(&d.join("f.odt"), None).unwrap().mismatch);
        let write = |name: &str, body: &[u8]| {
            let p = d.join(name);
            fs::write(&p, body).unwrap();
            probe(&p, None).unwrap()
        };
        assert_eq!(write("g.pdf", b"%PDF-1.7\n").class, Class::Pdf);
        assert_eq!(write("h.rtf", b"{\\rtf1\\ansi hi}").format, "rtf");
        assert_eq!((write("i.markdown", b"# Title\n").class, write("i.markdown", b"# Title\n").format.as_str()), (Class::Markup, "md"));
        assert_eq!(write("j.csv", b"a,b\n1,2\n").class, Class::Sheet);
        assert_eq!(write("k.htm", b"<html></html>").format, "html");
        // a zip that is no document, and text with another name, are not documents
        assert_eq!(probe(&zip_with("l.zip", &[("x.txt", "x")]), None).unwrap().class, Class::Unsupported);
        assert_eq!(write("m.txt", b"hello").class, Class::Unsupported);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn document_rows_and_routes() {
        let ids = |class, format: &str| outputs(&Source::empty(class, format, format, 1), None).iter().map(|o| o.id).collect::<Vec<_>>();
        assert_eq!(ids(Class::Document, "docx"), ["pdf", "odt", "rtf", "md", "html", "epub"]);
        assert_eq!(ids(Class::Sheet, "csv"), ["pdf", "xlsx", "ods"]);
        assert_eq!(ids(Class::Slides, "pptx"), ["pdf", "odp"]);
        assert_eq!(ids(Class::Markup, "md"), ["html", "docx", "odt", "epub", "pdf"]);
        assert_eq!(ids(Class::Pdf, "pdf"), ["png", "jpg"]);
        let out = |class, format: &str, target| outputs(&Source::empty(class, format, format, 1), None).into_iter().find(|o| o.id == target).unwrap();
        assert_eq!(out(Class::Markup, "md", "pdf").tools, ["libreoffice", "pandoc"]);
        assert_eq!(out(Class::Document, "doc", "md").tools, ["libreoffice", "pandoc"]);
        assert_eq!(out(Class::Document, "docx", "md").tools, ["pandoc"]);
        assert_eq!(out(Class::Document, "docx", "md").notes, ["structure", "noPictures"]);
        assert_eq!(out(Class::Document, "docx", "odt").notes, ["layout"]);
        assert!(out(Class::Document, "docx", "pdf").notes.is_empty());
        assert_eq!(out(Class::Sheet, "xlsx", "csv").notes, ["layout", "firstSheet"]);
        assert_eq!(out(Class::Pdf, "pdf", "png").tools, ["pdfium"]);
        // steps: LibreOffice with its own profile, output named after the input; Pandoc where it is told
        let (st, r) = doc_steps(Class::Markup, "md", "pdf", Path::new("/in/My notes.md"), Path::new("/w")).unwrap();
        assert_eq!(st.iter().map(|x| x.tool).collect::<Vec<_>>(), ["pandoc", "soffice"]);
        assert!(st[0].args.windows(2).any(|w| w == ["-t", "docx"]));
        assert!(st[1].args[0].starts_with("-env:UserInstallation=file:///w/lo-profile"));
        assert_eq!(r, Path::new("/w/out/converted.pdf"));
        let (st, r) = doc_steps(Class::Sheet, "csv", "xlsx", Path::new("/in/t.csv"), Path::new("/w")).unwrap();
        assert!(st[0].args.contains(&"--infilter=CSV:44,34,76,1".to_string()) && st[0].args.contains(&"xlsx:Calc MS Excel 2007 XML".to_string()));
        assert_eq!(r, Path::new("/w/out/t.xlsx"));
        assert_eq!(file_url(Path::new("C:\\Users\\A B\\w")), "file:///C:/Users/A%20B/w");
    }

    /// The real engines, where this machine has them: Markdown → DOCX → PDF → PNG pages, CSV → XLSX
    #[test]
    fn document_engines_run() {
        let (Some(pandoc), Some(soffice)) = (on_path("pandoc"), on_path("soffice")) else { return };
        let d = std::env::temp_dir().join(format!("halation-convert-docrun-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let run = |steps: Vec<Step>| {
            for st in steps {
                let bin = if st.tool == "pandoc" { &pandoc } else { &soffice };
                let o = Command::new(bin).args(&st.args).output().unwrap();
                assert!(o.status.success(), "{} {:?}: {}", st.tool, st.args, String::from_utf8_lossy(&o.stderr));
            }
        };
        let md = d.join("notes.md");
        fs::write(&md, "# Title\n\nSome *text*.\n\n- one\n- two\n\n\\newpage\n\nSecond page.\n").unwrap();
        for target in ["docx", "html", "pdf"] {
            let work = d.join(format!("w-{target}"));
            for x in ["out", "mid"] {
                fs::create_dir_all(work.join(x)).unwrap();
            }
            let (steps, result) = doc_steps(Class::Markup, "md", target, &md, &work).unwrap();
            run(steps);
            let back = probe(&result, None).unwrap();
            let want = match target { "docx" => Class::Document, "html" => Class::Markup, _ => Class::Pdf };
            assert_eq!(back.class, want, "{target}");
            if target == "pdf" {
                if let Ok(lib) = std::env::var("PDFIUM_TEST_LIB") {
                    use pdfium_render::prelude::*;
                    let pd = Pdfium::new(Pdfium::bind_to_library(lib).unwrap());
                    assert!(pdf_pages(&pd, &result).unwrap() >= 1);
                    let png = d.join("page.png");
                    pdf_page_to(&pd, &result, 0, "png", &png).unwrap();
                    let img = image::open(&png).unwrap();
                    assert!(img.width() > 1500 && img.height() > 2000, "{}×{}", img.width(), img.height());
                    pdf_page_to(&pd, &result, 0, "jpg", &d.join("page.jpg")).unwrap();
                    assert!(pdf_page_to(&pd, &result, 99, "png", &d.join("none.png")).is_err());
                }
            }
        }
        let csv = d.join("t.csv");
        fs::write(&csv, "name,n\nä,1\nb,2\n").unwrap();
        let work = d.join("w-csv");
        fs::create_dir_all(work.join("out")).unwrap();
        let (steps, result) = doc_steps(Class::Sheet, "csv", "xlsx", &csv, &work).unwrap();
        run(steps);
        assert_eq!(probe(&result, None).unwrap().format, "xlsx");
        let _ = fs::remove_dir_all(&d);
    }
}
