//! Home's backdrop: the original Halation's Drape, recorded as a seamless two-minute loop at 15 fps
//! (`scripts/record-drape.js`, Java 2026-10-21) and kept in the assets folder:
//! - `drape-loop.mp4`: the frames' luma as H.264, lifted so the dark field gets most of the codes
//!   (`y' = 255 * sqrt(min(1, luma / LIFT))`);
//! - `drape-tint.bin`: the frames' colour for each luma (256 x RGB).
//!
//! Windows' own decoder (Media Foundation) reads the video on a thread of its own, one frame per request; the frame is
//! turned back into colour here and handed to the window. Only the frame on screen is held decoded. Plan and costs:
//! docs/SLINT_VISUAL_SYSTEM.md.

use slint::{Rgb8Pixel, SharedPixelBuffer};
use std::path::Path;

/// Frames per second of the loop; the player asks for one frame per tick of this rate
pub const FPS: u64 = 15;
/// The luma that maps to the top code of the lifted video (the recorder's LIFT)
pub const LIFT: f32 = 80.0;

/// Each decoded frame is scaled up this much here, with a dither, before the window scales it the rest of the way.
/// The window draws into 8 bits per channel: a 320 px frame scaled about six times there turns each step of a dark
/// gradient into a wide band, and grain laid on top cannot break a band that is already drawn. Scaling twice here in
/// floating point and dithering at that size leaves the window steps that the dither has already broken.
pub const UPSCALE: u32 = 2;

/// The colour of each decoded code `y'`, in floating point: the curve undone, then the frames' colour at that luma;
/// with the dither of the last frame size, worked out once
pub struct Palette(
    [[f32; 3]; 256],
    std::cell::RefCell<(usize, usize, Vec<f32>)>,
);

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
        let colour = |luma: usize, channel: usize| f32::from(tint[luma * 3 + channel]);
        let mut table = [[0_f32; 3]; 256];
        for (code, entry) in table.iter_mut().enumerate() {
            let lifted = code as f32 / 255.0;
            let luma = (LIFT * lifted * lifted).min(255.0);
            let (low, t) = (luma.floor() as usize, luma.fract());
            let high = (low + 1).min(255);
            for (channel, value) in entry.iter_mut().enumerate() {
                *value = colour(low, channel) * (1.0 - t) + colour(high, channel) * t;
            }
        }
        Ok(Self(table, std::cell::RefCell::new((0, 0, Vec::new()))))
    }

    /// A frame from its luma plane (`pitch` bytes per row), scaled `UPSCALE` times with bilinear filtering in floating
    /// point and quantized with a fixed triangular dither of one level (the same at every frame, like the original's)
    pub fn frame(
        &self,
        plane: &[u8],
        pitch: usize,
        width: u32,
        height: u32,
    ) -> SharedPixelBuffer<Rgb8Pixel> {
        let (w, h) = (width as usize, height as usize);
        let (out_w, out_h) = (w * UPSCALE as usize, h * UPSCALE as usize);
        let mut buffer = SharedPixelBuffer::<Rgb8Pixel>::new(out_w as u32, out_h as u32);
        let pixels = buffer.make_mut_slice();
        // Where each output column and row samples the frame, worked out once
        let taps = |out: usize, len: usize| -> Vec<(usize, usize, f32)> {
            (0..out)
                .map(|o| {
                    let f = ((o as f32 + 0.5) / UPSCALE as f32 - 0.5).clamp(0.0, (len - 1) as f32);
                    let low = f.floor() as usize;
                    (low, (low + 1).min(len - 1), f.fract())
                })
                .collect()
        };
        let (columns, rows) = (taps(out_w, w), taps(out_h, h));
        let mut cached = self.1.borrow_mut();
        if (cached.0, cached.1) != (out_w, out_h) {
            let noise = (0..out_w * out_h)
                .map(|i| tpdf((i % out_w) as u32, (i / out_w) as u32))
                .collect();
            *cached = (out_w, out_h, noise);
        }
        let noise = &cached.2;
        // One source row in colour, and the output row blended from two of them
        let colour_row = |y: usize| -> Vec<[f32; 3]> {
            plane[y * pitch..y * pitch + w]
                .iter()
                .map(|&code| self.0[usize::from(code)])
                .collect()
        };
        for (oy, &(y0, y1, ty)) in rows.iter().enumerate() {
            let (top, bottom) = (colour_row(y0), colour_row(y1));
            for (ox, &(x0, x1, tx)) in columns.iter().enumerate() {
                let dither = noise[oy * out_w + ox];
                let mut out = [0_u8; 3];
                for (k, value) in out.iter_mut().enumerate() {
                    let upper = top[x0][k] + (top[x1][k] - top[x0][k]) * tx;
                    let lower = bottom[x0][k] + (bottom[x1][k] - bottom[x0][k]) * tx;
                    // `as` saturates to 0..=255; adding a half rounds to the nearest level
                    *value = (upper + (lower - upper) * ty + dither + 0.5) as u8;
                }
                let [r, g, b] = out;
                pixels[oy * out_w + ox] = Rgb8Pixel { r, g, b };
            }
        }
        buffer
    }
}

/// Triangular noise in (-1, 1) for a pixel: the sum of two uniform hashes, minus one
fn tpdf(x: u32, y: u32) -> f32 {
    let hash = |mut v: u32| {
        v ^= v >> 16;
        v = v.wrapping_mul(0x7feb_352d);
        v ^= v >> 15;
        v = v.wrapping_mul(0x846c_a68b);
        v ^= v >> 16;
        (v >> 8) as f32 / (1 << 24) as f32
    };
    let seed = x.wrapping_mul(0x9e37_79b9) ^ y.wrapping_mul(0x85eb_ca6b);
    hash(seed) + hash(seed ^ 0x68e3_1da4) - 1.0
}

/// Plays the loop on a decoding thread: `request` asks for the next frame, `deliver` gets it on that thread
pub struct Player {
    requests: std::sync::mpsc::SyncSender<()>,
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
        let (requests, wanted) = std::sync::mpsc::sync_channel::<()>(1);
        std::thread::Builder::new()
            .name("backdrop".into())
            .spawn(move || decode_loop(&video, &palette, &wanted, &deliver))
            .ok()?;
        Some(Self { requests })
    }

    /// Asks for the next frame; skipped while the previous request is still waiting
    pub fn request(&self) {
        let _ = self.requests.try_send(());
    }
}

/// The decoding thread: one frame per request until the player is dropped or the decoder fails
fn decode_loop<F>(
    video: &Path,
    palette: &Palette,
    wanted: &std::sync::mpsc::Receiver<()>,
    deliver: &F,
) where
    F: Fn(SharedPixelBuffer<Rgb8Pixel>),
{
    let Ok(mut decoder) = mf::Decoder::open(video) else {
        return;
    };
    let mut plane = Vec::new();
    while wanted.recv().is_ok() {
        match decoder.next(&mut plane) {
            Ok((width, height, pitch)) => deliver(palette.frame(&plane, pitch, width, height)),
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
        let [dark, mid, top] = [palette.0[0], palette.0[180], palette.0[255]];
        assert!(dark.iter().all(|&c| c <= 8.0), "code 0 is near black");
        assert!(mid[2] >= mid[0], "lighter parts lean blue, like the Drape");
        assert!(top[1] > mid[1], "brighter codes are brighter");
        assert!(Palette::from_tint(&[0; 10]).is_err());
    }

    #[test]
    fn a_frame_is_scaled_with_a_one_level_dither() {
        let palette = Palette::from_tint(&[100; 768]).unwrap();
        let plane = vec![255_u8; 4 * 4];
        let frame = palette.frame(&plane, 4, 4, 4);
        assert_eq!((frame.width(), frame.height()), (4 * UPSCALE, 4 * UPSCALE));
        // A flat colour of 100 stays within one level of it, and the dither does reach both sides
        let values: Vec<u8> = frame.as_slice().iter().map(|p| p.g).collect();
        assert!(values.iter().all(|&v| (99..=101).contains(&v)));
        assert!(values.iter().any(|&v| v != 100));
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
