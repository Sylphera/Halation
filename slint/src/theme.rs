#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

pub const BACKGROUND: Rgb = Rgb(0x0b, 0x0b, 0x0d);
pub const SURFACE: Rgb = Rgb(0x14, 0x14, 0x16);
pub const SURFACE_HIGH: Rgb = Rgb(0x1b, 0x1b, 0x1f);
pub const BORDER: Rgb = Rgb(0x2c, 0x2c, 0x32);
pub const TEXT: Rgb = Rgb(0xf4, 0xf4, 0xf5);
pub const MUTED: Rgb = Rgb(0xa7, 0xa7, 0xae);
pub const ACCENT: Rgb = Rgb(0xb4, 0xb8, 0xe8);
pub const ACCENT_SOFT: Rgb = Rgb(0x2a, 0x2c, 0x43);
pub const DANGER: Rgb = Rgb(0xf3, 0xa6, 0xa6);
pub const SUCCESS: Rgb = Rgb(0xa6, 0xd8, 0xb4);

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

pub const TEXT_PAIRS: [(&str, Rgb, Rgb); 6] = [
    ("primary text on background", TEXT, BACKGROUND),
    ("primary text on surface", TEXT, SURFACE),
    ("muted text on background", MUTED, BACKGROUND),
    ("muted text on surface", MUTED, SURFACE),
    ("accent text on background", ACCENT, BACKGROUND),
    ("error text on surface", DANGER, SURFACE),
];
