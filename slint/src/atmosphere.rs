//! Home's backdrop: soft folds of dark, faintly blue silk, computed once in Rust into a small image that Skia scales
//! smoothly to the window. Static by design (docs/SLINT_VISUAL_SYSTEM.md): no shader, timer or per-frame work.

use slint::{Rgb8Pixel, SharedPixelBuffer};

/// Pixel size of the generated backdrop; it is scaled to the window with smooth filtering
pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 450;

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Brightness (0..1, linear-ish) of the silk at normalized position `u` (0..aspect) and `v` (0..1)
fn silk(u: f32, v: f32) -> f32 {
    // Domain warp: the cloth's large, slow curves
    let wu = u + 0.32 * (1.7 * u + 2.1 * v + 0.3).sin();
    let wv = v + 0.30 * (2.3 * u - 1.4 * v + 1.1).cos();
    // The folds: one family of curved bands, bent again by a second, softer wave
    let fold = (3.1 * wu + 2.2 * wv + 1.6 * (2.0 * wv - 0.9 * wu).sin()).sin();
    let ridge = (fold * 0.5 + 0.5).powi(7);
    let sheen = 0.5 + 0.5 * (1.2 * wu - 1.9 * wv + 0.4).sin();
    // Darker in the middle, where Home's content sits; folds show towards the edges
    let du = u / (WIDTH as f32 / HEIGHT as f32) - 0.5;
    let dv = v - 0.5;
    let edge = 0.45 + 0.55 * smoothstep(0.12, 0.62, (du * du + dv * dv).sqrt());
    0.018 + edge * (0.030 * sheen + 0.10 * ridge)
}

/// The backdrop as RGB pixels
pub fn backdrop() -> SharedPixelBuffer<Rgb8Pixel> {
    let mut buffer = SharedPixelBuffer::<Rgb8Pixel>::new(WIDTH, HEIGHT);
    let aspect = WIDTH as f32 / HEIGHT as f32;
    let pixels = buffer.make_mut_slice();
    for y in 0..HEIGHT {
        let v = y as f32 / HEIGHT as f32;
        for x in 0..WIDTH {
            let u = x as f32 / WIDTH as f32 * aspect;
            let l = silk(u, v);
            // A faint pale-blue cast in the light parts only
            let to_byte = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[(y * WIDTH + x) as usize] = Rgb8Pixel {
                r: to_byte(l * 0.93),
                g: to_byte(l * 0.96),
                b: to_byte(l * 1.12),
            };
        }
    }
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_backdrop_stays_dark_with_lighter_folds() {
        let buffer = backdrop();
        let pixels = buffer.as_slice();
        assert_eq!(pixels.len(), (WIDTH * HEIGHT) as usize);
        let max = pixels.iter().map(|p| p.b).max().unwrap_or(0);
        let min = pixels.iter().map(|p| p.g).min().unwrap_or(255);
        assert!(max <= 48, "highlights stay subtle, got {max}");
        assert!(min <= 8, "the darkest parts are near black, got {min}");
        assert!(max > min + 12, "there are visible folds");
    }
}
