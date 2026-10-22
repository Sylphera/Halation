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

/// Where Home's drop zone starts, from its accessible label
fn drop_zone_x(ui: &AppWindow) -> f32 {
    ElementHandle::find_by_accessible_label(ui, "Drop a song or an image, or click to browse")
        .next()
        .expect("Home shows the drop zone")
        .absolute_position()
        .x
}

#[test]
fn the_sidebar_opens_over_home_without_moving_it() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    // Collapsed at every width; it never opens by itself
    for (w, h) in SIZES {
        resize(&ui, w, h);
        assert!(!ui.get_rail_open(), "collapsed at {w}x{h}");
    }
    resize(&ui, 1280.0, 800.0);
    let closed = drop_zone_x(&ui);
    press_ctrl_b(&ui);
    assert!(ui.get_rail_open(), "Ctrl+B opens it");
    resize(&ui, 1280.0, 800.0);
    assert!(
        (drop_zone_x(&ui) - closed).abs() < 0.5,
        "Home stays in place when the sidebar opens"
    );
    // Choosing a page closes it again
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    assert!(!ui.get_rail_open(), "closed after choosing a page");
    press_ctrl_b(&ui);
    assert!(ui.get_rail_open(), "Ctrl+B opens it on Settings");
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
