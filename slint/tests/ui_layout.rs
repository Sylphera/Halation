//! Headless layout checks on the real `.slint` UI (testing backend, no window, no GPU): at the supported window
//! sizes every named control stays inside the window. This proves geometry only, not visual quality.

use halation_slint::catalog::TOOLS;
use halation_slint::ui::{AppWindow, ItemRow, JobRow, RecentItem, SectionRow, ToolItem};
use i_slint_backend_testing::{ElementHandle, ElementQuery};
use slint::{ComponentHandle, LogicalSize, ModelRc, SharedString, VecModel, platform::WindowEvent};
use std::rc::Rc;

const SIZES: [(f32, f32); 3] = [(960.0, 600.0), (1100.0, 700.0), (1280.0, 800.0)];

fn resize(ui: &AppWindow, w: f32, h: f32) {
    // The testing backend does not resize the root item by itself; a resize event is what a real window sends.
    ui.window().set_size(LogicalSize::new(w, h));
    ui.window().dispatch_event(WindowEvent::Resized {
        size: LogicalSize::new(w, h),
    });
    slint::platform::update_timers_and_animations();
}

/// Names of the labelled controls that stick out of the window
fn outside(ui: &AppWindow, w: f32, h: f32) -> Vec<String> {
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
            let bad = pos.x < -0.5
                || pos.y < -0.5
                || pos.x + size.width > w + 0.5
                || pos.y + size.height > h + 0.5;
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

/// The Home launcher content the controller installs: every tool except Library, and three recent files
fn fill_home(ui: &AppWindow) {
    let tools: Vec<ToolItem> = TOOLS
        .iter()
        .filter(|tool| tool.id != "library")
        .map(|tool| ToolItem {
            id: tool.id.into(),
            name: tool.name.into(),
            icon: tool.icon.into(),
            summary: tool.summary.into(),
            available: tool.available,
            reason: tool.reason.into(),
        })
        .collect();
    ui.set_tools(ModelRc::from(Rc::new(VecModel::from(tools))));
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

    for (w, h) in SIZES {
        resize(&ui, w, h);
        for page in 0..4 {
            ui.set_page(page);
            slint::platform::update_timers_and_animations();
            let stray = outside(&ui, w, h);
            assert!(stray.is_empty(), "page {page} at {w}x{h}: {stray:?}");
        }
        // Library, Sections tab
        ui.set_page(1);
        let tab = ElementHandle::find_by_accessible_label(&ui, "Sections")
            .next()
            .expect("the Sections tab exists");
        tab.invoke_accessible_default_action();
        slint::platform::update_timers_and_animations();
        let stray = outside(&ui, w, h);
        assert!(stray.is_empty(), "sections tab at {w}x{h}: {stray:?}");
        let back = ElementHandle::find_by_accessible_label(&ui, "References")
            .next()
            .expect("the References tab exists");
        back.invoke_accessible_default_action();
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
fn the_rail_holds_places_only_and_marks_the_current_one() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    let places = ["Home", "Library", "Jobs", "Settings"];
    for page in 0..4 {
        ui.set_page(page);
        slint::platform::update_timers_and_animations();
        for (index, place) in places.iter().enumerate() {
            let item = ElementHandle::find_by_accessible_label(&ui, place)
                .next()
                .unwrap_or_else(|| panic!("rail item {place} exists"));
            assert_eq!(
                item.accessible_item_selected(),
                Some(index == page as usize),
                "rail item {place} on page {page}"
            );
        }
        // Tools are launched from Home only: away from Home no tool control exists.
        let tool_controls = ElementQuery::from_root(&ui)
            .match_descendants()
            .match_predicate(|e| {
                e.accessible_label()
                    .is_some_and(|label| label.starts_with("Downloader"))
            })
            .find_all();
        assert_eq!(
            !tool_controls.is_empty(),
            page == 0,
            "Downloader controls on page {page}"
        );
    }
}
