//! Settings\app.json: the state every tab saves, behind one lock.

use crate::paths::*;
use serde_json::{Map, Value};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
};
use tauri::{
    AppHandle, Manager, State,
};

/// Serializes reads and writes of Settings\app.json across tabs.
pub(crate) struct StateLock(pub(crate) Mutex<()>);
/* ---------- Settings\app.json ---------- */

pub(crate) fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dir(app, &["Settings"])?.join("app.json"))
}

pub(crate) fn read_state(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(Map::new());
    }
    match read_json(&path) {
        Some(Value::Object(m)) => Ok(m),
        _ => {
            // Damaged file: keep a copy aside and start again.
            let _ = fs::copy(&path, path.with_file_name(format!("app.damaged-{}.json", now_ms())));
            Ok(Map::new())
        }
    }
}

pub(crate) fn write_state(app: &AppHandle, m: &Map<String, Value>) -> Result<(), String> {
    let s = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    write_atomic(&state_path(app)?, s.as_bytes())
}

pub(crate) fn setting(app: &AppHandle, key: &str) -> Option<String> {
    let lock = app.state::<StateLock>();
    let _g = hold(&lock.0);
    read_state(app)
        .ok()
        .and_then(|m| m.get("settings").and_then(|s| s.get(key)).and_then(|v| v.as_str()).map(str::to_string))
}

pub(crate) fn spanish(app: &AppHandle) -> bool {
    setting(app, "language").as_deref() == Some("es")
}

#[tauri::command]
pub(crate) fn state_get(app: AppHandle, lock: State<'_, StateLock>, key: String) -> Result<Option<Value>, String> {
    let _g = hold(&lock.0);
    let mut saved = read_state(&app)?.remove(&key);
    if crate::sessions::temporary(&key) {
        if let Some(work) = hold(&app.state::<crate::sessions::Sessions>().tools).get(&key) {
            let mut merged = saved.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            if let Some(o) = work.as_object() { merged.extend(o.clone()); }
            saved = Some(Value::Object(merged));
        }
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn state_set(app: AppHandle, lock: State<'_, StateLock>, key: String, value: Value) -> Result<(), String> {
    let _g = hold(&lock.0);
    let mut m = read_state(&app)?;
    if crate::sessions::temporary(&key) {
        hold(&app.state::<crate::sessions::Sessions>().tools).insert(key.clone(), value.clone());
        let permanent = crate::sessions::persistent_part(&key, &value);
        if permanent.as_object().is_some_and(|o| !o.is_empty()) { m.insert(key, permanent); }
        else { m.remove(&key); }
    } else { m.insert(key, value); }
    write_state(&app, &m)
}

/* ---------- sessions ---------- */


/// Whether a recovery candidate exists. Recovery always requires the user's decision.
pub(crate) struct Recovered(pub(crate) bool);

/// Every launch starts with clean tool state. Explicit saved defaults and collections stay.
pub(crate) fn start_session(m: &mut Map<String, Value>) -> bool {
    // Title Intro was removed; discard only its legacy temporary preferences.
    m.remove("intro");
    // Migrate the saved references before discarding the old mixed tool payload.
    if !m.contains_key("profiles") {
        if let Some(refs) = m.get("covertest").and_then(|v| v.get("refs")).cloned() {
            m.insert("profiles".into(), serde_json::json!({"references": refs}));
        }
    }
    for key in m.keys().filter(|k| crate::sessions::temporary(k)).cloned().collect::<Vec<_>>() {
        let permanent = crate::sessions::persistent_part(&key, &m[&key]);
        if permanent.as_object().is_some_and(|o| !o.is_empty()) { m.insert(key, permanent); }
        else { m.remove(&key); }
    }
    m.insert("session".into(), serde_json::json!({ "open": true }));
    false
}

pub(crate) fn begin(app: &AppHandle) -> bool {
    let lock = app.state::<StateLock>();
    let _g = hold(&lock.0);
    let Ok(mut m) = read_state(app) else { return false };
    if m.get("session").and_then(|v| v.get("open")).and_then(Value::as_bool) == Some(false) {
        let _ = crate::sessions::discard(app);
    }
    start_session(&mut m);
    let crashed = dir(app, &["Sessions"]).ok().and_then(|d| read_json(&d.join(".recovery.json")))
        .is_some_and(|v| v.get("app").and_then(Value::as_str) == Some("halation-session") && v.get("version").and_then(Value::as_u64) == Some(1) && v.get("tools").is_some_and(Value::is_object));
    let _ = write_state(app, &m);
    crashed
}

/// A clean close: the next start opens empty.
pub(crate) fn end_session(app: &AppHandle) {
    let _ = crate::sessions::discard(app);
    let lock = app.state::<StateLock>();
    let _g = hold(&lock.0);
    if let Ok(mut m) = read_state(app) {
        m.insert("session".into(), serde_json::json!({ "open": false }));
        let _ = write_state(app, &m);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state(open: Option<bool>) -> Map<String, Value> {
        let mut v = json!({
            "grade": { "current": { "layers": [1] }, "previewPct": 50 },
            "visualizer": { "current": { "title": "x" }, "updatedAt": 1 },
            "intro": { "project": { "a": 1 }, "sel": "e1", "quality": "high" },
            "settings": { "language": "es" }
        });
        if let Some(o) = open {
            v["session"] = json!({ "open": o });
        }
        v.as_object().unwrap().clone()
    }

    #[test]
    fn a_clean_close_starts_empty_and_keeps_permanent_data() {
        for open in [None, Some(false)] {
            let mut m = state(open);
            assert!(!start_session(&mut m));
            assert!(!m.contains_key("grade"));
            assert!(m["visualizer"].get("current").is_none() && m["visualizer"]["updatedAt"] == 1);
            assert!(!m.contains_key("intro"));
            assert_eq!(m["settings"]["language"], "es");
            assert_eq!(m["session"]["open"], true);
        }
    }

    #[test]
    fn old_tool_preferences_do_not_automatically_restore_work() {
        let mut m = state(Some(true));
        assert!(!start_session(&mut m));
        assert!(!m.contains_key("grade") && !m.contains_key("intro"));
    }
}
