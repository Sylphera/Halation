//! Headless layout checks on the real `.slint` UI (testing backend, no window, no GPU): at the supported window
//! sizes every named control stays inside the window. This proves geometry only, not visual quality.

use halation_app::catalog::TOOLS;
use halation_app::ui::{AppWindow, ConvertRow, FormatRow, JobRow, RecentItem, ToolItem};
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
        for page in [0, 3, 4] {
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
    // Settings: its top bar (title, Activity and the global actions) cannot fit 300 px; the page's own content is
    // clipped by the sheet and so leaves the accessibility tree
    ui.set_page(3);
    slint::platform::update_timers_and_animations();
    assert!(
        !outside(&ui, 300.0, 200.0).is_empty(),
        "a 300x200 window must report controls outside it, or the check proves nothing"
    );
}

#[test]
fn converter_with_files_formats_and_progress_fits_both_sidebar_states() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    ui.set_page(4);
    ui.set_convert_rows(ModelRc::new(VecModel::from(
        (0..20)
            .map(|index| ConvertRow {
                index,
                name: "A deliberately long generated file name for the input list.mkv".into(),
                detail: "Video · H.264 + AAC · 1920 × 1080".into(),
                state: "Converting · 50%".into(),
                target: "MP4".into(),
                selected: index == 0,
                failed: false,
                removable: index > 0,
            })
            .collect::<Vec<_>>(),
    )));
    ui.set_convert_formats(ModelRc::new(VecModel::from(
        [
            "MP4", "MKV", "WEBM", "MOV", "GIF", "MP3", "M4A", "FLAC", "WAV", "OPUS",
        ]
        .into_iter()
        .map(|name| FormatRow {
            id: name.into(),
            name: name.into(),
            detail: "Copies video · re-encodes audio".into(),
            selected: name == "MP4",
            audio: matches!(name, "MP3" | "M4A" | "FLAC" | "WAV" | "OPUS"),
            header: name == "MP3",
            recommended: name == "MP4",
            note: if name == "MP4" {
                "A deliberately long consequence line: re-encodes audio · image subtitles are discarded".into()
            } else {
                Default::default()
            },
        })
        .collect::<Vec<_>>(),
    )));
    ui.set_convert_busy(true);
    ui.set_convert_progress(0.5);
    ui.set_convert_progress_label("Converting a generated test video · 50%".into());
    for (width, height) in SIZES {
        resize(&ui, width, height);
        for rail in [false, true] {
            for files in [false, true] {
                ui.set_rail_open(rail);
                ui.set_convert_left_open(files);
                i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(1000));
                slint::platform::update_timers_and_animations();
                let stray = outside(&ui, width, height);
                assert!(
                    stray.is_empty(),
                    "Converter at {width}x{height}, rail={rail}, files={files}: {stray:?}"
                );
                if files {
                    let panel = ElementHandle::find_by_accessible_label(&ui, "Converter files")
                        .next()
                        .expect("files panel is present");
                    let expected = if rail { 224.0 } else { 62.0 };
                    assert!(
                        (panel.absolute_position().x - expected).abs() < 1.0,
                        "files must be anchored left, not implicitly centred"
                    );
                    assert!((panel.size().width - 220.0).abs() < 1.0);
                }
            }
        }
    }
    // The audio player replaces the canvas placeholder: it stays inside the canvas at every size
    ui.set_convert_audio(true);
    ui.set_convert_wave(halation_core::playback::envelope_path(&[0.2, 1.0, 0.5, 0.0]).into());
    ui.set_convert_wave_bins(4.0);
    ui.set_convert_position(0.5);
    ui.set_convert_clock("12:34 / 1:02:03".into());
    for (width, height) in SIZES {
        resize(&ui, width, height);
        for files in [false, true] {
            ui.set_convert_left_open(files);
            i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(1000));
            slint::platform::update_timers_and_animations();
            let stray = outside(&ui, width, height);
            assert!(
                stray.is_empty(),
                "audio at {width}x{height}, files={files}: {stray:?}"
            );
            let canvas = ElementHandle::find_by_accessible_label(&ui, "Converter canvas")
                .next()
                .expect("canvas is present");
            let player = ElementHandle::find_by_accessible_label(&ui, "Audio preview")
                .next()
                .expect("audio player is present");
            let (c, p) = (canvas.absolute_position(), player.absolute_position());
            assert!(
                p.x >= c.x
                    && p.y >= c.y
                    && p.x + player.size().width <= c.x + canvas.size().width + 0.5
                    && p.y + player.size().height <= c.y + canvas.size().height + 0.5,
                "audio player leaves the canvas at {width}x{height}, files={files}"
            );
        }
    }
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
    // The Collapse row, in the header, toggles it too
    let toggle = |label: &str| {
        ElementHandle::find_by_accessible_label(&ui, label)
            .next()
            .expect("the Collapse row toggles the sidebar")
    };
    toggle("Expand the sidebar (Ctrl+B)").invoke_accessible_default_action();
    slint::platform::update_timers_and_animations();
    assert!(ui.get_rail_open(), "the Collapse row opens it");
    toggle("Collapse the sidebar (Ctrl+B)").invoke_accessible_default_action();
    slint::platform::update_timers_and_animations();
    assert!(!ui.get_rail_open(), "the Collapse row closes it");
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
    // Search and Restore defaults stand on the tabs' row
    assert!(shown("Search settings"), "the search is on the page");
    assert!(shown("Restore defaults"), "Restore defaults is on the page");
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

#[test]
fn home_dock_hover_is_aligned_and_clicks_still_reach_the_tool() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    let activated = Rc::new(std::cell::RefCell::new(String::new()));
    let result = activated.clone();
    ui.on_tool_activated(move |id| *result.borrow_mut() = id.to_string());
    for (w, h) in SIZES {
        resize(&ui, w, h);
        let tool = |label: &str| {
            ElementHandle::find_by_accessible_label(&ui, label)
                .find(|e| e.absolute_position().x > 62.0 && e.size().height > 0.0)
                .expect("tool is on Home, not the sidebar")
        };
        let first = tool("Converter");
        let second = tool("Grade");
        let at = |e: &ElementHandle| {
            let (p, s) = (e.absolute_position(), e.size());
            slint::LogicalPosition::new(p.x + s.width / 2.0, p.y + s.height / 2.0)
        };
        ui.window().dispatch_event(WindowEvent::PointerMoved {
            position: at(&first),
        });
        advance(1000);
        let pill = || {
            ElementHandle::find_by_element_id(&ui, "PillList::hover-pill")
                .find(|e| e.absolute_position().x > 62.0)
                .unwrap()
        };
        let p = pill();
        assert!((p.absolute_position().x - first.absolute_position().x).abs() < 0.5);
        assert!((p.size().width - first.size().width).abs() < 0.5);
        assert!((p.absolute_position().y - first.absolute_position().y).abs() < 0.5);
        ui.window().dispatch_event(WindowEvent::PointerMoved {
            position: at(&second),
        });
        advance(1);
        advance(24);
        assert!(pill().absolute_position().x > first.absolute_position().x);
        assert!(pill().absolute_position().x < second.absolute_position().x);
        advance(1000);
        assert!((pill().absolute_position().x - second.absolute_position().x).abs() < 0.5);
        let button = slint::platform::PointerEventButton::Left;
        ui.window().dispatch_event(WindowEvent::PointerPressed {
            position: at(&second),
            button,
        });
        ui.window().dispatch_event(WindowEvent::PointerReleased {
            position: at(&second),
            button,
        });
        assert_eq!(&*activated.borrow(), "grade");
    }
}

#[test]
fn fusion_uses_one_silhouette_only_during_departure_and_arrival() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    // Drive frames, not one time jump: the edge recovery starts when the position spring settles.
    let settle = || {
        for _ in 0..64 {
            advance(16);
        }
    };
    // Vertical sidebar and horizontal Settings categories share the same fusion renderer.
    for horizontal in [false, true] {
        if horizontal {
            ui.set_page(3);
            advance(1000);
        }
        let point = |label: &str| {
            let e = ElementHandle::find_by_accessible_label(&ui, label)
                .find(|e| {
                    if horizontal {
                        e.absolute_position().x > 62.0 && e.absolute_position().y < 100.0
                    } else {
                        e.absolute_position().x < 40.0
                    }
                })
                .unwrap();
            let (p, s) = (e.absolute_position(), e.size());
            ui.window().dispatch_event(WindowEvent::PointerMoved {
                position: slint::LogicalPosition::new(p.x + s.width / 2.0, p.y + s.height / 2.0),
            });
        };
        let joined = || {
            ElementHandle::find_by_element_id(&ui, "PillList::united-shape").any(|e| {
                if horizontal {
                    e.absolute_position().x > 62.0
                } else {
                    e.absolute_position().x < 40.0
                }
            })
        };
        let (selected, adjacent) = if horizontal {
            ("General", "Interface")
        } else {
            ("Home", "Downloader")
        };
        point(selected);
        settle();
        assert!(!joined(), "rest retains the original pieces");
        point(adjacent);
        advance(1);
        advance(16);
        assert!(
            joined(),
            "departure must be one filled silhouette, horizontal={horizontal}"
        );
        point(if horizontal { "You" } else { "Converter" });
        advance(1);
        assert!(
            joined(),
            "retargeting a still-connected shape must not expose two inner borders"
        );
        settle();
        assert!(!joined(), "neck breaks; original resting borders return");
        point(selected);
        advance(1);
        advance(16);
        assert!(joined(), "arrival must also join without an inner border");
        settle();
        ui.window().dispatch_event(WindowEvent::PointerExited);
        settle();
        assert!(!joined());
    }
    let motion = ui.global::<halation_app::ui::Motion>();
    motion.set_glide(0);
    motion.set_trail(0);
    motion.set_fade(0);
    point_at(&ui, "Settings");
    advance(1);
    point_at(&ui, "Home");
    advance(1);
    assert!(
        ElementHandle::find_by_element_id(&ui, "PillList::united-shape")
            .next()
            .is_none(),
        "reduced motion skips all transient fusion geometry"
    );
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
fn a_steady_sweep_never_stops_the_hover_pill_at_a_row() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    point_at(&ui, "Grade");
    advance(1000);
    // A row every 120 ms: the pill must still be moving when the pointer reaches the next one
    let rows = ["Cover Test", "Background Remover", "Upscale"];
    for (n, row) in rows.iter().enumerate() {
        point_at(&ui, row);
        advance(1);
        let mut last = pill_y(&ui, "PillList::hover-pill");
        for frame in 0..15 {
            advance(8);
            let y = pill_y(&ui, "PillList::hover-pill");
            // From the second crossing on, the pill keeps the sweep's pace
            if n > 0 {
                assert!(
                    y - last > 0.1,
                    "stopped before {row} was left (frame {frame}): {last} -> {y}"
                );
            }
            last = y;
        }
    }
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

#[test]
fn dragging_the_accent_strip_previews_and_releasing_saves() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1280.0, 800.0);
    ui.set_page(3);
    ui.set_settings_category(1);
    slint::platform::update_timers_and_animations();
    let previews = Rc::new(std::cell::RefCell::new(Vec::<i32>::new()));
    let saved = Rc::new(std::cell::RefCell::new(Vec::<(String, String)>::new()));
    let p = previews.clone();
    ui.on_preview_accent(move |hue| p.borrow_mut().push(hue));
    let s = saved.clone();
    ui.on_set_pref(move |key, value| s.borrow_mut().push((key.into(), value.into())));
    let strip = ElementHandle::find_by_accessible_label(&ui, "Accent")
        .find(|e| e.accessible_role() == Some(i_slint_backend_testing::AccessibleRole::Slider))
        .expect("the accent strip is on Interface");
    let (pos, size) = (strip.absolute_position(), strip.size());
    let y = pos.y + size.height / 2.0;
    let at = |fraction: f32| slint::LogicalPosition::new(pos.x + size.width * fraction, y);
    let button = slint::platform::PointerEventButton::Left;
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.2) });
    ui.window().dispatch_event(WindowEvent::PointerPressed {
        position: at(0.2),
        button,
    });
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.5) });
    ui.window().dispatch_event(WindowEvent::PointerReleased {
        position: at(0.5),
        button,
    });
    slint::platform::update_timers_and_animations();
    assert!(
        previews.borrow().len() >= 2,
        "previews: {:?}",
        previews.borrow()
    );
    let last = saved
        .borrow()
        .last()
        .cloned()
        .expect("releasing saves the hue");
    assert_eq!(last.0, "accent-hue");
    let hue: i32 = last.1.parse().unwrap();
    assert!(
        (160..=200).contains(&hue),
        "the middle of the strip is about 180°, got {hue}"
    );
}
