//! Headless layout checks on the real `.slint` UI (testing backend, no window, no GPU): at the supported window
//! sizes every named control stays inside the window. This proves geometry only, not visual quality.

use halation_app::catalog::TOOLS;
use halation_app::ui::{
    AppWindow, ItemRow, JobRow, LibraryRow, Prefs, RecentItem, SectionRow, ToolItem,
};
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
            pitch: tool.pitch.into(),
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
    ui.set_sections(ModelRc::from(Rc::new(VecModel::from(vec![SectionRow {
        id: "own:Covers".into(),
        name: "A section with a really quite long name indeed".into(),
        kind: "own".into(),
        count: 3,
        missing: false,
        selected: true,
    }]))));
    ui.set_section_items(ModelRc::from(Rc::new(VecModel::from(vec![ItemRow {
        name: "a-file-with-a-long-name-that-will-need-eliding-in-the-list.png".into(),
        detail: "1.2 MB".into(),
    }]))));
    ui.set_section_id(SharedString::from("own:Covers"));
    ui.set_section_name(SharedString::from(
        "A section with a really quite long name indeed",
    ));
    ui.set_section_kind(SharedString::from("own"));
    ui.set_sections_loaded(true);
    ui.set_library_loaded(true);
    ui.set_library_writable(true);
    ui.set_library_rows(ModelRc::from(Rc::new(VecModel::from(vec![LibraryRow {
        id: "r_000001".into(),
        name: "a-file-with-a-long-name-that-will-need-eliding-in-the-workspace.flac".into(),
        path: "D:/A folder/with a long path/that keeps going/a-file.flac".into(),
        missing: true,
        kind: "Audio".into(),
    }]))));

    for (w, h) in SIZES {
        resize(&ui, w, h);
        for page in [0, 1, 3] {
            ui.set_page(page);
            slint::platform::update_timers_and_animations();
            // The Workspace scrolls under the top bar (44 px); Settings' pane under the top bar and the category
            // title, which end 100 px down
            let stray = outside_above(&ui, w, h, if page == 3 { 100.0 } else { 44.0 });
            assert!(stray.is_empty(), "page {page} at {w}x{h}: {stray:?}");
        }
        // Workspace, Sections tab (set directly: below the fold the tab is scrolled out of the accessibility tree)
        ui.set_page(0);
        ui.set_library_mode(1);
        slint::platform::update_timers_and_animations();
        let stray = outside_above(&ui, w, h, 44.0);
        assert!(stray.is_empty(), "sections tab at {w}x{h}: {stray:?}");
        ui.set_library_mode(0);
    }
}

#[test]
fn the_check_does_detect_a_window_that_is_too_small() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    resize(&ui, 300.0, 200.0);
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
    // Pages and the sidebar entry that marks each: the Workspace holds Home, the Library (1) and the jobs
    let places = [(0, "Workspace"), (3, "Settings")];
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
fn the_sidebar_follows_the_window_width_the_setting_and_ctrl_b() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    // "Expand when needed", the default: collapsed on the Workspace, which presents the tools itself; elsewhere open
    // from 1180 px, collapsed below
    ui.set_prefs(Prefs {
        dock_mode: 1,
        show_dock: true,
        ..Prefs::default()
    });
    resize(&ui, 1280.0, 800.0);
    assert!(!ui.get_rail_open(), "collapsed on the Workspace");
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    assert!(ui.get_rail_open(), "open at 1280 px on Settings");
    resize(&ui, 1100.0, 700.0);
    assert!(!ui.get_rail_open(), "collapsed at 1100 px");
    press_ctrl_b(&ui);
    assert!(ui.get_rail_open(), "Ctrl+B opens it");
    press_ctrl_b(&ui);
    assert!(!ui.get_rail_open(), "Ctrl+B closes it again");
    // "Keep open" keeps it open in a narrow window; "Compact" keeps it closed in a wide one
    ui.set_prefs(Prefs {
        dock_mode: 2,
        show_dock: true,
        ..Prefs::default()
    });
    // `changed` handlers run on the next pass of the event loop
    slint::platform::update_timers_and_animations();
    assert!(ui.get_rail_open(), "keep open at 1100 px");
    ui.set_prefs(Prefs {
        dock_mode: 0,
        show_dock: true,
        ..Prefs::default()
    });
    resize(&ui, 1920.0, 1080.0);
    assert!(!ui.get_rail_open(), "compact at 1920 px");
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
