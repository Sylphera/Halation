# Slint backend import plan

Status: 2026-10-21. Scope of the rule in `docs/SLINT_SPEC.md` (Authority and boundaries): the Rust backend of the Tauri app
(`app/src-tauri/src`) is kept and reused by the native workspace (`crates/halation-core`); only the visual layer stays clean-room.

## Rules for every import

- Source is copied into `crates/halation-core/src/` and adapted there. The native crate never depends on `app/src-tauri`
  (no path dependency, no FFI) and never on any Tauri crate: the module is checked with `grep -ri "tauri" crates Cargo.toml` (outside comments).
- What Tauri provided (`AppHandle` paths, `State`, `emit`, `#[tauri::command]`) becomes an own interface: a trait or a
  plain struct passed in by the caller. The page-facing layer (Slint controller) implements the trait; the module has no
  UI types.
- Each module arrives with its tests, in the module or in `crates/halation-core/tests/`, adapted to the new interface. The gates of
  `AGENTS.md` pass before it is committed: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
  release build, lockfile and feature graph (winit + Skia).
- Dependencies a module adds are public registry crates, pinned with `=`, and listed in this document; a module whose
  dependency costs memory or startup is not imported without a lighter alternative.
- The native profile stays isolated: an imported module reads no Tauri settings, Library data or sessions.

## Modules

| Backend module (`app/src-tauri/src`) | Plan | Notes |
| --- | --- | --- |
| `procs.rs` (run tools, kill a job's process tree) | Import first → `process.rs` | `AppHandle` events become a `ProcessEvents` trait; tool lookup (`tools.rs`) stays out: the caller gives the program path. Windows Job Object per job through `windows-sys`. |
| `workspace.rs`, `sessions.rs` (job and session bookkeeping) | Adapt next, for the Jobs queue (state, cancellation, progress) | Check what is coupled to `State<…>`; keep file formats of recovery data only if the native profile needs them. |
| `library.rs`, `files.rs`, `outfiles.rs` (sections, linked folders, thumbnails, outputs) | Adapt for Library sections and linking PC folders | The native crate already has its own reference index (`slint/src/library.rs`); the import adds sections and linked folders on top, not a second index. |
| `save_location.rs` | Imported → `destinations.rs` | See Status. |
| `presets.rs` | Imported → `presets.rs` | See Status. |
| `profile.rs` | Imported → `artist_profile.rs` | See Status. |
| `state.rs`, `storage.rs` | Not imported (decided 2026-10-21) | The native profile keeps its own folder and schema; only the logic (atomic writes, name validation, storage report) is reused. |
| `paths.rs`, `system.rs`, `window.rs`, `update.rs`, `web.rs`, `openwith.rs`, `assets.rs`, `migrate.rs` | Not imported now | Tauri/WebView specific, or updater/release scope. |
| Media parts of `convert.rs`, FFmpeg parts of `tools.rs` and `download.rs` | Adapted → `convert.rs`, `components.rs` (2026-10-22, in progress) | Typed media probe/table/plan/image execution and on-demand external FFmpeg pair installation. No Tauri commands, document engines or visual source. Tests cover planner rules, generated images and native jobs; an explicit integration example generates its own video/audio. |
| `framegrab.rs` (content key, authorization, workspace cache, picker) | Adapted → `framegrab.rs` (2026-10-23) | FFmpeg/ffprobe replace Mediabunny and the Tauri commands; native types plus the shared job engine. Probe, exact native PNG capture, preview windows, keyframe index/strip, sharpness, crop math, queue and session. No Tauri `State`, events or visual source. Tests include generated FFmpeg video. |
| `encode.rs`, `interp.rs`, `cutout.rs`, `stems.rs`; non-FFmpeg parts of `tools.rs`/`download.rs` | Out of scope for now | Other engines remain unavailable. |

## Added dependencies

- Converter: `image =0.25.10`, `webp =0.3.1`, `tiff =0.11.3`, `ureq =3.5.0` (native TLS, without default features),
  `zip =8.6.0` (deflate only). See `THIRD_PARTY.md`. Images decode on bounded workers, never at Home startup;
  only one large image/preview decode is admitted at a time. FFmpeg remains a separate process. The alternative
  using FFmpeg for every image was not selected: images must also work without an installed component.
- `windows-sys` adds `Win32_Storage_FileSystem` for Windows no-replace publication (`MoveFileExW` with no replace
  flag), so managed outputs do not require hard-link support on the destination volume. The unsafe boundary is a
  single documented UTF-16 path call; manually confirmed replacement still uses the native rename operation.

- Audio preview (`playback.rs`, written for the native app, not imported): `windows =0.62.2` in `halation-core`, the
  version the app already uses for Media Foundation, with `Win32_Media_Audio`, `Win32_System_Com(_StructuredStorage)`,
  `Win32_System_Variant`, `Win32_System_Threading` and `Win32_Security` for a shared-mode WASAPI render client. No new
  crate in the graph. Decoding stays in the external FFmpeg.

- `windows-sys` (Windows only; features `Win32_Foundation`, `Win32_Security`, `Win32_System_JobObjects`, `Win32_System_ProcessStatus`, `Win32_System_Threading`):
  Job Object and process memory for `process.rs`. Pinned with `=` in the crate manifests.
- `i-slint-backend-testing` (dev-dependency only, pinned `=1.18.1`): headless layout tests (`crates/halation-app/tests/ui_layout.rs`). Debug info for the element tree is compiled into non-release builds only (`build.rs`); it is not in the shipping graph.

## Status

- Converter adaptation implemented (2026-10-22): native controller and clean-room tool frame wired to the shared
  scheduler, destinations and external processes, plus the native audio preview. Library remains removed. Video
  transport, Send to and sessions are still open and nothing is visually approved; see
  [the active plan](../planning/active/converter-native.md).

- `process.rs`: imported 2026-10-21 (see the module header for the interface).
- `queue.rs` + `engine.rs`: the scheduler of `docs/JOBS_SPEC.md` (lanes, costs, priorities, backfill, hold, cancel by id or group, last 50 finished) and an event-driven engine that runs admitted jobs through `process.rs` (2026-10-21). Written against the spec rather than ported from `workspace.rs`/`sessions.rs`, which are bound to `tauri::State`. Missing from the spec: VRAM/RAM/disk needs, measured statistics, `yield`, reordering, stage changes, minimized pause. The Jobs page now lists the engine's jobs (state, progress, Cancel, Clear finished) through `slint/src/jobs.rs`; no tool is registered, so nothing can be queued from the UI and the page keeps the honest DISCONNECTED capability (2026-10-21).
- `sections.rs` + `names.rs`: Library sections on disk (own sections, linked PC folders, packs, media items, safe writes and removals, path checks) imported from `library.rs` and the file-name rules of `paths.rs`, as typed structs instead of JSON values (2026-10-21). Not imported: thumbnails, the page-owned index (`crate::library` keeps the reference index), file identity (`file_key`) and the Tauri commands. Wired (2026-10-21) through `slint/src/folders.rs` (commands run off the UI thread; linked folders persist in the profile's `links.json`, written atomically and never overwritten when damaged) and a Sections tab on the Library page: create, rename and delete own sections, link and unlink PC folders, browse packs and items (first 500 per section).
- `destinations.rs`: the export destination policy of `save_location.rs` (managed folder under a free name with reservations, save dialog behind a `SavePicker` trait, remembered last folder and one-time explanation as an `ExportLocation` the caller stores, writes only to granted paths) (2026-10-21). Used by Converter and, since 2026-10-23, by Frame Capture. Not imported: the Tauri commands and the `Documents\Halation` folder layout (`paths.rs`).
- `presets.rs`: one `.json` per preset in a folder the caller gives (list, folder stamp, atomic write, delete, rename or copy without overwriting) (2026-10-21). Not wired to the UI: the tools that use presets are not in the beta.
- `artist_profile.rs`: the artist profile files (`profile.json`, avatar/banner/reference images) and the clearable platform feed cache, with restricted file names, atomic writes and prune by prefix (2026-10-21). Not wired to the UI: the Cover Test is not in the beta. Not imported: the Tauri commands and the web parsing, which stay with the pages.
- `framegrab.rs`: adapted 2026-10-23 from the Tauri backend (`app/src-tauri/src/framegrab.rs`: content key,
  authorization, picker, workspace cache) and the `frameAt`/keyframe services of `app/dist/services.js`, behind native
  types and the shared engine. The Tauri commands, `State`, workspace JSON, Mediabunny and the page JavaScript are not
  imported; FFmpeg/ffprobe remain external processes. The native module holds probe, exact native PNG capture,
  ±12-frame preview windows, the packet-flag keyframe index and strip, Laplacian sharpness, crop math, the queue and
  session types. Wired through `crates/halation-app/src/framegrab.rs` and `ui/pages/framegrab.slint`; tests include
  generated FFmpeg video and the 4K native-capture check. No new crate was added (`image` was already present).
- `state.rs` and `storage.rs` stay out: `state.rs` is the Tauri tool-session store (temporary tool state, recovery, legacy migrations) and its generic part (one locked JSON object, damaged file kept aside) already exists in `slint/src/settings.rs`; `storage.rs` reports what the downloadable components take, which needs the engines. Revisit when sessions or engines arrive.
