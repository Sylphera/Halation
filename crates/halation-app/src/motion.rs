use std::time::Duration;

pub const FULL_DURATION_MS: u64 = 160;

/// Deterministic duration for native Slint animation. Reduced motion resolves to zero.
pub fn duration(reduced_motion: bool) -> Duration {
    Duration::from_millis(if reduced_motion { 0 } else { FULL_DURATION_MS })
}

pub fn duration_ms(reduced_motion: bool) -> u64 {
    duration(reduced_motion).as_millis() as u64
}
