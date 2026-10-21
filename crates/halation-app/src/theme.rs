#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

// Visual system: docs/SLINT_VISUAL_SYSTEM.md, measured on the rendered original Halation.
pub const GROUND: Rgb = Rgb(0x07, 0x07, 0x07);
pub const GROUND_TOP: Rgb = Rgb(0x0b, 0x0b, 0x0c);
pub const PANEL: Rgb = Rgb(0x11, 0x11, 0x11);
pub const RAISED: Rgb = Rgb(0x24, 0x24, 0x24);
pub const FIELD: Rgb = Rgb(0x08, 0x08, 0x08);
pub const LINE: Rgb = Rgb(0x3d, 0x3d, 0x39);
pub const LINE_STRONG: Rgb = Rgb(0x55, 0x55, 0x4f);
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

pub const TEXT_PAIRS: [(&str, Rgb, Rgb); 12] = [
    ("primary text on the ground", TEXT, GROUND),
    ("primary text on a panel", TEXT, PANEL),
    ("primary text on a raised item", TEXT, RAISED),
    ("secondary text on a panel", MUTED, PANEL),
    ("secondary text on a field", MUTED, FIELD),
    ("secondary text on a raised item", MUTED, RAISED),
    ("tertiary text on a panel", SUBTLE, PANEL),
    ("tertiary text on the ground", SUBTLE, GROUND),
    ("accent on a panel", ACCENT, PANEL),
    ("warning on a panel", WARNING, PANEL),
    ("beta tag on a panel", BETA, PANEL),
    ("error text on a panel", DANGER, PANEL),
];
