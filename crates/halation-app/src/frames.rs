//! `--diagnostic-scene frames`: measures frame pacing in the real window, without touching input or the desktop.
//! Three phases of a few seconds each: Home at rest (only the Drape draws), Home while the sidebar opens and closes
//! (an animation over the Drape) and Settings while the sidebar opens and closes (the same animation, no Drape). For
//! each phase it logs the time between presented frames inside an animation, how long rendering took, and how long the
//! frames that took a new Drape image took. Then the app closes itself.

use crate::ui::AppWindow;
use slint::{ComponentHandle, Image, RenderingState, Weak};
use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};

const PHASE: Duration = Duration::from_secs(6);
const TOGGLE: Duration = Duration::from_millis(450);
/// Frames further apart than this are separate bursts, not a dropped frame inside one
const BURST_GAP: Duration = Duration::from_millis(100);

#[derive(Default)]
struct Phase {
    intervals: Vec<f32>,
    renders: Vec<f32>,
    backdrop_renders: Vec<f32>,
}

#[derive(Default)]
struct Recorder {
    before: Option<Instant>,
    last_after: Option<Instant>,
    backdrop: Option<Image>,
    phase: Phase,
}

fn ms(d: Duration) -> f32 {
    d.as_secs_f32() * 1000.0
}

fn summary(name: &str, values: &mut [f32]) -> String {
    if values.is_empty() {
        return format!("{name}: none");
    }
    values.sort_by(f32::total_cmp);
    let at = |q: f32| values[((values.len() - 1) as f32 * q).round() as usize];
    format!(
        "{name}: n={} p50={:.1} p95={:.1} p99={:.1} max={:.1} ms",
        values.len(),
        at(0.5),
        at(0.95),
        at(0.99),
        values[values.len() - 1]
    )
}

fn report(name: &str, mut phase: Phase, log: &dyn Fn(&str)) {
    // An interval over 1.5 times the median is a frame the display waited for twice or more
    let median = {
        let mut sorted = phase.intervals.clone();
        sorted.sort_by(f32::total_cmp);
        sorted.get(sorted.len() / 2).copied().unwrap_or(0.0)
    };
    let late = phase
        .intervals
        .iter()
        .filter(|&&v| v > median * 1.5)
        .count();
    log(&format!(
        "frames {name}: {}; late frames {late}",
        summary("interval", &mut phase.intervals)
    ));
    log(&format!(
        "frames {name}: {}",
        summary("render", &mut phase.renders)
    ));
    log(&format!(
        "frames {name}: {}",
        summary("render with a new Drape image", &mut phase.backdrop_renders)
    ));
}

/// Starts the measurement; `log` writes a line to the beta's log
pub fn start(weak: &Weak<AppWindow>, log: Rc<dyn Fn(&str)>) -> Option<Rc<slint::Timer>> {
    let ui = weak.upgrade()?;
    let recorder = Rc::new(RefCell::new(Recorder::default()));
    let notify = recorder.clone();
    let notifier_ui = weak.clone();
    let installed = ui
        .window()
        .set_rendering_notifier(move |state, _| {
            let now = Instant::now();
            let mut r = notify.borrow_mut();
            match state {
                RenderingState::BeforeRendering => r.before = Some(now),
                RenderingState::AfterRendering => {
                    let render = r.before.take().map(|t| ms(now - t));
                    let backdrop = notifier_ui.upgrade().map(|ui| ui.get_backdrop());
                    let new_backdrop = backdrop.is_some() && backdrop != r.backdrop;
                    r.backdrop = backdrop;
                    if let Some(render) = render {
                        r.phase.renders.push(render);
                        if new_backdrop {
                            r.phase.backdrop_renders.push(render);
                        }
                    }
                    if let Some(last) = r.last_after.replace(now)
                        && now - last < BURST_GAP
                    {
                        r.phase.intervals.push(ms(now - last));
                    }
                }
                _ => {}
            }
        })
        .is_ok();
    if !installed {
        log("frames: this renderer gives no rendering notifications");
        return None;
    }
    log(
        "frames: measuring Home at rest, Home with the sidebar moving, Settings with the sidebar moving",
    );

    let timer = Rc::new(slint::Timer::default());
    let weak = weak.clone();
    let started = Instant::now();
    let mut done = 0;
    let mut last_toggle = Instant::now();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(50),
        move || {
            let Some(ui) = weak.upgrade() else {
                return;
            };
            let phase = (started.elapsed().as_millis() / PHASE.as_millis()) as usize;
            if phase > done {
                let finished = std::mem::take(&mut recorder.borrow_mut().phase);
                report(
                    ["home-rest", "home-motion", "settings-motion"][done],
                    finished,
                    &*log,
                );
                done = phase;
                match phase {
                    2 => ui.invoke_navigate(3),
                    3 => {
                        log("frames: done");
                        let _ = slint::quit_event_loop();
                        return;
                    }
                    _ => {}
                }
            }
            if phase >= 1 && last_toggle.elapsed() >= TOGGLE {
                last_toggle = Instant::now();
                ui.set_rail_open(!ui.get_rail_open());
            }
        },
    );
    Some(timer)
}
