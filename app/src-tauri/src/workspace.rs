//! The shared workspace (docs/JOBS_SPEC.md §6): one folder outside Documents, %LOCALAPPDATA%\Halation\workspace, for
//! the jobs' work folders (leases, `temp\<job>`, deleted when the job ends and all of them at start), the common cache
//! by area (`cache\frames`, `masks`, `thumbs`, `probe`, `proxy`) under one budget with the least recently used out
//! first (entries an open tool uses are pinned and stay), the jobs' measurements (`stats.json`) and the registry of
//! downloaded models by hash. It also reads the machine for the scheduler: cores, RAM, the GPU and its video memory.

use crate::paths::*;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Response, AppHandle, Manager, State};

pub(crate) const AREAS: [(&str, &str); 5] = [("frames", "bin"), ("masks", "png"), ("thumbs", "webp"), ("probe", "json"), ("proxy", "bin")];
const DEFAULT_BUDGET_MB: u64 = 8192;
const LOW_DISK: u64 = 5 * 1024 * 1024 * 1024;

/// One cache entry: its size, when it was last used (ms), whether a tool that is open uses it
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Entry {
    pub size: u64,
    pub used: u64,
}

#[derive(Default)]
pub(crate) struct Cache {
    loaded: bool,
    entries: HashMap<(String, String), Entry>,
    pinned: HashSet<(String, String)>,
    saved_at: u64,
}

#[derive(Default)]
pub(crate) struct Workspace(pub(crate) Mutex<Cache>);

/* ---------- folders ---------- */

pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let d = local_dir(app)?.join("Halation").join("workspace");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}
pub(crate) fn temp_root(app: &AppHandle) -> Result<PathBuf, String> {
    let d = root(app)?.join("temp");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}
pub(crate) fn area_dir(app: &AppHandle, area: &str) -> Result<PathBuf, String> {
    if !AREAS.iter().any(|(a, _)| *a == area) {
        return Err(format!("unknown cache area {area}"));
    }
    let d = root(app)?.join("cache").join(area);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}
fn ext(area: &str) -> &'static str {
    AREAS.iter().find(|(a, _)| *a == area).map(|(_, e)| *e).unwrap_or("bin")
}
/// A key is letters, digits, "-" and "_" (at most 56): it can never leave its folder
pub(crate) fn valid_key(key: &str) -> bool {
    !key.is_empty() && safe_id(key) == key
}
/// The folder of a job id ("j_000123"), or of loose temporary files ("loose")
fn lease_name(job: &str) -> Result<String, String> {
    if valid_key(job) {
        Ok(job.to_string())
    } else {
        Err("invalid job id".into())
    }
}
/// A path inside the workspace (read_path, delete_paths and the tools accept it like the Halation folder)
pub(crate) fn inside(app: &AppHandle, p: &Path) -> bool {
    root(app).ok().and_then(|r| r.canonicalize().ok()).is_some_and(|r| p.starts_with(r))
}

/* ---------- leases ---------- */

/// The work folder of a job: workspace\temp\<job>, made once
#[tauri::command]
pub fn workspace_lease(app: AppHandle, job: String) -> Result<String, String> {
    let d = temp_root(&app)?.join(lease_name(&job)?);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.to_string_lossy().into_owned())
}

/// The job ended: its folder goes, with what is left in it
#[tauri::command]
pub fn workspace_release(app: AppHandle, job: String) -> Result<(), String> {
    let d = temp_root(&app)?.join(lease_name(&job)?);
    if d.exists() {
        fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// At start no job is alive: every work folder of the last run goes (also after a crash)
pub(crate) fn clear_temp(dir: &Path) -> u64 {
    let mut freed = 0;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let n = crate::storage::size_of(&p);
            let ok = if p.is_dir() { fs::remove_dir_all(&p).is_ok() } else { fs::remove_file(&p).is_ok() };
            if ok {
                freed += n;
            }
        }
    }
    freed
}

/* ---------- the cache ---------- */

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("index.json"))
}
/// The entries on disk, with their last use from index.json when it knows them (else the file's time)
fn load(app: &AppHandle, c: &mut Cache) {
    if c.loaded {
        return;
    }
    c.loaded = true;
    let known: Map<String, Value> = index_path(app).ok().and_then(|p| read_json(&p)).and_then(|v| v.get("entries").cloned()).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    for (area, e) in AREAS {
        let Ok(d) = area_dir(app, area) else { continue };
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for f in rd.flatten() {
            let Ok(m) = f.metadata() else { continue };
            let name = f.file_name().to_string_lossy().into_owned();
            let Some(key) = name.strip_suffix(&format!(".{e}")) else { continue };
            if !m.is_file() || !valid_key(key) {
                continue;
            }
            let used = known.get(&format!("{area}/{key}")).and_then(|v| v.get("used")).and_then(Value::as_u64).unwrap_or_else(|| modified_ms(&m));
            c.entries.insert((area.to_string(), key.to_string()), Entry { size: m.len(), used });
        }
    }
}
fn save(app: &AppHandle, c: &mut Cache, force: bool) {
    let now = now_ms();
    if !force && now.saturating_sub(c.saved_at) < 1000 {
        return;
    }
    c.saved_at = now;
    let mut m = Map::new();
    for ((a, k), e) in &c.entries {
        m.insert(format!("{a}/{k}"), json!({ "size": e.size, "used": e.used }));
    }
    if let Ok(p) = index_path(app) {
        let _ = write_atomic(&p, json!({ "version": 1, "entries": m }).to_string().as_bytes());
    }
}
/// The budget from Settings → Storage (settings.workspace.budgetMB), halved while the disk is low
pub(crate) fn budget(app: &AppHandle) -> u64 {
    let lock = app.state::<crate::state::StateLock>();
    let mb = {
        let _g = hold(&lock.0);
        crate::state::read_state(app).ok().and_then(|m| m.get("settings").and_then(|s| s.get("workspace")).and_then(|w| w.get("budgetMB")).and_then(Value::as_u64))
    }
    .unwrap_or(DEFAULT_BUDGET_MB)
    .clamp(256, 262144);
    let bytes = mb * 1024 * 1024;
    match root(app).ok().and_then(|r| crate::system::free_space(&r).ok()) {
        Some(free) if free < LOW_DISK => bytes / 2,
        _ => bytes,
    }
}
/// The entries to remove, least recently used first, so what is left fits `max`; pinned entries stay
pub(crate) fn evict(entries: &HashMap<(String, String), Entry>, pinned: &HashSet<(String, String)>, max: u64) -> Vec<(String, String)> {
    let mut total: u64 = entries.values().map(|e| e.size).sum();
    let mut list: Vec<_> = entries.iter().filter(|(k, _)| !pinned.contains(*k)).collect();
    list.sort_by_key(|(_, e)| e.used);
    let mut out = vec![];
    for (k, e) in list {
        if total <= max {
            break;
        }
        total -= e.size;
        out.push(k.clone());
    }
    out
}
fn file_of(app: &AppHandle, area: &str, key: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err("invalid cache key".into());
    }
    Ok(area_dir(app, area)?.join(format!("{key}.{}", ext(area))))
}
/// An entry's bytes (empty: not cached); a hit is a use
pub(crate) fn get(app: &AppHandle, ws: &Workspace, area: &str, key: &str) -> Result<Vec<u8>, String> {
    let p = file_of(app, area, key)?;
    let data = fs::read(&p).unwrap_or_default();
    let mut c = hold(&ws.0);
    load(app, &mut c);
    let k = (area.to_string(), key.to_string());
    if data.is_empty() {
        c.entries.remove(&k);
    } else {
        c.entries.insert(k, Entry { size: data.len() as u64, used: now_ms() });
        save(app, &mut c, false);
    }
    Ok(data)
}
/// Writes an entry, then removes the least recently used ones past the budget
pub(crate) fn put(app: &AppHandle, ws: &Workspace, area: &str, key: &str, bytes: &[u8]) -> Result<(), String> {
    let p = file_of(app, area, key)?;
    write_atomic(&p, bytes)?;
    let max = budget(app);
    let mut c = hold(&ws.0);
    load(app, &mut c);
    c.entries.insert((area.to_string(), key.to_string()), Entry { size: bytes.len() as u64, used: now_ms() });
    let gone = evict(&c.entries, &c.pinned, max);
    for k in &gone {
        if let Ok(f) = file_of(app, &k.0, &k.1) {
            let _ = fs::remove_file(f);
        }
        c.entries.remove(k);
    }
    save(app, &mut c, !gone.is_empty());
    Ok(())
}

#[tauri::command]
pub fn workspace_cache_get(app: AppHandle, ws: State<'_, Workspace>, area: String, key: String) -> Result<Response, String> {
    Ok(Response::new(get(&app, &ws, &area, &key)?))
}

#[tauri::command]
pub fn workspace_cache_put(app: AppHandle, ws: State<'_, Workspace>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    put(&app, &ws, &header(&request, "x-area"), &header(&request, "x-key"), raw_body(&request)?)
}

/// Entries an open tool uses (on) or no longer uses (off): pinned entries are never evicted
#[tauri::command]
pub fn workspace_pin(ws: State<'_, Workspace>, area: String, keys: Vec<String>, on: bool) {
    let mut c = hold(&ws.0);
    for k in keys {
        let e = (area.clone(), k);
        if on {
            c.pinned.insert(e);
        } else {
            c.pinned.remove(&e);
        }
    }
}

/// What the workspace takes: each area, the work folders, the budget
#[tauri::command]
pub fn workspace_report(app: AppHandle, ws: State<'_, Workspace>) -> Result<Value, String> {
    let r = root(&app)?;
    let mut c = hold(&ws.0);
    load(&app, &mut c);
    let areas: Vec<Value> = AREAS
        .iter()
        .map(|(a, _)| {
            let size: u64 = c.entries.iter().filter(|((x, _), _)| x == a).map(|(_, e)| e.size).sum();
            json!({ "id": a, "size": size, "path": r.join("cache").join(a).to_string_lossy() })
        })
        .collect();
    let temp = crate::storage::size_of(&r.join("temp"));
    let cache: u64 = c.entries.values().map(|e| e.size).sum();
    drop(c);
    Ok(json!({ "path": r.to_string_lossy(), "areas": areas, "temp": temp, "cache": cache, "budget": budget(&app), "free": crate::system::free_space(&r).ok() }))
}

/// "Clean now": the work folders no job holds (the page names the live ones) and every entry not pinned. Bytes freed.
#[tauri::command]
pub fn workspace_clean(app: AppHandle, ws: State<'_, Workspace>, live: Vec<String>) -> Result<u64, String> {
    clean(&app, &ws, live)
}
pub(crate) fn clean(app: &AppHandle, ws: &Workspace, live: Vec<String>) -> Result<u64, String> {
    let app = app.clone();
    let mut freed = 0;
    let keep: HashSet<String> = live.into_iter().collect();
    if let Ok(rd) = fs::read_dir(temp_root(&app)?) {
        for e in rd.flatten() {
            if keep.contains(&e.file_name().to_string_lossy().into_owned()) {
                continue;
            }
            let p = e.path();
            let n = crate::storage::size_of(&p);
            if (if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) }).is_ok() {
                freed += n;
            }
        }
    }
    let mut c = hold(&ws.0);
    load(&app, &mut c);
    let gone: Vec<_> = c.entries.keys().filter(|k| !c.pinned.contains(*k)).cloned().collect();
    for k in gone {
        if let Ok(f) = file_of(&app, &k.0, &k.1) {
            if fs::remove_file(f).is_ok() {
                freed += c.entries.get(&k).map(|e| e.size).unwrap_or(0);
            }
        }
        c.entries.remove(&k);
    }
    save(&app, &mut c, true);
    Ok(freed)
}

/* ---------- measurements of the jobs ---------- */

#[tauri::command]
pub fn workspace_stats_get(app: AppHandle) -> Result<Value, String> {
    Ok(read_json(&root(&app)?.join("stats.json")).unwrap_or(json!({})))
}

#[tauri::command]
pub fn workspace_stats_put(app: AppHandle, stats: Value) -> Result<(), String> {
    if !stats.is_object() {
        return Err("stats must be an object".into());
    }
    write_atomic(&root(&app)?.join("stats.json"), stats.to_string().as_bytes())
}

/* ---------- models by hash ---------- */

/// SHA-256 is not in the dependencies: FNV-1a 64 over the whole file (a model is only compared with itself)
pub(crate) fn file_hash(p: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = fs::File::open(p).ok()?;
    let mut h: u64 = 0xcbf29ce484222325;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        for b in &buf[..n] {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    Some(format!("{h:016x}"))
}
fn models_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join("models.json"))
}
/// Remembers a downloaded file by its source URL: its path and its hash
pub(crate) fn model_add(app: &AppHandle, url: &str, path: &Path) {
    let Some(hash) = file_hash(path) else { return };
    let Ok(mp) = models_path(app) else { return };
    let mut m = read_json(&mp).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    m.insert(url.to_string(), json!({ "path": path.to_string_lossy(), "hash": hash, "size": fs::metadata(path).map(|x| x.len()).unwrap_or(0) }));
    let _ = write_atomic(&mp, Value::Object(m).to_string().as_bytes());
}
/// The same file downloaded before and still intact somewhere: copied instead of downloaded again
pub(crate) fn model_reuse(app: &AppHandle, url: &str, dest: &Path) -> bool {
    let Ok(mp) = models_path(app) else { return false };
    let Some(e) = read_json(&mp).and_then(|v| v.get(url).cloned()) else { return false };
    let (Some(src), Some(hash)) = (e.get("path").and_then(Value::as_str), e.get("hash").and_then(Value::as_str)) else { return false };
    let src = PathBuf::from(src);
    if src == dest {
        return dest.is_file() && file_hash(dest).as_deref() == Some(hash);
    }
    if !src.is_file() || file_hash(&src).as_deref() != Some(hash) {
        return false;
    }
    if let Some(d) = dest.parent() {
        let _ = fs::create_dir_all(d);
    }
    fs::hard_link(&src, dest).or_else(|_| fs::copy(&src, dest).map(|_| ())).is_ok()
}
/// A model file: reused when the same URL was downloaded before and is intact, else downloaded and remembered
pub(crate) fn fetch_model(app: &AppHandle, tool: &str, url: &str, dest: &Path) -> Result<(), String> {
    if !model_reuse(app, url, dest) {
        crate::download::fetch_to(app, tool, url, dest)?;
    }
    model_add(app, url, dest);
    Ok(())
}

/* ---------- start: work folders and the caches of earlier versions ---------- */

/// Moves the files of an old cache folder into an area (a file that cannot move is deleted: it is only a cache)
pub(crate) fn move_old(from: &Path, to: &Path) {
    let Ok(rd) = fs::read_dir(from) else { return };
    let _ = fs::create_dir_all(to);
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let dest = to.join(e.file_name());
        if fs::rename(&p, &dest).is_err() && fs::copy(&p, &dest).is_err() {
            let _ = fs::remove_file(&dest);
        }
        let _ = fs::remove_file(&p);
    }
    let _ = fs::remove_dir_all(from);
}

/// Called once at start: the work folders of the last run go, and the caches of 0.9 move into the workspace
pub(crate) fn begin(app: &AppHandle) {
    if let Ok(t) = temp_root(app) {
        clear_temp(&t);
    }
    let old = |parts: &[&str]| tools_dir_path(app).map(|t| parts.iter().fold(t, |p, x| p.join(x)));
    if let (Some(from), Ok(to)) = (old(&["cache", "cutout"]), area_dir(app, "masks")) {
        move_old(&from, &to);
    }
    if let (Some(from), Ok(to)) = (old(&["cache", "library"]), area_dir(app, "thumbs")) {
        move_old(&from, &to);
    }
    if let (Ok(local), Ok(to)) = (local_dir(app), area_dir(app, "frames")) {
        let from = local.join("Halation").join("cache").join("framegrab");
        move_old(&from, &to);
        let _ = fs::remove_dir(local.join("Halation").join("cache"));
    }
    if let Some(t) = old(&["temp"]) {
        let _ = fs::remove_dir_all(t);
    }
}
fn tools_dir_path(app: &AppHandle) -> Option<PathBuf> {
    docs_dir(app).ok().map(|d| d.join(BASE).join("Tools"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(size: u64, used: u64) -> Entry {
        Entry { size, used }
    }
    fn k(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    #[test]
    fn eviction_takes_the_least_recently_used_first_and_keeps_pins() {
        let mut m = HashMap::new();
        m.insert(k("frames", "a"), e(400, 1));
        m.insert(k("masks", "b"), e(300, 2));
        m.insert(k("thumbs", "c"), e(200, 3));
        m.insert(k("frames", "d"), e(100, 4));
        let none = HashSet::new();
        assert_eq!(evict(&m, &none, 1000), Vec::<(String, String)>::new());
        assert_eq!(evict(&m, &none, 600), vec![k("frames", "a")]);
        assert_eq!(evict(&m, &none, 250), vec![k("frames", "a"), k("masks", "b"), k("thumbs", "c")]);
        let pins: HashSet<_> = [k("frames", "a")].into_iter().collect();
        assert_eq!(evict(&m, &pins, 600), vec![k("masks", "b"), k("thumbs", "c")]);
        // pinned entries may leave the cache over its budget, never out of it
        assert_eq!(evict(&m, &pins, 0), vec![k("masks", "b"), k("thumbs", "c"), k("frames", "d")]);
    }

    #[test]
    fn keys_and_leases_stay_inside() {
        assert!(valid_key("abc_1-2"));
        assert!(!valid_key("../x"));
        assert!(!valid_key(""));
        assert!(lease_name("j_000001").is_ok());
        assert!(lease_name("..\\j").is_err());
    }

    #[test]
    fn temp_is_emptied_and_old_caches_move() {
        let d = std::env::temp_dir().join(format!("halation-ws-{}", std::process::id()));
        let t = d.join("temp");
        fs::create_dir_all(t.join("j_000001").join("in")).unwrap();
        fs::write(t.join("j_000001").join("in").join("a.png"), vec![0u8; 100]).unwrap();
        fs::write(t.join("loose.png"), vec![0u8; 50]).unwrap();
        assert_eq!(clear_temp(&t), 150);
        assert_eq!(fs::read_dir(&t).unwrap().count(), 0);
        let old = d.join("old");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("k1.png"), b"x").unwrap();
        fs::write(old.join("k2.png"), b"y").unwrap();
        move_old(&old, &d.join("masks"));
        assert!(!old.exists());
        assert_eq!(fs::read(d.join("masks").join("k1.png")).unwrap(), b"x");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn hashes_follow_the_content() {
        let d = std::env::temp_dir().join(format!("halation-wsh-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a"), b"model").unwrap();
        fs::write(d.join("b"), b"model").unwrap();
        fs::write(d.join("c"), b"other").unwrap();
        assert_eq!(file_hash(&d.join("a")), file_hash(&d.join("b")));
        assert_ne!(file_hash(&d.join("a")), file_hash(&d.join("c")));
        let _ = fs::remove_dir_all(&d);
    }
}
