//! The motion tokens (docs/features/motion.md §3): native Slint animation only, short and colour-first, because every
//! animated frame repaints the whole window. Rust picks the values from Settings; `ui/motion.slint` holds them.
//! Reduced motion is deterministic: every duration is zero and nothing scales, so each change shows its end state at
//! once.

use std::time::Duration;

/// The values of the `Motion` global
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    /// A hover appearing
    pub hover_in: Duration,
    /// A hover going away
    pub hover_out: Duration,
    /// Back from pressed, on release
    pub release: Duration,
    /// The leading edge of a pill, and the switch's knob (a spring's natural period; it settles in about 1.5 times this)
    pub glide: Duration,
    /// The trailing edge of a pill: it stretches towards the new row, then closes up on it
    pub trail: Duration,
    /// Tooltips and the sidebar's labels
    pub fade: Duration,
    /// The sidebar's width
    pub panel: Duration,
    /// Hover time before a tooltip shows (a timer, not an animation: it paints nothing while it waits)
    pub tip_wait: Duration,
    /// Scale of a pressed control, in percent
    pub press_scale: f32,
}

const NORMAL: Tokens = Tokens {
    hover_in: Duration::from_millis(40),
    hover_out: Duration::from_millis(90),
    release: Duration::from_millis(70),
    glide: Duration::from_millis(55),
    trail: Duration::from_millis(110),
    fade: Duration::from_millis(80),
    panel: Duration::from_millis(120),
    tip_wait: Duration::from_millis(400),
    press_scale: 97.0,
};

/// The tokens for the reduced-motion preference. The tooltip's wait stays: it is a delay, not motion.
pub fn tokens(reduced_motion: bool) -> Tokens {
    if reduced_motion {
        Tokens {
            hover_in: Duration::ZERO,
            hover_out: Duration::ZERO,
            release: Duration::ZERO,
            glide: Duration::ZERO,
            trail: Duration::ZERO,
            fade: Duration::ZERO,
            panel: Duration::ZERO,
            press_scale: 100.0,
            ..NORMAL
        }
    } else {
        NORMAL
    }
}
