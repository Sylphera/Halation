#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

// Visual system: planning/active/ui-redesign.md §5; chrome and canvas neutral greys
// (docs/features/material.md), with a faint warm bias: the warm variant (Java, 2026-10-22).
pub const CHROME: Rgb = Rgb(0x12, 0x11, 0x10);
pub const CANVAS: Rgb = Rgb(0x0d, 0x0c, 0x0b);
pub const CANVAS_DEEP: Rgb = Rgb(0x0b, 0x0a, 0x09);
pub const CONTROL: Rgb = Rgb(0x17, 0x16, 0x15);
pub const CONTROL_HOVER: Rgb = Rgb(0x1e, 0x1c, 0x1a);
pub const CONTROL_ACTIVE: Rgb = Rgb(0x25, 0x23, 0x21);
pub const LINE: Rgb = Rgb(0x21, 0x1f, 0x1d);
pub const LINE_STRONG: Rgb = Rgb(0x30, 0x2d, 0x2a);
pub const TEXT: Rgb = Rgb(0xf7, 0xf4, 0xec);
pub const MUTED: Rgb = Rgb(0xb9, 0xb3, 0xa7);
pub const SUBTLE: Rgb = Rgb(0x9e, 0x97, 0x8b);
pub const ACCENT: Rgb = Rgb(0xc9, 0xa8, 0x70);
pub const ACTIVITY: Rgb = Rgb(0xd9, 0xa4, 0x6a);
pub const WARNING: Rgb = Rgb(0xe8, 0x95, 0x5e);
pub const BETA: Rgb = Rgb(0xe3, 0x91, 0xa4);
pub const DANGER: Rgb = Rgb(0xf0, 0xa6, 0xa6);
pub const SUCCESS: Rgb = Rgb(0x9f, 0xd6, 0xb2);

/// The Drape's silver-blue turned golden (the warm variant, Java, 2026-10-22): blue and red trade places, the red side
/// a little lower, then scaled back to the colour's luma so contrast stays as recorded
pub fn warm(red: f32, green: f32, blue: f32) -> [f32; 3] {
    let luma = |r: f32, g: f32, b: f32| 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let (r, g, b) = (blue, green, red * 0.85);
    let before = luma(red, green, blue);
    let after = luma(r, g, b);
    let scale = if after > 0.0 { before / after } else { 1.0 };
    [r * scale, g * scale, b * scale]
}

pub fn contrast_ratio(a: Rgb, b: Rgb) -> f64 {
    let (lighter, darker) = {
        let a = relative_luminance(a);
        let b = relative_luminance(b);
        if a >= b { (a, b) } else { (b, a) }
    };
    (lighter + 0.05) / (darker + 0.05)
}

fn relative_luminance(color: Rgb) -> f64 {
    fn channel(value: u8) -> f64 {
        let value = f64::from(value) / 255.0;
        if value <= 0.040_45 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * channel(color.0) + 0.7152 * channel(color.1) + 0.0722 * channel(color.2)
}

pub const TEXT_PAIRS: [(&str, Rgb, Rgb); 16] = [
    ("primary text on the chrome", TEXT, CHROME),
    ("primary text on the canvas", TEXT, CANVAS),
    ("primary text on a control", TEXT, CONTROL),
    ("primary text on an active item", TEXT, CONTROL_ACTIVE),
    ("secondary text on the chrome", MUTED, CHROME),
    ("secondary text on the canvas", MUTED, CANVAS),
    ("secondary text on a control", MUTED, CONTROL),
    ("secondary text on a hovered item", MUTED, CONTROL_HOVER),
    ("tertiary text on the chrome", SUBTLE, CHROME),
    ("tertiary text on the canvas", SUBTLE, CANVAS),
    ("tertiary text on an active item", SUBTLE, CONTROL_ACTIVE),
    ("accent on the chrome", ACCENT, CHROME),
    ("accent on an active item", ACCENT, CONTROL_ACTIVE),
    ("warning on the canvas", WARNING, CANVAS),
    ("beta tag on the canvas", BETA, CANVAS),
    ("error text on the canvas", DANGER, CANVAS),
];
