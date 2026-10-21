//! Home's backdrop: the original Halation's Drape, recorded as a seamless two-minute loop at 15 fps
//! (`scripts/record-drape.js`, Java 2026-10-21) and kept in the assets folder:
//! - `drape-loop.mp4`: the frames' luma as H.264, lifted so the dark field gets most of the codes
//!   (`y' = 255 * sqrt(min(1, luma / LIFT))`);
//! - `drape-tint.bin`: the frames' colour for each luma (256 x RGB).
//!
//! Windows' own decoder (Media Foundation) reads the video on a thread of its own, one frame per request; on that thread
//! the frame is scaled to the window's size, turned back into colour and handed to the window. Only the frame on
//! screen is held decoded. Plan and costs: docs/SLINT_VISUAL_SYSTEM.md.

use slint::{Rgb8Pixel, Rgba8Pixel, SharedPixelBuffer};
use std::path::Path;

/// Frames per second of the loop; the player asks for one frame per tick of this rate
pub const FPS: u64 = 15;
/// The luma that maps to the top code of the lifted video (the recorder's LIFT)
pub const LIFT: f32 = 80.0;

/// The largest frame made here; a bigger window has Skia scale this a little further
pub const MAX_FRAME: (u32, u32) = (2560, 1600);
/// Entries of the colour-by-luma table over 0..=LIFT
const COLOURS: usize = 4096;
/// Side of the dither tile
const DITHER: usize = 256;

/// Turns decoded frames into the window's backdrop. Each frame is scaled here to the window's own size with the
/// original's cubic B-spline, in floating point, coloured by luma and dithered by one level per pixel before the one
/// rounding to 8 bits, as the original's presentation does. Skia then draws it 1:1. Scaling with Skia instead
/// rounded a small frame to 8 bits first: its gradient steps became bands, and a dither made at that small size
/// showed as little squares once the window scaled it.
pub struct Palette {
    /// The curve undone: luma for each code `y'`
    luma: [f32; 256],
    /// The frames' colour for luma `l`, at `l * (COLOURS - 1) / LIFT`
    /// in 1/256 of a level
    colour: Vec<[i32; 3]>,
    /// Triangular noise of one level, per channel, repeated every `DITHER` pixels
    /// (in 1/256 of a level, with the half level that rounds added)
    dither: Vec<[i32; 3]>,
}

impl Palette {
    /// From `drape-tint.bin`
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
        Self::from_tint(&bytes)
    }

    pub fn from_tint(tint: &[u8]) -> Result<Self, String> {
        if tint.len() != 256 * 3 {
            return Err(format!(
                "the backdrop tint holds {} bytes, not 768",
                tint.len()
            ));
        }
        let mut luma = [0_f32; 256];
        for (code, value) in luma.iter_mut().enumerate() {
            let lifted = code as f32 / 255.0;
            *value = LIFT * lifted * lifted;
        }
        let colour = (0..COLOURS)
            .map(|i| {
                let l = i as f32 * LIFT / (COLOURS - 1) as f32;
                let (low, t) = (l.floor() as usize, l.fract());
                let high = (low + 1).min(255);
                let at = |index: usize, channel: usize| f32::from(tint[index * 3 + channel]);
                [0, 1, 2]
                    .map(|c| ((at(low, c) * (1.0 - t) + at(high, c) * t) * 256.0).round() as i32)
            })
            .collect();
        let dither = (0..DITHER * DITHER)
            .map(|i| {
                let (x, y) = ((i % DITHER) as u32, (i / DITHER) as u32);
                [0, 7919, 15731].map(|offset| (tpdf(x + offset, y) * 256.0).round() as i32 + 128)
            })
            .collect();
        Ok(Self {
            luma,
            colour,
            dither,
        })
    }

    /// A frame from its luma plane (`pitch` bytes per row), scaled to cover `out_w` x `out_h` (centred, the overflow
    /// cut) with a cubic B-spline, then coloured and dithered
    pub fn frame(
        &self,
        plane: &[u8],
        pitch: usize,
        (width, height): (u32, u32),
        (out_w, out_h): (u32, u32),
    ) -> SharedPixelBuffer<Rgb8Pixel> {
        let (w, h, ow, oh) = (
            width as usize,
            height as usize,
            out_w.max(1) as usize,
            out_h.max(1) as usize,
        );
        let scale = (ow as f32 / w as f32).max(oh as f32 / h as f32);
        let (columns, rows) = (taps(ow, w, scale), taps(oh, h, scale));
        // Each source row scaled across, in luma
        let mut across = vec![0_f32; h * ow];
        for y in 0..h {
            let source = &plane[y * pitch..y * pitch + w];
            let out = &mut across[y * ow..(y + 1) * ow];
            for (value, tap) in out.iter_mut().zip(&columns) {
                *value = tap
                    .iter()
                    .map(|&(x, weight)| self.luma[usize::from(source[x])] * weight)
                    .sum();
            }
        }
        let mut buffer = SharedPixelBuffer::<Rgb8Pixel>::new(ow as u32, oh as u32);
        let pixels = buffer.make_mut_slice();
        let to_index = (COLOURS - 1) as f32 / LIFT;
        // One output row in luma, as a table index, summed from four scaled rows a whole row at a time
        let mut line = vec![0_f32; ow];
        for (oy, tap) in rows.iter().enumerate() {
            line.fill(0.0);
            for &(y, weight) in tap {
                let weight = weight * to_index;
                for (value, &source) in line.iter_mut().zip(&across[y * ow..(y + 1) * ow]) {
                    *value += source * weight;
                }
            }
            let dither_row = &self.dither[(oy % DITHER) * DITHER..(oy % DITHER + 1) * DITHER];
            let out = &mut pixels[oy * ow..(oy + 1) * ow];
            for (pixels, (line, dither)) in out
                .chunks_mut(DITHER)
                .zip(line.chunks(DITHER))
                .map(|(pixels, line)| (pixels, (line, &dither_row[..line.len()])))
            {
                for ((pixel, &index), noise) in pixels.iter_mut().zip(line).zip(dither) {
                    let colour = self.colour[((index + 0.5) as usize).min(COLOURS - 1)];
                    let [r, g, b] =
                        [0, 1, 2].map(|c| ((colour[c] + noise[c]) >> 8).clamp(0, 255) as u8);
                    *pixel = Rgb8Pixel { r, g, b };
                }
            }
        }
        buffer
    }
}

/// The frame size for a window of `width` x `height` pixels: the same, at most `MAX_FRAME`, keeping its shape
pub fn frame_size(width: u32, height: u32) -> (u32, u32) {
    let k = (MAX_FRAME.0 as f32 / width.max(1) as f32)
        .min(MAX_FRAME.1 as f32 / height.max(1) as f32)
        .min(1.0);
    (
        ((width as f32 * k).round() as u32).max(1),
        ((height as f32 * k).round() as u32).max(1),
    )
}

/// The cubic B-spline's four source samples and weights for each of `out` pixels over `len` source pixels at `scale`,
/// centred
fn taps(out: usize, len: usize, scale: f32) -> Vec<[(usize, f32); 4]> {
    let spline = |t: f32| {
        let t = t.abs();
        if t < 1.0 {
            (4.0 - 6.0 * t * t + 3.0 * t * t * t) / 6.0
        } else if t < 2.0 {
            (2.0 - t).powi(3) / 6.0
        } else {
            0.0
        }
    };
    (0..out)
        .map(|o| {
            let f = (o as f32 + 0.5 - out as f32 / 2.0) / scale + len as f32 / 2.0 - 0.5;
            let base = f.floor();
            [-1.0, 0.0, 1.0, 2.0].map(|i: f32| {
                let at = (base + i).clamp(0.0, (len - 1) as f32) as usize;
                (at, spline(f - (base + i)))
            })
        })
        .collect()
}

/// A uniform value in [0, 1) for a 32-bit key
fn unit(mut v: u32) -> f32 {
    v ^= v >> 16;
    v = v.wrapping_mul(0x7feb_352d);
    v ^= v >> 15;
    v = v.wrapping_mul(0x846c_a68b);
    v ^= v >> 16;
    (v >> 8) as f32 / (1 << 24) as f32
}

/// Triangular noise in (-1, 1) for a pixel: the sum of two uniform hashes, minus one
fn tpdf(x: u32, y: u32) -> f32 {
    let seed = x.wrapping_mul(0x9e37_79b9) ^ y.wrapping_mul(0x85eb_ca6b);
    unit(seed) + unit(seed ^ 0x68e3_1da4) - 1.0
}

/// Side of the standard grain's tile, in pixels
const GRAIN_TILE: u32 = 512;
/// The dark field's level, where white and black grain move the colour by the same amount
const GRAIN_BASE: f32 = 24.0;
/// Standard deviation of the standard grain at full strength, in levels over the dark field
const GRAIN_SIGMA: f32 = 10.0;

/// Preview only (Java is comparing it with the original's grain, `HALATION_GRAIN=standard`): a standard static film
/// grain, monochrome Gaussian noise with one value per pixel, as a tile at full strength; Home sets its opacity.
/// White adds and black takes away, each scaled so that over the dark field it moves the colour by the noise value.
pub fn standard_grain() -> SharedPixelBuffer<Rgba8Pixel> {
    let mut buffer = SharedPixelBuffer::<Rgba8Pixel>::new(GRAIN_TILE, GRAIN_TILE);
    for (i, pixel) in buffer.make_mut_slice().iter_mut().enumerate() {
        let (x, y) = (i as u32 % GRAIN_TILE, i as u32 / GRAIN_TILE);
        let level = gaussian(x, y) * GRAIN_SIGMA;
        let (value, alpha) = if level >= 0.0 {
            (255, level / (255.0 - GRAIN_BASE))
        } else {
            (0, -level / GRAIN_BASE)
        };
        let a = (alpha.min(1.0) * 255.0 + 0.5) as u8;
        *pixel = Rgba8Pixel {
            r: value,
            g: value,
            b: value,
            a,
        };
    }
    buffer
}

/// Close to a standard normal value for a pixel: four uniforms summed (variance 1/3), centred and scaled
fn gaussian(x: u32, y: u32) -> f32 {
    let seed = x.wrapping_mul(0x27d4_eb2f) ^ y.wrapping_mul(0x1656_67b1) ^ 0x5bd1_e995;
    let sum: f32 = [0, 0x68e3_1da4, 0xb529_7a4d, 0x1b56_c4e9]
        .iter()
        .map(|salt| unit(seed ^ salt))
        .sum();
    (sum - 2.0) * 3.0_f32.sqrt()
}

/// Plays the loop on a decoding thread: `request` asks for the next frame at a size, `deliver` gets it on that thread
pub struct Player {
    requests: std::sync::mpsc::SyncSender<(u32, u32)>,
}

impl Player {
    /// Starts the decoding thread for the loop in `assets`; `None` when the loop cannot play (missing files), and Home
    /// keeps its still frame
    pub fn start<F>(assets: &Path, deliver: F) -> Option<Self>
    where
        F: Fn(SharedPixelBuffer<Rgb8Pixel>) + Send + 'static,
    {
        let palette = Palette::load(&assets.join("drape-tint.bin")).ok()?;
        let video = assets.join("drape-loop.mp4");
        if !video.is_file() {
            return None;
        }
        let (requests, wanted) = std::sync::mpsc::sync_channel::<(u32, u32)>(1);
        std::thread::Builder::new()
            .name("backdrop".into())
            .spawn(move || decode_loop(&video, &palette, &wanted, &deliver))
            .ok()?;
        Some(Self { requests })
    }

    /// Asks for the next frame for a window of `width` x `height` pixels; skipped while the previous request is still
    /// waiting
    pub fn request(&self, width: u32, height: u32) {
        let _ = self.requests.try_send(frame_size(width, height));
    }
}

/// The decoding thread: one frame per request until the player is dropped or the decoder fails
fn decode_loop<F>(
    video: &Path,
    palette: &Palette,
    wanted: &std::sync::mpsc::Receiver<(u32, u32)>,
    deliver: &F,
) where
    F: Fn(SharedPixelBuffer<Rgb8Pixel>),
{
    let Ok(mut decoder) = mf::Decoder::open(video) else {
        return;
    };
    let mut plane = Vec::new();
    while let Ok(size) = wanted.recv() {
        match decoder.next(&mut plane) {
            Ok((width, height, pitch)) => {
                deliver(palette.frame(&plane, pitch, (width, height), size))
            }
            Err(_) => return,
        }
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod mf {
    //! Media Foundation's source reader through its COM interfaces (hence `unsafe`): the loop file in, the luma plane
    //! of each NV12 frame out. At the end of the file the reader is opened again, so the loop has no gap.

    use std::path::{Path, PathBuf};
    use windows::Win32::Media::MediaFoundation::{
        IMF2DBuffer, IMFSourceReader, MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE,
        MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_SOURCE_READERF_ENDOFSTREAM, MF_VERSION,
        MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Video, MFSTARTUP_LITE,
        MFShutdown, MFStartup, MFVideoFormat_NV12,
    };
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
    use windows::core::{HSTRING, Interface};

    fn text(error: windows::core::Error) -> String {
        error.to_string()
    }

    /// COM and Media Foundation started on the decoding thread; shut down after the reader is released
    struct Session;

    impl Session {
        fn start() -> Result<Self, String> {
            // SAFETY: COM and Media Foundation start on this thread, which owns the session until it is dropped.
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED)
                    .ok()
                    .map_err(text)?;
                if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_LITE) {
                    CoUninitialize();
                    return Err(text(error));
                }
            }
            Ok(Self)
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            // SAFETY: matches `start`, on the same thread, once every Media Foundation object is released.
            unsafe {
                let _ = MFShutdown();
                CoUninitialize();
            }
        }
    }

    // Fields drop in order: the reader before the session that it needs
    pub struct Decoder {
        reader: IMFSourceReader,
        path: PathBuf,
        width: u32,
        height: u32,
        _session: Session,
    }

    impl Decoder {
        pub fn open(path: &Path) -> Result<Self, String> {
            let session = Session::start()?;
            let (reader, width, height) = Self::reader(path)?;
            Ok(Self {
                reader,
                path: path.to_path_buf(),
                width,
                height,
                _session: session,
            })
        }

        fn reader(path: &Path) -> Result<(IMFSourceReader, u32, u32), String> {
            let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
            // SAFETY: plain calls on interfaces this function owns.
            unsafe {
                let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), None)
                    .map_err(text)?;
                let wanted = MFCreateMediaType().map_err(text)?;
                wanted
                    .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                    .map_err(text)?;
                wanted
                    .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                    .map_err(text)?;
                reader
                    .SetCurrentMediaType(stream, None, &wanted)
                    .map_err(text)?;
                let current = reader.GetCurrentMediaType(stream).map_err(text)?;
                let size = current.GetUINT64(&MF_MT_FRAME_SIZE).map_err(text)?;
                Ok((reader, (size >> 32) as u32, size as u32))
            }
        }

        /// The next frame's luma plane into `plane`: its width, height and row pitch
        pub fn next(&mut self, plane: &mut Vec<u8>) -> Result<(u32, u32, usize), String> {
            let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
            for _ in 0..2 {
                let mut flags = 0_u32;
                let mut sample = None;
                // SAFETY: the out-pointers live on this stack frame for the duration of the call.
                unsafe {
                    self.reader
                        .ReadSample(stream, 0, None, Some(&mut flags), None, Some(&mut sample))
                        .map_err(text)?;
                }
                let ended = flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0;
                let Some(sample) = sample.filter(|_| !ended) else {
                    // The end of the loop: start again from the first frame
                    let (reader, width, height) = Self::reader(&self.path)?;
                    (self.reader, self.width, self.height) = (reader, width, height);
                    continue;
                };
                // SAFETY: the buffer stays locked while its first `height` rows of `pitch` bytes are copied, and is
                // unlocked before it is released.
                unsafe {
                    let buffer: IMF2DBuffer = sample
                        .GetBufferByIndex(0)
                        .map_err(text)?
                        .cast()
                        .map_err(text)?;
                    let mut start = std::ptr::null_mut();
                    let mut pitch = 0_i32;
                    buffer.Lock2D(&mut start, &mut pitch).map_err(text)?;
                    let pitch = pitch.unsigned_abs() as usize;
                    plane.clear();
                    plane.extend_from_slice(std::slice::from_raw_parts(
                        start,
                        pitch * self.height as usize,
                    ));
                    let _ = buffer.Unlock2D();
                    return Ok((self.width, self.height, pitch));
                }
            }
            Err("the backdrop loop has no frames".to_owned())
        }
    }
}

#[cfg(not(windows))]
mod mf {
    //! No system decoder outside Windows: Home keeps the still frame.
    use std::path::Path;

    pub struct Decoder;

    impl Decoder {
        pub fn open(_path: &Path) -> Result<Self, String> {
            Err("the backdrop loop plays on Windows only".to_owned())
        }

        pub fn next(&mut self, _plane: &mut Vec<u8>) -> Result<(u32, u32, usize), String> {
            Err("the backdrop loop plays on Windows only".to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shipped() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")
    }

    #[test]
    fn the_palette_undoes_the_lift_and_colours_by_luma() {
        let palette = Palette::load(&shipped().join("drape-tint.bin")).unwrap();
        assert_eq!(palette.luma[0], 0.0);
        assert!((palette.luma[255] - LIFT).abs() < 1e-3);
        let at = |l: f32| palette.colour[(l * (COLOURS - 1) as f32 / LIFT) as usize];
        let [dark, mid, top] = [at(0.0), at(30.0), at(LIFT)];
        assert!(dark.iter().all(|&c| c <= 8 * 256), "luma 0 is near black");
        assert!(mid[2] >= mid[0], "lighter parts lean blue, like the Drape");
        assert!(top[1] > mid[1], "brighter luma is brighter");
        assert!(Palette::from_tint(&[0; 10]).is_err());
    }

    #[test]
    fn a_frame_covers_the_window_with_a_one_level_dither() {
        // A flat grey of luma 40 (tint: colour equals luma) stays within one level of it, and the dither reaches both
        // sides
        let tint: Vec<u8> = (0..=255_u8).flat_map(|v| [v, v, v]).collect();
        let palette = Palette::from_tint(&tint).unwrap();
        let code = (255.0 * (40.0 / LIFT).sqrt()).round() as u8;
        let plane = vec![code; 16 * 9];
        let frame = palette.frame(&plane, 16, (16, 9), (100, 75));
        assert_eq!((frame.width(), frame.height()), (100, 75));
        let level = LIFT * (f32::from(code) / 255.0).powi(2);
        let values: Vec<f32> = frame.as_slice().iter().map(|p| f32::from(p.g)).collect();
        assert!(values.iter().all(|&v| (v - level).abs() <= 1.5));
        assert!(values.iter().any(|&v| v > level) && values.iter().any(|&v| v < level));
    }

    #[test]
    fn the_spline_keeps_a_ramp_smooth_and_in_place() {
        // A ramp across the frame scaled four times: no overshoot, rising across, centred
        let columns = taps(64, 16, 4.0);
        assert!(
            columns
                .iter()
                .all(|tap| (tap.iter().map(|t| t.1).sum::<f32>() - 1.0).abs() < 1e-5)
        );
        let ramp: Vec<f32> = (0..16).map(|x| x as f32).collect();
        let out: Vec<f32> = columns
            .iter()
            .map(|tap| tap.iter().map(|&(x, w)| ramp[x] * w).sum())
            .collect();
        assert!(out.windows(2).all(|pair| pair[1] >= pair[0]));
        assert!((out[31] + out[32] - 15.0).abs() < 0.2, "centred");
        assert_eq!(frame_size(1920, 1080), (1920, 1080));
        assert_eq!(frame_size(3840, 2160), (2560, 1440));
    }

    #[cfg(windows)]
    #[test]
    fn the_loop_decodes_to_320_by_180_and_wraps() {
        let mut decoder = mf::Decoder::open(&shipped().join("drape-loop.mp4")).unwrap();
        let mut plane = Vec::new();
        let (width, height, pitch) = decoder.next(&mut plane).unwrap();
        assert_eq!((width, height), (320, 180));
        let first = plane[..pitch * 180].to_vec();
        // Past the last frame the loop starts again: frame 1800 is frame 0
        for _ in 0..1800 {
            decoder.next(&mut plane).unwrap();
        }
        let again = &plane[..pitch * 180];
        let diff = first
            .iter()
            .zip(again)
            .map(|(a, b)| u32::from(a.abs_diff(*b)))
            .sum::<u32>() as f64
            / first.len() as f64;
        assert!(diff < 0.01, "the wrapped frame differs by {diff:.4}");
    }
}
