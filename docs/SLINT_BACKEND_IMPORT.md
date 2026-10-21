# Slint backend import plan

Status: 2026-10-21. Scope of the rule in `docs/SLINT_SPEC.md` (Authority and boundaries): the Rust backend of the Tauri app
(`app/src-tauri/src`) is kept and reused by the native crate (`slint/`); only the visual layer stays clean-room.

## Rules for every import

- Source is copied into `slint/src/backend/` and adapted there. The native crate never depends on `app/src-tauri`
  (no path dependency, no FFI) and never on any Tauri crate: the module is checked with `grep -r "tauri" slint/src slint/Cargo.toml`.
- What Tauri provided (`AppHandle` paths, `State`, `emit`, `#[tauri::command]`) becomes an own interface: a trait or a
  plain struct passed in by the caller. The page-facing layer (Slint controller) implements the trait; the module has no
  UI types.
- Each module arrives with its tests, in the module or in `slint/tests/`, adapted to the new interface. The gates of
  `AGENTS.md` pass before it is committed: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
  release build, lockfile and feature graph (winit + Skia).
- Dependencies a module adds are public registry crates, pinned with `=`, and listed in this document; a module whose
  dependency costs memory or startup is not imported without a lighter alternative.
- The native profile stays isolated: an imported module reads no Tauri settings, Library data or sessions.

## Modules

| Backend module (`app/src-tauri/src`) | Plan | Notes |
| --- | --- | --- |
| `procs.rs` (run tools, kill a job's process tree) | Import first → `backend/process.rs` | `AppHandle` events become a `ProcessEvents` trait; tool lookup (`tools.rs`) stays out: the caller gives the program path. Windows Job Object per job through `windows-sys`. |
| `workspace.rs`, `sessions.rs` (job and session bookkeeping) | Adapt next, for the Jobs queue (state, cancellation, progress) | Check what is coupled to `State<…>`; keep file formats of recovery data only if the native profile needs them. |
| `library.rs`, `files.rs`, `outfiles.rs` (sections, linked folders, thumbnails, outputs) | Adapt for Library sections and linking PC folders | The native crate already has its own reference index (`slint/src/library.rs`); the import adds sections and linked folders on top, not a second index. |
| `state.rs`, `profile.rs`, `save_location.rs`, `presets.rs`, `storage.rs` | Adapt for Settings and the profile | The native profile keeps its own folder and schema; only the logic (atomic writes, name validation, storage report) is reused. |
| `paths.rs`, `system.rs`, `window.rs`, `update.rs`, `web.rs`, `openwith.rs`, `assets.rs`, `migrate.rs` | Not imported now | Tauri/WebView specific, or updater/release scope. |
| `download.rs`, `tools.rs`, `convert.rs`, `encode.rs`, `framegrab.rs`, `interp.rs`, `cutout.rs`, `stems.rs` | Out of scope for now | Engines and tools (FFmpeg, yt-dlp, upscaler, RIFE, ONNX, PDFium): connected later behind honest capabilities; the beta shows them as unavailable. |

## Added dependencies

- `windows-sys` (Windows only; features `Win32_Foundation`, `Win32_Security`, `Win32_System_JobObjects`, `Win32_System_ProcessStatus`, `Win32_System_Threading`):
  Job Object and process memory for `backend/process.rs`. Pinned with `=` in `slint/Cargo.toml`.
- `i-slint-backend-testing` (dev-dependency only, pinned `=1.18.1`): headless layout tests (`slint/tests/ui_layout.rs`). Debug info for the element tree is compiled into non-release builds only (`build.rs`); it is not in the shipping graph.

## Status

- `backend/process.rs`: imported 2026-10-21 (see the module header for the interface).
- `backend/queue.rs` + `backend/engine.rs`: the scheduler of `docs/JOBS_SPEC.md` (lanes, costs, priorities, backfill, hold, cancel by id or group, last 50 finished) and an event-driven engine that runs admitted jobs through `process.rs` (2026-10-21). Written against the spec rather than ported from `workspace.rs`/`sessions.rs`, which are bound to `tauri::State`. Missing from the spec: VRAM/RAM/disk needs, measured statistics, `yield`, reordering, stage changes, minimized pause. The Jobs page now lists the engine's jobs (state, progress, Cancel, Clear finished) through `slint/src/jobs.rs`; no tool is registered, so nothing can be queued from the UI and the page keeps the honest DISCONNECTED capability (2026-10-21).
- `backend/sections.rs` + `backend/names.rs`: Library sections on disk (own sections, linked PC folders, packs, media items, safe writes and removals, path checks) imported from `library.rs` and the file-name rules of `paths.rs`, as typed structs instead of JSON values (2026-10-21). Not imported: thumbnails, the page-owned index (`crate::library` keeps the reference index), file identity (`file_key`) and the Tauri commands. Wired (2026-10-21) through `slint/src/folders.rs` (commands run off the UI thread; linked folders persist in the profile's `links.json`, written atomically and never overwritten when damaged) and a Sections tab on the Library page: create, rename and delete own sections, link and unlink PC folders, browse packs and items (first 500 per section).
