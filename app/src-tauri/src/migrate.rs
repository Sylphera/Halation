//! One-time import of data from earlier versions.

use crate::{paths::*, state::*, assets::*};
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::Path,
};
use tauri::{
    AppHandle, Manager,
};

/* ---------- one-time migration from earlier versions ---------- */

/// Folder layout of the previous version inside Documents (Spanish folder names).
pub(crate) const PREVIOUS: &str = "Sylphera Studio";
pub(crate) const PREVIOUS_VIDEOS: [&str; 2] = ["Exportados", "Videos"];
pub(crate) const PREVIOUS_COVERS: [&str; 2] = ["Exportados", "Portadas"];
pub(crate) const PREVIOUS_FONTS: [&str; 2] = ["Recursos", "Fuentes"];
pub(crate) const PREVIOUS_LOGOS: [&str; 2] = ["Recursos", "Logos"];
pub(crate) const PREVIOUS_STATE: [&str; 2] = ["Ajustes", "app.json"];
pub(crate) const FIRST_LAYOUT: &str = "Sylphera";
pub(crate) const STATE_KEYS: [&str; 6] = ["visualizer", "grade", "settings", "fontFavorites", "fontNames", "window"];

pub(crate) fn strip_layer_ids(layers: Value) -> Value {
    match layers {
        Value::Array(list) => Value::Array(
            list.into_iter()
                .map(|l| match l {
                    Value::Object(mut o) => {
                        o.remove("id");
                        o.remove("open");
                        Value::Object(o)
                    }
                    other => other,
                })
                .collect(),
        ),
        other => other,
    }
}

pub(crate) fn wrap_preset(kind: &str, v: Value) -> Value {
    if kind == "grade" {
        json!({ "app": "halation-grade", "version": 1, "layers": strip_layer_ids(v) })
    } else {
        json!({ "app": "halation-visualizer", "version": 1, "settings": v })
    }
}

/// Content of an earlier preset file: settings object (visualizer) or layer list (grade).
pub(crate) fn preset_payload(kind: &str, v: Value) -> Option<Value> {
    match (kind, v) {
        ("grade", Value::Array(l)) => Some(Value::Array(l)),
        ("grade", Value::Object(mut o)) => o.remove("layers").filter(Value::is_array),
        (_, Value::Object(mut o)) => match o.remove("settings").or_else(|| o.remove("current")) {
            Some(Value::Object(s)) => Some(Value::Object(s)),
            _ => Some(Value::Object(o)),
        },
        _ => None,
    }
}

pub(crate) fn write_preset_if_new(app: &AppHandle, kind: &str, name: &str, payload: Value) -> Result<bool, String> {
    let path = preset_dir(app, kind)?.join(format!("{}.json", file_stem(name)));
    if path.exists() {
        return Ok(false);
    }
    let s = serde_json::to_string_pretty(&wrap_preset(kind, payload)).map_err(|e| e.to_string())?;
    write_atomic(&path, s.as_bytes())?;
    Ok(true)
}

pub(crate) fn copy_files(from: &Path, to: &Path, filter: impl Fn(&Path) -> bool) -> usize {
    let Ok(rd) = fs::read_dir(from) else { return 0 };
    let _ = fs::create_dir_all(to);
    let mut n = 0;
    for entry in rd.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name() else { continue };
        let target = to.join(name);
        if path.is_file() && filter(&path) && !target.exists() && fs::copy(&path, &target).is_ok() {
            n += 1;
        }
    }
    n
}

#[derive(Default)]
pub(crate) struct Imported {
    presets: usize,
    looks: usize,
    resources: usize,
    exports: usize,
    sources: Vec<String>,
}

pub(crate) fn import_previous(app: &AppHandle, docs: &Path, state: &mut Map<String, Value>, out: &mut Imported) -> Result<(), String> {
    let old = docs.join(PREVIOUS);
    let sub = |p: [&str; 2]| old.join(p[0]).join(p[1]);
    if !old.is_dir() {
        return Ok(());
    }
    out.sources.push(old.to_string_lossy().into_owned());
    for (kind, kind_dir) in [("visualizer", "Visualizer"), ("grade", "Grade")] {
        let Ok(rd) = fs::read_dir(old.join("Presets").join(kind_dir)) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            if ext_of(&path.to_string_lossy()) != "json" {
                continue;
            }
            let Some(payload) = read_json(&path).and_then(|v| preset_payload(kind, v)) else { continue };
            if write_preset_if_new(app, kind, stem, payload)? {
                if kind == "grade" { out.looks += 1 } else { out.presets += 1 }
            }
        }
    }
    let [new_fonts, new_logos] = asset_dirs(app)?;
    out.resources += copy_files(&sub(PREVIOUS_FONTS), &new_fonts, |_| true);
    out.resources += copy_files(&sub(PREVIOUS_LOGOS), &new_logos, |_| true);
    if let Some(Value::Object(prev)) = read_json(&sub(PREVIOUS_STATE)) {
        for k in STATE_KEYS {
            if let (Some(v), false) = (prev.get(k), state.contains_key(k)) {
                state.insert(k.into(), v.clone());
            }
        }
    }
    // Videos and covers can be large: they are copied in the background.
    let jobs = [
        (sub(PREVIOUS_VIDEOS), dir(app, &["Exports", "Videos"])?),
        (sub(PREVIOUS_COVERS), dir(app, &["Exports", "Covers"])?),
    ];
    out.exports = jobs.iter().filter_map(|(src, _)| fs::read_dir(src).ok()).map(|rd| rd.count()).sum();
    std::thread::spawn(move || {
        for (src, dst) in jobs {
            copy_files(&src, &dst, |_| true);
        }
    });
    Ok(())
}

pub(crate) fn import_first(app: &AppHandle, docs: &Path, state: &mut Map<String, Value>, out: &mut Imported) -> Result<(), String> {
    let old = docs.join(FIRST_LAYOUT);
    if !old.is_dir() {
        return Ok(());
    }
    out.sources.push(old.to_string_lossy().into_owned());
    for (kind, sub, file, field) in [("visualizer", "Visualizer", "prefs.json", "presets"), ("grade", "Grade", "grade.json", "looks")] {
        let Some(Value::Object(mut v)) = read_json(&old.join(sub).join(file)) else { continue };
        if let Some(Value::Object(coll)) = v.remove(field) {
            for (name, payload) in coll {
                if write_preset_if_new(app, kind, &name, payload)? {
                    if kind == "grade" { out.looks += 1 } else { out.presets += 1 }
                }
            }
        }
        if let Some(Value::Object(cur)) = v.get_mut("current") {
            if let Some(layers) = cur.remove("layers") {
                cur.insert("layers".into(), strip_layer_ids(layers));
            }
        }
        state.entry(kind).or_insert(Value::Object(v));
    }
    let [fonts, logos] = asset_dirs(app)?;
    for sub in ["Visualizer", "Grade"] {
        let src = old.join(sub).join("recursos");
        out.resources += copy_files(&src, &fonts, |p| FONT_EXT.contains(&ext_of(&p.to_string_lossy()).as_str()));
        out.resources += copy_files(&src, &logos, |p| !FONT_EXT.contains(&ext_of(&p.to_string_lossy()).as_str()));
    }
    Ok(())
}

pub(crate) fn migrate(app: &AppHandle) -> Result<(), String> {
    let lock = app.state::<StateLock>();
    let _g = hold(&lock.0);
    for parts in LAYOUT {
        dir(app, parts)?;
    }
    let mut state = read_state(app)?;
    if state.contains_key("migrated") {
        return Ok(());
    }
    let docs = docs_dir(app)?;
    let mut out = Imported::default();
    import_previous(app, &docs, &mut state, &mut out)?;
    import_first(app, &docs, &mut state, &mut out)?;
    state.remove("exports");
    state.insert(
        "migrated".into(),
        json!({ "at": now_ms(), "from": out.sources, "presets": out.presets, "looks": out.looks, "resources": out.resources, "exports": out.exports }),
    );
    write_state(app, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads() {
        let v = preset_payload("visualizer", json!({ "app": "x", "settings": { "a": 1 } })).unwrap();
        assert_eq!(v, json!({ "a": 1 }));
        let g = preset_payload("grade", json!({ "layers": [{ "id": "z", "type": "look" }] })).unwrap();
        assert_eq!(strip_layer_ids(g), json!([{ "type": "look" }]));
    }
}
