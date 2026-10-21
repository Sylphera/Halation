#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

// Visual system: docs/SLINT_VISUAL_SYSTEM.md. Pure black ground, warm-neutral greys, pale blue accent.
pub const BACKGROUND: Rgb = Rgb(0x00, 0x00, 0x00);
pub const RAIL: Rgb = Rgb(0x05, 0x05, 0x04);
pub const SURFACE: Rgb = Rgb(0x11, 0x11, 0x10);
pub const SURFACE_RAISED: Rgb = Rgb(0x18, 0x18, 0x17);
pub const SURFACE_HIGH: Rgb = Rgb(0x20, 0x20, 0x1e);
pub const BORDER: Rgb = Rgb(0x26, 0x26, 0x24);
pub const BORDER_STRONG: Rgb = Rgb(0x35, 0x35, 0x32);
pub const TEXT: Rgb = Rgb(0xf4, 0xf4, 0xf2);
pub const MUTED: Rgb = Rgb(0xa6, 0xa6, 0xa0);
pub const SUBTLE: Rgb = Rgb(0x8b, 0x8b, 0x85);
pub const ACCENT: Rgb = Rgb(0x9f, 0xb4, 0xea);
pub const ACCENT_SOFT: Rgb = Rgb(0x14, 0x1a, 0x28);
pub const PRIMARY: Rgb = Rgb(0xee, 0xee, 0xeb);
pub const ON_PRIMARY: Rgb = Rgb(0x0a, 0x0a, 0x09);
pub const WARNING: Rgb = Rgb(0xe2, 0xc2, 0x7f);
pub const WARNING_SOFT: Rgb = Rgb(0x1d, 0x1a, 0x12);
pub const DANGER: Rgb = Rgb(0xf0, 0xa6, 0xa6);
pub const DANGER_SOFT: Rgb = Rgb(0x2a, 0x17, 0x17);
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
    ("primary text on background", TEXT, BACKGROUND),
    ("primary text on surface", TEXT, SURFACE),
    ("primary text on pressed surface", TEXT, SURFACE_HIGH),
    ("muted text on background", MUTED, BACKGROUND),
    ("muted text on rail", MUTED, RAIL),
    ("muted text on hovered surface", MUTED, SURFACE_RAISED),
    ("muted text on pressed surface", MUTED, SURFACE_HIGH),
    ("subtle text on background", SUBTLE, BACKGROUND),
    ("subtle text on surface", SUBTLE, SURFACE),
    ("subtle text on pressed surface", SUBTLE, SURFACE_HIGH),
    ("accent text on surface", ACCENT, SURFACE),
    ("accent text on accent fill", ACCENT, ACCENT_SOFT),
    ("primary button label", ON_PRIMARY, PRIMARY),
    ("warning text on warning fill", WARNING, WARNING_SOFT),
    ("error text on error fill", DANGER, DANGER_SOFT),
    ("success text on surface", SUCCESS, SURFACE),
];
