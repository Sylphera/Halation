//! Headless layout checks on the real `.slint` UI (testing backend, no window, no GPU): at the supported window
//! sizes every named control stays inside the window. This proves geometry only, not visual quality.

use halation_app::catalog::TOOLS;
use halation_app::ui::{
    AppWindow, ConvertRow, FormatRow, FrameDestinationRow, FrameLayoutRow, FrameQueueRow,
    FrameResultRow, FrameStrings, JobRow, RecentItem, ShellStrings, ToolItem,
};
use i_slint_backend_testing::{AccessibleRole, ElementHandle, ElementQuery};
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
    ui.set_settings_label("Settings".into());
    ui.set_shell_strings(ShellStrings {
        actions: "Application actions".into(),
        activity: "Activity".into(),
        shortcuts: "Keyboard shortcuts".into(),
        folder: "Halation folder".into(),
        session: "Save Session".into(),
        dismiss: "Dismiss".into(),
    });
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
    ui.set_active_tools(ModelRc::new(VecModel::from(
        TOOLS
            .iter()
            .filter(|tool| tool.id != "library")
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
            .collect::<Vec<_>>(),
    )));
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
        for page in [0, 3, 4, 5] {
            ui.set_page(page);
            slint::platform::update_timers_and_animations();
            // Settings' pane scrolls under the top bar and the category title, which end 100 px down
            let stray = outside_above(&ui, w, h, if page == 3 { 100.0 } else { f32::MAX });
            assert!(stray.is_empty(), "page {page} at {w}x{h}: {stray:?}");
        }
    }
}

#[test]
fn every_page_has_no_global_bar_and_keeps_its_frame_inset() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    let mut prefs = ui.get_prefs();
    prefs.show_dock = true;
    ui.set_prefs(prefs);
    let navigated = Rc::new(std::cell::RefCell::new(Vec::new()));
    let events = navigated.clone();
    ui.on_navigate(move |page| events.borrow_mut().push(page));

    for (width, height) in [(960.0, 600.0), (1440.0, 900.0), (1860.0, 960.0)] {
        resize(&ui, width, height);
        for rail in [false, true] {
            ui.set_rail_open(rail);
            for page in [0, 3, 4, 5] {
                ui.set_page(page);
                advance(1000);
                let sheet = ElementHandle::find_by_element_id(&ui, "AppWindow::page-sheet")
                    .next()
                    .expect("the rounded page frame exists");
                let position = sheet.absolute_position();
                let size = sheet.size();
                assert_eq!(position.y, 8.0);
                assert_eq!(
                    position.x,
                    if page == 0 {
                        8.0
                    } else if rail {
                        224.0
                    } else {
                        62.0
                    }
                );
                assert_eq!(position.y + size.height, height - 8.0);
                assert_eq!(position.x + size.width, width - 8.0);
                assert_eq!(
                    ElementHandle::find_by_element_id(&ui, "AppWindow::global-bar").count(),
                    0,
                    "global bar visibility on page {page}"
                );
                assert_eq!(
                    ElementHandle::find_by_accessible_label(&ui, "Halation folder").count(),
                    usize::from(page == 3),
                    "application actions belong inside Settings only"
                );
                let settings = ElementHandle::find_by_accessible_label(&ui, "Settings")
                    .filter(|e| e.accessible_role() == Some(AccessibleRole::Button))
                    .collect::<Vec<_>>();
                assert_eq!(settings.len(), 1);
                if let Some(button) = settings.first() {
                    let p = button.absolute_position();
                    let s = button.size();
                    if page == 0 {
                        assert!(
                            p.x > 8.0 && p.y > 8.0,
                            "Settings belongs to the central Home dock"
                        );
                    } else {
                        assert!(
                            p.x < if rail { 224.0 } else { 62.0 },
                            "Settings belongs to the sidebar"
                        );
                    }
                    let at = slint::LogicalPosition::new(p.x + s.width / 2.0, p.y + s.height / 2.0);
                    let pointer = slint::platform::PointerEventButton::Left;
                    ui.window().dispatch_event(WindowEvent::PointerPressed {
                        position: at,
                        button: pointer,
                    });
                    ui.window().dispatch_event(WindowEvent::PointerReleased {
                        position: at,
                        button: pointer,
                    });
                    assert_eq!(navigated.borrow_mut().pop(), Some(3));
                }
            }
        }
    }
    // Dock navigation remains reachable even if the optional global action group is disabled.
    ui.set_page(0);
    let mut prefs = ui.get_prefs();
    prefs.show_dock = false;
    ui.set_prefs(prefs);
    advance(1000);
    assert!(
        ElementHandle::find_by_accessible_label(&ui, "Settings")
            .any(|e| e.accessible_role() == Some(AccessibleRole::Button))
    );
}

#[test]
fn application_actions_are_clickable_inside_settings() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    ui.set_page(3);
    resize(&ui, 1440.0, 900.0);
    let actions = Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
    let events = actions.clone();
    ui.on_dock_action(move |action| events.borrow_mut().push(action.into()));
    for (label, command) in [
        ("Activity", "activity"),
        ("Keyboard shortcuts", "shortcuts"),
        ("Halation folder", "folder"),
        ("Save Session", "session"),
    ] {
        let button = ElementHandle::find_by_accessible_label(&ui, label)
            .find(|e| e.accessible_role() == Some(AccessibleRole::Button))
            .unwrap();
        let p = button.absolute_position();
        let s = button.size();
        assert!(p.y > 8.0 && p.y + s.height < 892.0);
        let position = slint::LogicalPosition::new(p.x + s.width / 2.0, p.y + s.height / 2.0);
        let pointer = slint::platform::PointerEventButton::Left;
        ui.window().dispatch_event(WindowEvent::PointerPressed {
            position,
            button: pointer,
        });
        ui.window().dispatch_event(WindowEvent::PointerReleased {
            position,
            button: pointer,
        });
        assert_eq!(actions.borrow_mut().pop().as_deref(), Some(command));
    }
    assert!(
        ElementHandle::find_by_accessible_label(&ui, "Language")
            .next()
            .is_some()
    );
    ui.set_notice("Session persistence is not connected in this beta yet.".into());
    advance(1000);
    assert!(
        ElementHandle::find_by_accessible_label(&ui, "Dismiss")
            .any(|e| e.accessible_role() == Some(AccessibleRole::Button))
    );
}

#[test]
fn home_navigation_animates_the_sidebar_and_reduced_motion_is_immediate() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    resize(&ui, 1440.0, 900.0);
    let sheet_x = || {
        ElementHandle::find_by_element_id(&ui, "AppWindow::page-sheet")
            .next()
            .unwrap()
            .absolute_position()
            .x
    };
    assert_eq!(sheet_x(), 8.0);
    ui.set_rail_open(true);
    ui.set_page(3);
    advance(1);
    advance(48);
    let midway = sheet_x();
    assert!(
        midway > 8.0 && midway < 224.0,
        "sidebar reveals smoothly: {midway}"
    );
    ui.set_page(0);
    advance(1);
    assert!(
        sheet_x() <= midway + 1.0,
        "returning Home retargets without a jump"
    );
    advance(1000);
    assert_eq!(sheet_x(), 8.0);
    ui.global::<halation_app::ui::Motion>().set_panel(0);
    ui.set_page(3);
    advance(1);
    assert_eq!(sheet_x(), 224.0);
    ui.set_page(0);
    advance(1);
    assert_eq!(sheet_x(), 8.0);
}

#[test]
fn the_check_does_detect_a_window_that_is_too_small() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    resize(&ui, 300.0, 200.0);
    // Settings' tabs cannot fit 300 px; this intentionally unsupported size verifies that the bounds check detects it.
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

fn frame_strings() -> FrameStrings {
    FrameStrings {
        title: "Frame Capture".into(),
        queue: "Queue".into(),
        browse: "Browse video".into(),
        open: "Open video".into(),
        browse_short: "Browse".into(),
        open_short: "Open".into(),
        replace_video: "Replace video".into(),
        replace_short: "Replace".into(),
        inspector_short: "Inspector".into(),
        inspector: "Frame Capture inspector".into(),
        inspector_tabs: "Frame Capture inspector tabs".into(),
        inspector_capture: "Capture".into(),
        output: "Output".into(),
        show_queue: "Show queue".into(),
        hide_queue: "Hide queue".into(),
        show_inspector: "Show inspector".into(),
        hide_inspector: "Hide inspector".into(),
        timeline: "Timeline".into(),
        crop: "Crop".into(),
        ..Default::default()
    }
}

#[test]
fn frame_capture_fits_every_sidebar_and_panel_state_and_anchors_its_panels() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    ui.set_page(5);
    ui.set_frame_strings(frame_strings());
    ui.set_frame_has_video(true);
    ui.set_frame_needs_ffmpeg(false);
    ui.set_frame_action_label("Capture 2".into());
    ui.set_frame_can_capture(true);
    ui.set_frame_has_preview(true);
    ui.set_frame_has_strip(true);
    ui.set_frame_video_width(1920);
    ui.set_frame_video_height(1080);
    ui.set_frame_frames(300);
    ui.set_frame_current(150);
    ui.set_frame_frame_label("Frame 151 of 300".into());
    ui.set_frame_clock("0:05.00 / 0:10.00".into());
    ui.set_frame_sharp_note("Sharpest frame near here: frame 149".into());
    ui.set_frame_selected_label("2 selected".into());
    ui.set_frame_crop_visible(true);
    ui.set_frame_crop_x(0.1);
    ui.set_frame_crop_y(0.1);
    ui.set_frame_crop_w(0.5);
    ui.set_frame_crop_h(0.5);
    ui.set_frame_can_capture(true);
    ui.set_frame_needs_ffmpeg(false);
    ui.set_frame_left_open(true);
    ui.set_frame_inspector_open(true);
    ui.set_frame_busy(true);
    ui.set_frame_message(
        "A deliberately long status line that has to wrap inside the canvas instead of leaving it."
            .into(),
    );
    ui.set_frame_progress(0.5);
    ui.set_frame_progress_label("Capturing 4 of 8 frames".into());
    ui.set_frame_queue(ModelRc::new(VecModel::from(
        (0..8)
            .map(|index| FrameQueueRow {
                index,
                n: index * 37,
                label: format!("Frame {}", index + 1).into(),
                time: "0:00.00".into(),
                selected: index % 2 == 0,
                thumb: Default::default(),
            })
            .collect::<Vec<_>>(),
    )));
    ui.set_frame_layouts(ModelRc::new(VecModel::from(
        [
            ("16:9", "16:9", "Widescreen"),
            ("9:16", "9:16", "Portrait"),
            ("1:1", "1:1", "Square"),
            ("4:5", "4:5", "Portrait feed"),
            ("original", "Original", "Whole frame"),
        ]
        .into_iter()
        .map(|(id, label, detail)| FrameLayoutRow {
            id: id.into(),
            label: label.into(),
            detail: format!("A deliberately long detail for {detail} that must elide").into(),
            selected: id == "16:9",
        })
        .collect::<Vec<_>>(),
    )));
    ui.set_frame_destinations(ModelRc::new(VecModel::from(
        [
            ("library", "Library", "Saved with the Library"),
            ("image", "Image", "Saved where images go"),
        ]
        .into_iter()
        .map(|(id, label, detail)| FrameDestinationRow {
            id: id.into(),
            label: label.into(),
            detail: detail.into(),
            selected: id == "library",
        })
        .collect::<Vec<_>>(),
    )));
    ui.set_frame_results(ModelRc::new(VecModel::from(
        (0..12)
            .map(|index| FrameResultRow {
                index,
                name: format!("Synthetic video - frame {}.png", index + 1).into(),
                detail: "Frame 2 · 0:00.10 · 180 × 180".into(),
                path: format!("Z:/not-real/result-{index}.png").into(),
            })
            .collect::<Vec<_>>(),
    )));
    let panel = |label: &str, role| {
        ElementHandle::find_by_accessible_label(&ui, label)
            .find(|e| e.accessible_role() == Some(role))
            .unwrap_or_else(|| panic!("{label} panel is present"))
    };
    for (width, height) in SIZES {
        resize(&ui, width, height);
        for rail in [false, true] {
            ui.set_rail_open(rail);
            let visible_button = |labels: [&str; 2]| -> String {
                labels
                    .into_iter()
                    .find(|label| {
                        ElementHandle::find_by_accessible_label(&ui, label)
                            .find(|element| {
                                element.accessible_role() == Some(AccessibleRole::Button)
                            })
                            .is_some()
                    })
                    .expect("one state of each top-bar panel toggle is visible")
                    .to_owned()
            };
            ui.set_frame_left_open(false);
            ui.set_frame_inspector_open(true);
            advance(1000);
            let controls = [
                "Replace video".to_owned(),
                visible_button(["Hide queue", "Show queue"]),
                visible_button(["Hide inspector", "Show inspector"]),
                "Capture 2".to_owned(),
            ]
            .map(|label| {
                let element = ElementHandle::find_by_accessible_label(&ui, &label)
                    .find(|element| element.accessible_role() == Some(AccessibleRole::Button))
                    .unwrap_or_else(|| panic!("top bar action {label} is available"));
                let position = element.absolute_position();
                let size = element.size();
                assert!(
                    position.y >= 8.0 && position.y + size.height <= height - 8.0,
                    "{label} at y={} height={} must stay inside the tool",
                    position.y,
                    size.height
                );
                assert!(position.x >= 0.0 && position.x + size.width <= width);
                (position.x, size.width)
            });
            assert_eq!(controls.len(), 4);
            assert_eq!(
                ElementHandle::find_by_element_id(&ui, "AppWindow::tool-header").count(),
                0
            );
            for left in [false, true] {
                ui.set_frame_left_open(left);
                for inspector in [false, true] {
                    ui.set_frame_inspector_open(inspector);
                    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(
                        1000,
                    ));
                    slint::platform::update_timers_and_animations();
                    // The inspector and the queue scroll below their headers (80 px down), like Settings' pane:
                    // controls that start below that are only checked sideways.
                    let stray = outside_above(&ui, width, height, 80.0);
                    assert!(
                        stray.is_empty(),
                        "Frame Capture at {width}x{height}, rail={rail}, queue={left}, \
                         inspector={inspector}: {stray:?}"
                    );
                    // The sheet starts after the rail and its inset; the inspector ends at the window's inset.
                    let sheet_x = if rail { 224.0 } else { 62.0 };
                    let sheet_width = width - sheet_x - 8.0;
                    // The side panels give way when the canvas could not hold the transport.
                    let queue_shown = left && sheet_width >= 620.0;
                    let inspector_shown =
                        inspector && sheet_width >= 680.0 && (!left || sheet_width >= 900.0);
                    let canvas = panel("Frame Capture", AccessibleRole::Groupbox);
                    let canvas_x = canvas.absolute_position().x;
                    let timeline = ElementHandle::find_by_accessible_label(&ui, "Timeline")
                        .find(|element| element.accessible_role() == Some(AccessibleRole::Slider))
                        .expect("the active video timeline is present");
                    assert!(
                        timeline.size().height >= 56.0,
                        "the timeline has enough pointer height at {width}x{height}"
                    );
                    assert!(
                        (canvas_x - sheet_x - if queue_shown { 220.0 } else { 0.0 }).abs() < 1.0,
                        "canvas starts after the queue at {width}x{height}, rail={rail}, queue={left}: actual {canvas_x}, expected {}",
                        sheet_x + if queue_shown { 220.0 } else { 0.0 }
                    );
                    let canvas_right = canvas_x + canvas.size().width;
                    if inspector_shown {
                        let output = panel("Frame Capture inspector", AccessibleRole::Groupbox);
                        assert!(
                            (output.absolute_position().x - canvas_right).abs() < 1.0,
                            "the inspector follows the canvas at {width}x{height}, rail={rail}"
                        );
                        assert!(
                            (output.absolute_position().x + output.size().width - (width - 8.0))
                                .abs()
                                < 1.0,
                            "the inspector is anchored right at {width}x{height}, rail={rail}"
                        );
                        assert!(
                            output.size().height < height - 44.0,
                            "the compact Capture inspector returns unused lower space to the canvas at {width}x{height}"
                        );
                    } else {
                        assert!(
                            (canvas_right - (width - 8.0)).abs() < 1.0,
                            "the canvas takes the inspector's place at {width}x{height}"
                        );
                    }
                    if queue_shown {
                        let queue = panel("Queue", AccessibleRole::Groupbox);
                        assert!(
                            (queue.absolute_position().x - sheet_x).abs() < 1.0,
                            "the queue is anchored left at {width}x{height}, rail={rail}"
                        );
                        assert!((queue.size().width - 220.0).abs() < 1.0);
                    }
                    // The crop frame stays inside the canvas while it is visible.
                    let crop = panel("Crop", AccessibleRole::Slider);
                    let (c, f) = (crop.absolute_position(), crop.size());
                    assert!(
                        c.x >= canvas_x - 0.5
                            && c.y >= canvas.absolute_position().y - 0.5
                            && c.x + f.width <= canvas_right + 0.5
                            && c.y + f.height
                                <= canvas.absolute_position().y + canvas.size().height + 0.5,
                        "the crop frame leaves the canvas at {width}x{height}, rail={rail}, queue={left}"
                    );
                }
            }
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
    // Home hides the rail; Settings and tools retain their active navigation rows.
    let places = [(3, "Settings"), (4, "Converter"), (5, "Frame Capture")];
    for (page, _) in places {
        ui.set_page(page);
        advance(1000);
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
    ui.set_page(3);
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
fn home_uses_the_central_dock_and_hides_the_sidebar() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    let activated = Rc::new(std::cell::RefCell::new(String::new()));
    let result = activated.clone();
    ui.on_tool_activated(move |id| *result.borrow_mut() = id.to_string());
    for (w, h) in SIZES {
        resize(&ui, w, h);
        for rail in [false, true] {
            ui.set_rail_open(rail);
            advance(1000);
            for spec in TOOLS.iter().filter(|tool| tool.id != "library") {
                let entries = ElementHandle::find_by_accessible_label(&ui, spec.name)
                    .filter(|e| e.accessible_role() == Some(AccessibleRole::Button))
                    .collect::<Vec<_>>();
                assert_eq!(
                    entries.len(),
                    1,
                    "{} is present only in the central dock",
                    spec.name
                );
                assert!(entries[0].absolute_position().x > 8.0);
                assert!(entries[0].absolute_position().y > 44.0);
            }
            let grade = ElementHandle::find_by_accessible_label(&ui, "Grade")
                .next()
                .unwrap();
            let p = grade.absolute_position();
            let s = grade.size();
            let position = slint::LogicalPosition::new(p.x + s.width / 2.0, p.y + s.height / 2.0);
            let button = slint::platform::PointerEventButton::Left;
            ui.window()
                .dispatch_event(WindowEvent::PointerPressed { position, button });
            ui.window()
                .dispatch_event(WindowEvent::PointerReleased { position, button });
            assert_eq!(&*activated.borrow(), "grade");
        }
    }
}

#[test]
fn fusion_uses_one_silhouette_only_during_departure_and_arrival() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    fill_home(&ui);
    ui.set_page(4);
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
            ("Converter", "Downloader")
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
        point(if horizontal { "You" } else { "Grade" });
        advance(1);
        assert!(
            joined(),
            "retargeting a still-connected shape must not expose two inner borders"
        );
        settle();
        assert!(!joined(), "neck breaks; original resting borders return");
        point(selected);
        advance(1);
        // A distant row now crosses several sidebar entries. Fusion starts near the selection, not necessarily
        // on the first frame of that journey; sample the complete arrival rather than a single early instant.
        let mut joined_on_arrival = false;
        for _ in 0..32 {
            advance(16);
            joined_on_arrival |= joined();
        }
        assert!(
            joined_on_arrival,
            "arrival must join without an inner border, horizontal={horizontal}"
        );
        settle();
        ui.window().dispatch_event(WindowEvent::PointerExited);
        settle();
        assert!(!joined());
    }
    let motion = ui.global::<halation_app::ui::Motion>();
    motion.set_glide(0);
    motion.set_trail(0);
    motion.set_fade(0);
    point_at(&ui, "Frame Capture");
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
    ui.set_page(3);
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
    let (_, second) = point_at(&ui, "Frame Capture");
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
    ui.set_page(3);
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
    ui.set_page(3);
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
    ui.set_page(4);
    resize(&ui, 1280.0, 800.0);
    let row = |label: &str| {
        let e = ElementHandle::find_by_accessible_label(&ui, label)
            .find(|e| e.absolute_position().x < 40.0 && e.size().width > 0.0)
            .unwrap();
        e.absolute_position().y + e.size().height / 2.0
    };
    let (home, tool) = (row("Converter"), row("Frame Capture"));
    let pill = || pill_y(&ui, "PillList::selection");
    assert!(
        (pill() - home).abs() < 1.0,
        "on Home from the start: {} vs {home}",
        pill()
    );
    ui.set_page(5);
    // The row learns it is active on the next frame; the pill sets off from there
    advance(1);
    advance(32);
    assert!(
        pill() > home + 1.0 && pill() < tool - 1.0,
        "glides to the active tool"
    );
    advance(1000);
    assert!((pill() - tool).abs() < 1.0, "lands on the active tool");

    // Reduced motion: the end state on the next frame, for both pills
    let tokens = halation_app::motion::tokens(true);
    let motion = ui.global::<halation_app::ui::Motion>();
    let ms = |d: std::time::Duration| d.as_millis() as i64;
    motion.set_glide(ms(tokens.glide));
    motion.set_trail(ms(tokens.trail));
    motion.set_hover_in(ms(tokens.hover_in));
    motion.set_hover_out(ms(tokens.hover_out));
    ui.set_page(4);
    advance(1);
    advance(1);
    assert!((pill() - home).abs() < 1.0, "selection at once");
    point_at(&ui, "Downloader");
    advance(1);
    let (_, to) = point_at(&ui, "Frame Capture");
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
