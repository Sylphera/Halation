#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

// Visual system: planning/active/ui-redesign.md §5; chrome and canvas neutral greys
// (docs/features/material.md).
pub const CHROME: Rgb = Rgb(0x11, 0x11, 0x11);
pub const CANVAS: Rgb = Rgb(0x0c, 0x0c, 0x0c);
pub const CANVAS_DEEP: Rgb = Rgb(0x0a, 0x0a, 0x0b);
pub const CONTROL: Rgb = Rgb(0x16, 0x16, 0x17);
pub const CONTROL_HOVER: Rgb = Rgb(0x1c, 0x1c, 0x1e);
pub const CONTROL_ACTIVE: Rgb = Rgb(0x23, 0x23, 0x25);
pub const LINE: Rgb = Rgb(0x1f, 0x1f, 0x21);
pub const LINE_STRONG: Rgb = Rgb(0x2d, 0x2d, 0x30);
pub const TEXT: Rgb = Rgb(0xf5, 0xf5, 0xf2);
pub const MUTED: Rgb = Rgb(0xb5, 0xb5, 0xaf);
pub const SUBTLE: Rgb = Rgb(0x9a, 0x99, 0x93);
pub const ACCENT: Rgb = Rgb(0xa3, 0xa8, 0xdc);
pub const ACTIVITY: Rgb = Rgb(0x82, 0xb5, 0xd6);
pub const WARNING: Rgb = Rgb(0xe0, 0xb1, 0x5e);
pub const BETA: Rgb = Rgb(0xe3, 0x91, 0xa4);
pub const DANGER: Rgb = Rgb(0xf0, 0xa6, 0xa6);
pub const SUCCESS: Rgb = Rgb(0x9f, 0xd6, 0xb2);

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
