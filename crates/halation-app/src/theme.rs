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

/// The interface's themes (docs/features/themes.md): the colours that change between them, applied at start and on a
/// change in Settings, at once
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Silver,
    Gold,
}

impl Tone {
    pub fn from_setting(value: u8) -> Self {
        if value == 1 { Self::Gold } else { Self::Silver }
    }

    /// The Drape's recorded colour for this theme: as recorded in Silver; in Gold its silver-blue turned golden,
    /// blue and red trading places with the red side a little lower, scaled back to the colour's luma
    pub fn drape(self, red: f32, green: f32, blue: f32) -> [f32; 3] {
        match self {
            Self::Silver => [red, green, blue],
            Self::Gold => {
                let luma = |r: f32, g: f32, b: f32| 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let (r, g, b) = (blue, green, red * 0.85);
                let after = luma(r, g, b);
                let scale = if after > 0.0 {
                    luma(red, green, blue) / after
                } else {
                    1.0
                };
                [r * scale, g * scale, b * scale]
            }
        }
    }
}

/// Every colour token a theme sets
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Colours {
    pub chrome: Rgb,
    pub canvas: Rgb,
    pub canvas_deep: Rgb,
    pub control: Rgb,
    pub control_hover: Rgb,
    pub control_active: Rgb,
    pub line: Rgb,
    pub line_strong: Rgb,
    pub line_hover: Rgb,
    pub text: Rgb,
    pub muted: Rgb,
    pub subtle: Rgb,
    pub accent: Rgb,
    pub activity: Rgb,
    pub warning: Rgb,
    pub beta: Rgb,
    pub danger: Rgb,
    pub success: Rgb,
    // The material's fills (docs/features/material.md)
    pub raised: Rgb,
    pub raised_press: Rgb,
    pub well: Rgb,
    pub bubble: Rgb,
    pub popover: Rgb,
    pub key: Rgb,
    pub primary_press: Rgb,
}

pub const SILVER: Colours = Colours {
    chrome: CHROME,
    canvas: CANVAS,
    canvas_deep: CANVAS_DEEP,
    control: CONTROL,
    control_hover: CONTROL_HOVER,
    control_active: CONTROL_ACTIVE,
    line: LINE,
    line_strong: LINE_STRONG,
    line_hover: Rgb(0x3c, 0x3c, 0x40),
    text: TEXT,
    muted: MUTED,
    subtle: SUBTLE,
    accent: ACCENT,
    activity: ACTIVITY,
    warning: WARNING,
    beta: BETA,
    danger: DANGER,
    success: SUCCESS,
    raised: Rgb(0x23, 0x23, 0x23),
    raised_press: Rgb(0x1c, 0x1c, 0x1c),
    well: Rgb(0x09, 0x09, 0x09),
    bubble: Rgb(0x14, 0x14, 0x14),
    popover: Rgb(0x22, 0x22, 0x22),
    key: Rgb(0x2c, 0x2c, 0x2c),
    primary_press: Rgb(0xc9, 0xc9, 0xc4),
};

/// Golden instead of silver-blue (Java, 2026-10-22): greys with a faint warm bias, warm text, a gold accent at
/// lavender's luminance, amber Activity; the warning moves to orange to stay apart from the accent
pub const GOLD: Colours = Colours {
    chrome: Rgb(0x12, 0x11, 0x10),
    canvas: Rgb(0x0d, 0x0c, 0x0b),
    canvas_deep: Rgb(0x0b, 0x0a, 0x09),
    control: Rgb(0x17, 0x16, 0x15),
    control_hover: Rgb(0x1e, 0x1c, 0x1a),
    control_active: Rgb(0x25, 0x23, 0x21),
    line: Rgb(0x21, 0x1f, 0x1d),
    line_strong: Rgb(0x30, 0x2d, 0x2a),
    line_hover: Rgb(0x40, 0x3c, 0x38),
    text: Rgb(0xf7, 0xf4, 0xec),
    muted: Rgb(0xb9, 0xb3, 0xa7),
    subtle: Rgb(0x9e, 0x97, 0x8b),
    accent: Rgb(0xc9, 0xa8, 0x70),
    activity: Rgb(0xd9, 0xa4, 0x6a),
    warning: Rgb(0xe8, 0x95, 0x5e),
    beta: BETA,
    danger: DANGER,
    success: SUCCESS,
    raised: Rgb(0x25, 0x23, 0x21),
    raised_press: Rgb(0x1e, 0x1c, 0x1a),
    well: Rgb(0x0a, 0x09, 0x08),
    bubble: Rgb(0x16, 0x14, 0x12),
    popover: Rgb(0x24, 0x22, 0x20),
    key: Rgb(0x2e, 0x2b, 0x28),
    primary_press: Rgb(0xcc, 0xc6, 0xba),
};

/// The colours of a theme, with the accent of `hue` degrees when one is chosen (`None`: the theme's own)
pub fn colours(tone: Tone, hue: Option<u16>) -> Colours {
    let mut colours = match tone {
        Tone::Silver => SILVER,
        Tone::Gold => GOLD,
    };
    if let Some(hue) = hue {
        colours.accent = accent_of_hue(hue, relative_luminance(colours.accent));
        colours.warning = warning_beside(hue, colours.warning);
    }
    colours
}

/// An accent of the given hue at a fixed saturation, its lightness found so its luminance is `luminance`: every hue
/// keeps the theme accent's contrast
pub fn accent_of_hue(hue: u16, luminance: f64) -> Rgb {
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    let mut colour = hsl(f64::from(hue % 360), 0.46, 0.5);
    for _ in 0..24 {
        let lightness = (low + high) / 2.0;
        colour = hsl(f64::from(hue % 360), 0.46, lightness);
        if relative_luminance(colour) < luminance {
            low = lightness;
        } else {
            high = lightness;
        }
    }
    colour
}

/// The warning's hue is about 38°; an accent within 25° of it pushes the warning to the far side of its band, so the
/// two never read as one
fn warning_beside(hue: u16, warning: Rgb) -> Rgb {
    let distance = (i32::from(hue % 360) - 38).abs();
    if distance > 25 {
        warning
    } else if hue >= 38 {
        Rgb(0xea, 0x8c, 0x5c)
    } else {
        Rgb(0xe8, 0xd2, 0x5c)
    }
}

fn hsl(hue: f64, saturation: f64, lightness: f64) -> Rgb {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let sector = hue / 60.0;
    let x = chroma * (1.0 - (sector % 2.0 - 1.0).abs());
    let (r, g, b) = match sector as u32 {
        0 => (chroma, x, 0.0),
        1 => (x, chroma, 0.0),
        2 => (0.0, chroma, x),
        3 => (0.0, x, chroma),
        4 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let m = lightness - chroma / 2.0;
    let byte = |v: f64| ((v + m).clamp(0.0, 1.0) * 255.0).round() as u8;
    Rgb(byte(r), byte(g), byte(b))
}

/// The text pairs of a theme that must meet WCAG AA (4.5:1)
pub fn text_pairs(c: &Colours) -> [(&'static str, Rgb, Rgb); 16] {
    [
        ("primary text on the chrome", c.text, c.chrome),
        ("primary text on the canvas", c.text, c.canvas),
        ("primary text on a control", c.text, c.control),
        ("primary text on an active item", c.text, c.control_active),
        ("secondary text on the chrome", c.muted, c.chrome),
        ("secondary text on the canvas", c.muted, c.canvas),
        ("secondary text on a control", c.muted, c.control),
        ("secondary text on a hovered item", c.muted, c.control_hover),
        ("tertiary text on the chrome", c.subtle, c.chrome),
        ("tertiary text on the canvas", c.subtle, c.canvas),
        (
            "tertiary text on an active item",
            c.subtle,
            c.control_active,
        ),
        ("accent on the chrome", c.accent, c.chrome),
        ("accent on an active item", c.accent, c.control_active),
        ("warning on the canvas", c.warning, c.canvas),
        ("beta tag on the canvas", c.beta, c.canvas),
        ("error text on the canvas", c.danger, c.canvas),
    ]
}
