//! The visible strings of the tools, read from `locales/en.json` at start-up. The beta is English only; there is no
//! second catalogue yet. Keeping the Frame Capture text here means the page and the controller hold no literals.

use crate::ui::{FrameStrings, ShellStrings};
use std::collections::HashMap;

pub(crate) struct Strings {
    map: HashMap<String, String>,
}

impl Strings {
    pub(crate) fn frame_capture() -> Self {
        Self::section("frame-capture")
    }

    pub(crate) fn shell() -> Self {
        Self::section("shell")
    }

    pub(crate) fn shell_strings(&self) -> ShellStrings {
        ShellStrings {
            actions: self.get("actions").into(),
            activity: self.get("activity").into(),
            shortcuts: self.get("shortcuts").into(),
            folder: self.get("folder").into(),
            session: self.get("session").into(),
            dismiss: self.get("dismiss").into(),
        }
    }

    fn section(name: &str) -> Self {
        let root: serde_json::Value = serde_json::from_str(include_str!("../locales/en.json"))
            .expect("en.json is valid JSON");
        let map = root[name]
            .as_object()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
                    .collect()
            })
            .unwrap_or_default();
        Self { map }
    }

    pub(crate) fn get<'a>(&'a self, key: &'a str) -> &'a str {
        self.map.get(key).map(String::as_str).unwrap_or(key)
    }

    /// Whether the catalogue actually holds `key`; the tests use this instead of trusting the key echoed back.
    #[cfg(test)]
    pub(crate) fn contains(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    /// The catalogue keys, so the tests can prove the list they check is the whole catalogue.
    #[cfg(test)]
    pub(crate) fn keys(&self) -> Vec<&str> {
        self.map.keys().map(String::as_str).collect()
    }

    /// Replaces `{name}` placeholders; values already formatted by Rust (times, sizes) stay as they are.
    pub(crate) fn fill(&self, key: &str, values: &[(&str, String)]) -> String {
        let mut text = self.get(key).to_owned();
        for (name, value) in values {
            text = text.replace(&format!("{{{name}}}"), value);
        }
        text
    }

    pub(crate) fn frame_strings(&self) -> FrameStrings {
        FrameStrings {
            title: self.get("title").into(),
            summary: self.get("summary").into(),
            empty_title: self.get("empty_title").into(),
            empty_hint: self.get("empty_hint").into(),
            browse: self.get("browse").into(),
            open: self.get("open").into(),
            browse_short: self.get("browse_short").into(),
            open_short: self.get("open_short").into(),
            replace_video: self.get("replace_video").into(),
            replace_short: self.get("replace_short").into(),
            inspector_short: self.get("inspector_short").into(),
            needs_ffmpeg: self.get("needs_ffmpeg").into(),
            needs_ffmpeg_hint: self.get("needs_ffmpeg_hint").into(),
            install: self.get("install").into(),
            install_note: self.get("install_note").into(),
            queue: self.get("queue").into(),
            queue_empty: self.get("queue_empty").into(),
            queue_full: self.get("queue_full").into(),
            queue_count: self.get("queue_count").into(),
            queue_count_label: self.get("queue_count_label").into(),
            inspector_capture: self.get("inspector_capture").into(),
            inspector: self.get("inspector").into(),
            capture_action: self.get("capture_action").into(),
            inspector_tabs: self.get("inspector_tabs").into(),
            choose_video: self.get("choose_video").into(),
            show_queue: self.get("show_queue").into(),
            hide_queue: self.get("hide_queue").into(),
            show_inspector: self.get("show_inspector").into(),
            hide_inspector: self.get("hide_inspector").into(),
            add_frame: self.get("add_frame").into(),
            sharpest_button: self.get("sharpest_button").into(),
            clear: self.get("clear").into(),
            all: self.get("all").into(),
            none: self.get("none").into(),
            capture: self.get("capture").into(),
            capture_none: self.get("capture_none").into(),
            cancel: self.get("cancel").into(),
            layout: self.get("layout").into(),
            destination: self.get("destination").into(),
            results: self.get("results").into(),
            output: self.get("output").into(),
            results_empty: self.get("results_empty").into(),
            reveal: self.get("reveal").into(),
            crop_hint: self.get("crop_hint").into(),
            back_send_note: self.get("back_send_note").into(),
            results_note: self.get("results_note").into(),
            sound_note: self.get("sound_note").into(),
            keys_hint: self.get("keys_hint").into(),
            frame_of: self.get("frame_of").into(),
            frame_short: self.get("frame_short").into(),
            time_of: self.get("time_of").into(),
            sharpest: self.get("sharpest").into(),
            saved: self.get("saved").into(),
            capture_progress: self.get("capture_progress").into(),
            selected_count: self.get("selected_count").into(),
            reading: self.get("reading").into(),
            analysing: self.get("analysing").into(),
            finding: self.get("finding").into(),
            captured_one: self.get("captured_one").into(),
            capture_failed: self.get("capture_failed").into(),
            open_failed: self.get("open_failed").into(),
            playback_failed: self.get("playback_failed").into(),
            timeline_missing: self.get("timeline_missing").into(),
            install_done: self.get("install_done").into(),
            install_failed: self.get("install_failed").into(),
            cancelled: self.get("cancelled").into(),
            back_one: self.get("back_one").into(),
            forward_one: self.get("forward_one").into(),
            video_preview: self.get("video_preview").into(),
            timeline: self.get("timeline").into(),
            crop: self.get("crop").into(),
            select: self.get("select").into(),
            deselect: self.get("deselect").into(),
            remove: self.get("remove").into(),
            details: self.get("details").into(),
            layout_16_9: self.get("layout_16_9").into(),
            layout_9_16: self.get("layout_9_16").into(),
            layout_1_1: self.get("layout_1_1").into(),
            layout_4_5: self.get("layout_4_5").into(),
            layout_original_label: self.get("layout_original_label").into(),
            layout_original: self.get("layout_original").into(),
            layout_16_9_detail: self.get("layout_16_9_detail").into(),
            layout_9_16_detail: self.get("layout_9_16_detail").into(),
            layout_1_1_detail: self.get("layout_1_1_detail").into(),
            layout_4_5_detail: self.get("layout_4_5_detail").into(),
            destination_library: self.get("destination_library").into(),
            destination_image: self.get("destination_image").into(),
            library_detail: self.get("library_detail").into(),
            image_detail: self.get("image_detail").into(),
            result_detail: self.get("result_detail").into(),
            results_note_title: self.get("results_note_title").into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every key the page, the controller and the job labels ask for. Kept in catalogue order so a new string is
    /// added here in the same edit; the equality check below fails if `en.json` grows a key this list does not name.
    const FRAME_KEYS: &[&str] = &[
        "title",
        "summary",
        "empty_title",
        "empty_hint",
        "browse",
        "open",
        "browse_short",
        "open_short",
        "replace_video",
        "replace_short",
        "inspector_short",
        "needs_ffmpeg",
        "needs_ffmpeg_hint",
        "install",
        "install_note",
        "queue",
        "queue_empty",
        "queue_full",
        "queue_count",
        "queue_count_label",
        "inspector_capture",
        "inspector",
        "capture_action",
        "inspector_tabs",
        "choose_video",
        "show_queue",
        "hide_queue",
        "show_inspector",
        "hide_inspector",
        "add_frame",
        "sharpest_button",
        "clear",
        "all",
        "none",
        "select",
        "deselect",
        "remove",
        "details",
        "capture",
        "capture_none",
        "cancel",
        "layout",
        "destination",
        "results",
        "output",
        "results_empty",
        "reveal",
        "crop_hint",
        "back_send_note",
        "results_note",
        "sound_note",
        "keys_hint",
        "frame_of",
        "frame_short",
        "time_of",
        "sharpest",
        "saved",
        "capture_progress",
        "selected_count",
        "reading",
        "analysing",
        "finding",
        "captured_one",
        "capture_failed",
        "open_failed",
        "synthetic_decode_error",
        "synthetic_result_name",
        "not_authorized",
        "missing_video",
        "frame_failed",
        "playback_failed",
        "timeline_missing",
        "install_done",
        "install_failed",
        "install_running",
        "drop_one",
        "reveal_failed",
        "sharp_failed",
        "location_failed",
        "cancelled",
        "session_failed",
        "capture_partial",
        "pick_video_title",
        "video_filter",
        "save_png_title",
        "png_filter",
        "job_analyse",
        "job_capture",
        "job_install",
        "job_preview",
        "job_thumb",
        "job_sharp",
        "back_one",
        "forward_one",
        "video_preview",
        "timeline",
        "crop",
        "layout_16_9",
        "layout_9_16",
        "layout_1_1",
        "layout_4_5",
        "layout_original_label",
        "layout_original",
        "layout_16_9_detail",
        "layout_9_16_detail",
        "layout_1_1_detail",
        "layout_4_5_detail",
        "destination_library",
        "destination_image",
        "library_detail",
        "image_detail",
        "result_detail",
        "results_note_title",
    ];

    #[test]
    fn every_frame_capture_string_is_present_and_filled() {
        let strings = Strings::frame_capture();
        let mut catalogue = strings.keys();
        catalogue.sort_unstable();
        let mut expected = FRAME_KEYS.to_vec();
        expected.sort_unstable();
        assert_eq!(
            catalogue, expected,
            "en.json and FRAME_KEYS disagree; add or remove the key in both"
        );
        for key in FRAME_KEYS {
            assert!(strings.contains(key), "{key} is missing from en.json");
            assert!(!strings.get(key).is_empty(), "{key} is empty in en.json");
        }
        assert_eq!(
            strings.fill("queue_count_label", &[("n", "3".into())]),
            "3 / 8"
        );
        assert_eq!(
            strings.fill("capture_action", &[("n", "3".into())]),
            "Capture 3"
        );
        assert_eq!(
            strings.fill("frame_of", &[("n", "42".into()), ("total", "300".into())]),
            "Frame 42 of 300"
        );
        assert_eq!(
            strings.fill(
                "capture_failed",
                &[("n", "7".into()), ("error", "no frame".into())]
            ),
            "Could not capture frame 7: no frame"
        );
        assert_eq!(strings.frame_strings().title.as_str(), "Frame Capture");
    }
}
