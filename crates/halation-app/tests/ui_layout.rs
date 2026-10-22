//! Headless layout checks on the real `.slint` UI (testing backend, no window, no GPU): at the supported window
//! sizes every named control stays inside the window. This proves geometry only, not visual quality.

use halation_app::catalog::TOOLS;
use halation_app::ui::{AppWindow, JobRow, RecentItem, ToolItem};
use i_slint_backend_testing::{ElementHandle, ElementQuery};
use slint::{
    ComponentHandle, LogicalSize, ModelRc, SharedString, VecModel,
    platform::{Key, WindowEvent},
};
use std::rc::Rc;

const SIZES: [(f32, f32); 4] = [
    (960.0, 600.0),
    (1100.0, 700.0),
    (1280.0, 800.0),
    (1920.0, 1080.0),
];

fn resize(ui: &AppWindow, w: f32, h: f32) {
    // The testing backend does not resize the root item by itself; a resize event is what a real window sends.
    ui.window().set_size(LogicalSize::new(w, h));
    ui.window().dispatch_event(WindowEvent::Resized {
        size: LogicalSize::new(w, h),
    });
    // Let the rail's size animation finish
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(1000));
    slint::platform::update_timers_and_animations();
}

/// Names of the labelled controls that stick out of the window
fn outside(ui: &AppWindow, w: f32, h: f32) -> Vec<String> {
    outside_above(ui, w, h, f32::MAX)
}

/// Like `outside`, for a page that scrolls below `scroll_top`: controls that start below it are only checked
/// sideways, since what lies past the window's bottom is reached by scrolling
fn outside_above(ui: &AppWindow, w: f32, h: f32, scroll_top: f32) -> Vec<String> {
    ElementQuery::from_root(ui)
        .match_descendants()
        .match_predicate(|e| e.accessible_label().is_some_and(|l| !l.is_empty()))
        .find_all()
        .into_iter()
        .filter_map(|e| {
            let (pos, size) = (e.absolute_position(), e.size());
            if size.width <= 0.0 || size.height <= 0.0 {
                return None;
            }
            let sideways = pos.x < -0.5 || pos.x + size.width > w + 0.5;
            let bad = if pos.y >= scroll_top {
                sideways
            } else {
                sideways || pos.y < -0.5 || pos.y + size.height > h + 0.5
            };
            bad.then(|| {
                format!(
                    "{:?} at ({:.0},{:.0}) {:.0}x{:.0}",
                    e.accessible_label().unwrap_or_default(),
                    pos.x,
                    pos.y,
                    size.width,
                    size.height
                )
            })
        })
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// What the controller installs for Home and the rail: every tool turned on, and three recent files
fn fill_home(ui: &AppWindow) {
    let tools: Vec<ToolItem> = TOOLS
        .iter()
        .map(|tool| ToolItem {
            id: tool.id.into(),
            name: tool.name.into(),
            icon: tool.icon.into(),
            summary: tool.summary.into(),
            group: tool.group,
            beta: tool.beta,
            enabled: true,
            missing: tool.missing.into(),
            available: tool.available,
            reason: tool.reason.into(),
        })
        .collect();
    let model = ModelRc::from(Rc::new(VecModel::from(tools)));
    ui.set_tools(model.clone());
    ui.set_active_tools(model);
    let recent: Vec<RecentItem> = [
        "a-rather-long-song-title-for-the-panel.wav",
        "b.png",
        "c.mp4",
    ]
    .iter()
    .map(|name| RecentItem {
        id: (*name).into(),
        name: (*name).into(),
        folder: "A folder with a long name".into(),
    })
    .collect();
    ui.set_recent(ModelRc::from(Rc::new(VecModel::from(recent))));
}

#[test]
fn pages_keep_their_controls_inside_the_window_at_supported_sizes() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    ui.set_jobs(ModelRc::from(Rc::new(VecModel::from(vec![JobRow {
        id: "j_000001".into(),
        name: "A very long job title that must be elided instead of pushing the Cancel button out of the row.png".into(),
        detail: "stage detail".into(),
        state: "Running".into(),
        progress: 0.4,
        has_progress: true,
        cancellable: true,
        finished: false,
        failed: false,
    }]))));
    for (w, h) in SIZES {
        resize(&ui, w, h);
        for page in [0, 3] {
            ui.set_page(page);
            slint::platform::update_timers_and_animations();
            // Settings' pane scrolls under the top bar and the category title, which end 100 px down
            let stray = outside_above(&ui, w, h, if page == 3 { 100.0 } else { f32::MAX });
            assert!(stray.is_empty(), "page {page} at {w}x{h}: {stray:?}");
        }
    }
}

#[test]
fn the_check_does_detect_a_window_that_is_too_small() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    resize(&ui, 300.0, 200.0);
    // Settings: its top bar (search, Restore defaults and the global actions) cannot fit 300 px; the page's own
    // content is clipped by the sheet and so leaves the accessibility tree
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    assert!(
        !outside(&ui, 300.0, 200.0).is_empty(),
        "a 300x200 window must report controls outside it, or the check proves nothing"
    );
}

#[test]
fn the_rail_marks_the_current_page_and_lists_the_tools() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    // Pages and the sidebar entry that marks each: Home and Settings
    let places = [(0, "Home"), (3, "Settings")];
    for (page, _) in places {
        ui.set_page(page);
        slint::platform::update_timers_and_animations();
        for (other, place) in places {
            let selected = ElementQuery::from_root(&ui)
                .match_descendants()
                .match_predicate(move |e| {
                    e.accessible_label().is_some_and(|label| label == place)
                        && e.accessible_item_selected() == Some(true)
                })
                .find_all();
            assert_eq!(
                !selected.is_empty(),
                other == page,
                "rail item {place} on page {page}"
            );
        }
        let downloader = ElementHandle::find_by_accessible_label(&ui, "Downloader").count();
        assert!(downloader >= 1, "the rail lists the tools on page {page}");
    }
}

fn press_ctrl_b(ui: &AppWindow) {
    let control = SharedString::from(Key::Control);
    let b = SharedString::from("b");
    ui.window().dispatch_event(WindowEvent::KeyPressed {
        text: control.clone(),
    });
    ui.window()
        .dispatch_event(WindowEvent::KeyPressed { text: b.clone() });
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text: b });
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text: control });
}

#[test]
fn the_sidebar_starts_collapsed_and_ctrl_b_toggles_it() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    // Collapsed at every width; it never opens by itself
    for (w, h) in SIZES {
        resize(&ui, w, h);
        assert!(!ui.get_rail_open(), "collapsed at {w}x{h}");
    }
    press_ctrl_b(&ui);
    assert!(ui.get_rail_open(), "Ctrl+B opens it");
    // It stays open from page to page
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    assert!(ui.get_rail_open(), "still open on Settings");
    press_ctrl_b(&ui);
    assert!(!ui.get_rail_open(), "Ctrl+B closes it again");
    // Collapsed, the tools stay reachable by their names
    assert!(ElementHandle::find_by_accessible_label(&ui, "Downloader").count() >= 1);
}

#[test]
fn settings_shows_one_category_at_a_time() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    let shown = |label: &str| ElementHandle::find_by_accessible_label(&ui, label).count() > 0;
    assert!(shown("Language"), "General is the first category");
    assert!(
        !shown("Processor jobs at once"),
        "Processing is not shown with General"
    );
    let processing = ElementHandle::find_by_accessible_label(&ui, "Processing")
        .next()
        .expect("the Processing category exists");
    processing.invoke_accessible_default_action();
    slint::platform::update_timers_and_animations();
    assert_eq!(ui.get_settings_category(), 4);
    assert!(
        shown("Processor jobs at once"),
        "Processing shows its settings"
    );
    assert!(!shown("Language"), "General's settings are gone");
}

fn advance(ms: u64) {
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(ms));
    slint::platform::update_timers_and_animations();
}

fn point_at(ui: &AppWindow, label: &str) -> (f32, f32) {
    // The sidebar's row (Home's strip and the top bar may hold the same name)
    let row = ElementHandle::find_by_accessible_label(ui, label)
        .find(|e| e.absolute_position().x < 40.0 && e.size().width > 0.0)
        .unwrap_or_else(|| panic!("{label} is in the sidebar"));
    let (pos, size) = (row.absolute_position(), row.size());
    let (x, y) = (pos.x + size.width / 2.0, pos.y + size.height / 2.0);
    ui.window().dispatch_event(WindowEvent::PointerMoved {
        position: slint::LogicalPosition::new(x, y),
    });
    (x, y)
}

fn pill_y(ui: &AppWindow, id: &str) -> f32 {
    // The sidebar's (the strip and the categories have their own)
    let pills: Vec<_> = ElementHandle::find_by_element_id(ui, id)
        .filter(|e| e.absolute_position().x < 40.0)
        .collect();
    assert!(!pills.is_empty(), "{id} exists in the sidebar");
    let p = pills[0].absolute_position();
    p.y + pills[0].size().height / 2.0
}

fn pill_height(ui: &AppWindow, id: &str) -> f32 {
    ElementHandle::find_by_element_id(ui, id)
        .find(|e| e.absolute_position().x < 40.0)
        .unwrap_or_else(|| panic!("{id} exists in the sidebar"))
        .size()
        .height
}

#[test]
fn the_sidebar_hover_pill_follows_the_pointer_and_glides() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    let (_, first) = point_at(&ui, "Downloader");
    advance(1000);
    let pill = pill_y(&ui, "PillList::hover-pill");
    assert!(
        (pill - first).abs() < 1.0,
        "the pill sits on the hovered row: {pill} vs {first}"
    );
    let rest = pill_height(&ui, "PillList::hover-pill");
    // To another row: on its way after a few frames, there once settled
    let (_, second) = point_at(&ui, "Settings");
    advance(32);
    let moving = pill_y(&ui, "PillList::hover-pill");
    assert!(
        moving > first + 1.0 && moving < second - 1.0,
        "glides: {first} -> {moving} -> {second}"
    );
    // The leading edge is ahead of the trailing one: the pill stretches on its way and closes up on arrival
    let stretched = pill_height(&ui, "PillList::hover-pill");
    assert!(stretched > rest + 4.0, "stretches: {rest} -> {stretched}");
    advance(1000);
    let pill = pill_y(&ui, "PillList::hover-pill");
    assert!(
        (pill - second).abs() < 1.0,
        "lands on the new row: {pill} vs {second}"
    );
    let landed = pill_height(&ui, "PillList::hover-pill");
    assert!((landed - rest).abs() < 1.0, "closes up: {landed} vs {rest}");
}

#[test]
fn a_sweep_over_several_rows_keeps_the_hover_pill_moving() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    point_at(&ui, "Downloader");
    advance(1000);
    // Across one row and on to the next before the pill arrives
    point_at(&ui, "Converter");
    advance(1);
    advance(16);
    let before = pill_y(&ui, "PillList::hover-pill");
    point_at(&ui, "Vocal Remover");
    advance(1);
    let after = pill_y(&ui, "PillList::hover-pill");
    // The retarget keeps its speed: no stop at the row it passed
    assert!(
        after - before > 1.0,
        "keeps moving through a retarget: {before} -> {after}"
    );
}

#[test]
fn a_faster_sweep_gives_a_faster_hover_pill() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    // How much of the way to `to` is left 30 ms after the pointer reaches it
    let left = |from: f32, to: f32| {
        advance(1);
        advance(30);
        (to - pill_y(&ui, "PillList::hover-pill")).abs() / (to - from).abs()
    };
    // Slow: the pointer rests on a row before moving on
    let (_, start) = point_at(&ui, "Background Remover");
    advance(1000);
    let (_, next) = point_at(&ui, "Upscale");
    let slow = left(start, next);
    // Faster: the same last step, after rows crossed 90 ms apart (the pill has about settled on each)
    point_at(&ui, "Grade");
    advance(1000);
    for row in ["Cover Test", "Background Remover"] {
        point_at(&ui, row);
        advance(1);
        advance(90);
    }
    let start = pill_y(&ui, "PillList::hover-pill");
    let (_, next) = point_at(&ui, "Upscale");
    let fast = left(start, next);
    assert!(
        fast < slow * 0.9,
        "faster pointer, faster pill: {fast} vs {slow}"
    );
}

#[test]
fn the_selection_pill_glides_to_the_page_and_reduced_motion_places_pills_at_once() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    let row = |label: &str| {
        let e = ElementHandle::find_by_accessible_label(&ui, label)
            .find(|e| e.absolute_position().x < 40.0 && e.size().width > 0.0)
            .unwrap();
        e.absolute_position().y + e.size().height / 2.0
    };
    let (home, settings) = (row("Home"), row("Settings"));
    let pill = || pill_y(&ui, "PillList::selection");
    assert!(
        (pill() - home).abs() < 1.0,
        "on Home from the start: {} vs {home}",
        pill()
    );
    ui.set_page(3);
    // The row learns it is active on the next frame; the pill sets off from there
    advance(1);
    advance(32);
    assert!(
        pill() > home + 1.0 && pill() < settings - 1.0,
        "glides to Settings"
    );
    advance(1000);
    assert!((pill() - settings).abs() < 1.0, "lands on Settings");

    // Reduced motion: the end state on the next frame, for both pills
    let tokens = halation_app::motion::tokens(true);
    let motion = ui.global::<halation_app::ui::Motion>();
    let ms = |d: std::time::Duration| d.as_millis() as i64;
    motion.set_glide(ms(tokens.glide));
    motion.set_trail(ms(tokens.trail));
    motion.set_hover_in(ms(tokens.hover_in));
    motion.set_hover_out(ms(tokens.hover_out));
    ui.set_page(0);
    advance(1);
    advance(1);
    assert!((pill() - home).abs() < 1.0, "selection at once");
    point_at(&ui, "Downloader");
    advance(1);
    let (_, to) = point_at(&ui, "Settings");
    advance(1);
    advance(1);
    assert!(
        (pill_y(&ui, "PillList::hover-pill") - to).abs() < 1.0,
        "hover at once"
    );
}
