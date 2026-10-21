//! Home's backdrop: the original Halation's Drape, recorded as a seamless two-minute loop (`scripts/record-drape.js`,
//! Java 2026-10-21) of 1800 small JPEG frames at 15 fps. The frames ship inside the binary; one frame is decoded at a
//! time, so only the one on screen is held in memory. Plan and costs: docs/SLINT_VISUAL_SYSTEM.md.

use slint::{Rgb8Pixel, SharedPixelBuffer};

/// The recorded loop: "HDL1", the frame count (u32 LE), each frame's byte length (u32 LE), then the JPEG frames
static LOOP: &[u8] = include_bytes!("../assets/drape-loop.bin");

/// Frames per second the loop was recorded at; the player advances one frame per tick of this rate
pub const FPS: u64 = 15;

/// The loop's frames, as slices into the embedded file
pub struct DrapeLoop {
    frames: Vec<&'static [u8]>,
}

impl DrapeLoop {
    /// The loop shipped with the beta
    pub fn embedded() -> Result<Self, String> {
        Self::parse(LOOP)
    }

    pub fn parse(bytes: &'static [u8]) -> Result<Self, String> {
        let word = |at: usize| -> Result<usize, String> {
            bytes
                .get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
                .ok_or_else(|| "the backdrop loop is truncated".to_owned())
        };
        if bytes.get(..4) != Some(b"HDL1".as_slice()) {
            return Err("the backdrop loop has an unknown format".to_owned());
        }
        let count = word(4)?;
        if count == 0 || count > 100_000 {
            return Err(format!("the backdrop loop declares {count} frames"));
        }
        let mut offset = 8 + 4 * count;
        let mut frames = Vec::with_capacity(count);
        for index in 0..count {
            let length = word(8 + 4 * index)?;
            let frame = bytes
                .get(offset..offset + length)
                .ok_or_else(|| "the backdrop loop is truncated".to_owned())?;
            frames.push(frame);
            offset += length;
        }
        Ok(Self { frames })
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Frame `index` (wrapping), decoded to RGB
    pub fn frame(&self, index: usize) -> Result<SharedPixelBuffer<Rgb8Pixel>, String> {
        let bytes = self.frames[index % self.frames.len()];
        let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
            .map_err(|error| format!("backdrop frame {index}: {error}"))?
            .into_rgb8();
        let (width, height) = image.dimensions();
        Ok(SharedPixelBuffer::clone_from_slice(
            image.as_raw(),
            width,
            height,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_loop_holds_two_minutes_at_15_fps_of_320_by_180() {
        let drape = DrapeLoop::embedded().unwrap();
        assert_eq!(drape.len() as u64, 120 * FPS);
        let first = drape.frame(0).unwrap();
        assert_eq!((first.width(), first.height()), (320, 180));
        // Wrapping: the frame after the last is the first
        assert_eq!(
            drape.frame(drape.len()).unwrap().as_slice(),
            first.as_slice()
        );
    }

    #[test]
    fn neighbouring_frames_differ_only_a_little() {
        let drape = DrapeLoop::embedded().unwrap();
        // The seam (last into first) and an ordinary step look alike: no jump where the loop closes
        for (a, b) in [(drape.len() - 1, 0), (900, 901)] {
            let (x, y) = (drape.frame(a).unwrap(), drape.frame(b).unwrap());
            let mean = x
                .as_slice()
                .iter()
                .zip(y.as_slice())
                .map(|(p, q)| u32::from(p.g.abs_diff(q.g)))
                .sum::<u32>() as f64
                / x.as_slice().len() as f64;
            assert!(
                mean < 1.0,
                "frames {a} -> {b} differ by {mean:.3} on average"
            );
        }
    }

    #[test]
    fn a_damaged_loop_is_refused() {
        assert!(DrapeLoop::parse(b"NOPE").is_err());
        assert!(DrapeLoop::parse(b"HDL1\x02\x00\x00\x00\x05\x00\x00\x00").is_err());
    }
}
