use super::update_recent_model;
use crate::library::{LibraryEntry, LibraryLoad, LibraryModel, LibraryStore};
use crate::ui::RecentItem;
use slint::{Model, VecModel};
use std::cell::RefCell;
use std::rc::Rc;

fn entry(id: &str, name: &str) -> LibraryEntry {
    LibraryEntry {
        id: id.to_owned(),
        path: format!("C:/fixture/{id}.png"),
        display_name: name.to_owned(),
        missing: false,
        added_at: 1,
    }
}

#[test]
fn recent_model_is_not_reset_when_recent_entries_are_unchanged() {
    let library_model = LibraryModel::new(2000);
    let mut library = LibraryStore::new("unused.json", library_model.clone());
    library.apply_load(LibraryLoad::Loaded(vec![entry("a", "Alpha.png")]));

    let cache = RefCell::new(Vec::new());
    let model = Rc::new(VecModel::<RecentItem>::default());
    assert!(update_recent_model(&library_model, &cache, &model));
    assert_eq!(model.row_count(), 1);
    assert!(!update_recent_model(&library_model, &cache, &model));
    assert_eq!(model.row_count(), 1);

    library.apply_load(LibraryLoad::Loaded(vec![entry("a", "Renamed.png")]));
    assert!(update_recent_model(&library_model, &cache, &model));
    assert_eq!(model.row_count(), 1);
    assert_eq!(model.row_data(0).unwrap().name.as_str(), "Renamed.png");
}

#[test]
fn dragging_the_accent_strip_recolours_and_saves_the_hue() {
    use crate::profile::{LaunchOptions, Profile};
    use crate::ui::{AppWindow, Theme};
    use slint::ComponentHandle;
    use slint::platform::{PointerEventButton, WindowEvent};

    i_slint_backend_testing::init_no_event_loop();
    let root = std::env::temp_dir().join(format!("halation-accent-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let profile = Profile::at(root.clone());
    profile.ensure().unwrap();
    let ui = AppWindow::new().unwrap();
    ui.show().unwrap();
    // Short enough that the page scrolls
    ui.window().set_size(slint::LogicalSize::new(960.0, 420.0));
    ui.window().dispatch_event(WindowEvent::Resized {
        size: slint::LogicalSize::new(960.0, 420.0),
    });
    let controller =
        super::Controller::new(ui.as_weak(), profile, LaunchOptions::default()).unwrap();
    controller.install(false);
    ui.invoke_navigate(3);
    ui.set_settings_category(1);
    i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(1000));
    slint::platform::update_timers_and_animations();
    let before = ui.global::<Theme>().get_accent();

    let strip = i_slint_backend_testing::ElementHandle::find_by_accessible_label(&ui, "Accent")
        .find(|e| e.accessible_role() == Some(i_slint_backend_testing::AccessibleRole::Slider))
        .expect("the accent strip is on Interface");
    let (pos, size) = (strip.absolute_position(), strip.size());
    let at =
        |f: f32| slint::LogicalPosition::new(pos.x + size.width * f, pos.y + size.height / 2.0);
    let button = PointerEventButton::Left;
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.2) });
    let wait = |ms| {
        i_slint_backend_testing::mock_elapsed_time(std::time::Duration::from_millis(ms));
        slint::platform::update_timers_and_animations();
    };
    ui.window().dispatch_event(WindowEvent::PointerPressed {
        position: at(0.2),
        button,
    });
    wait(16);
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.3) });
    wait(16);
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.4) });
    wait(150);
    assert_ne!(
        ui.global::<Theme>().get_accent(),
        before,
        "dragging previews the hue"
    );
    ui.window()
        .dispatch_event(WindowEvent::PointerMoved { position: at(0.5) });
    wait(16);
    ui.window().dispatch_event(WindowEvent::PointerReleased {
        position: at(0.5),
        button,
    });
    slint::platform::update_timers_and_animations();
    let hue = controller.services.borrow().settings.current().accent_hue;
    assert!(
        (160..=200).contains(&hue),
        "the middle of the strip saves about 180°, got {hue}"
    );
    assert_ne!(ui.global::<Theme>().get_accent(), before);
    let _ = std::fs::remove_dir_all(&root);
}
