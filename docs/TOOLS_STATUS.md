# Tools status — native line

Status: FASE 0 inventory (2026-10-23). The ten media tools are catalog entries only: no native page, controller or
connected engine exists for any of them, and none is available in the beta.

This document says what each of the ten media tools has in the native app today, which spec owns its behaviour and
where the Tauri app on `main` implements it. It is an inventory, not a promise: a tool is not "ported" because it
appears in a list or because its name compiles into the catalog. The Tauri app is the behaviour reference; its
interface is not a template (see the clean-room rule in [AGENTS.md](../AGENTS.md)).

## How to read the status

| Status | Meaning |
| --- | --- |
| `nada` | No trace in the native app. |
| `UI falsa` | A name, icon and card exist, but activating the tool opens nothing and runs nothing. This is an explicit placeholder, not a working imitation. |
| `parcial` | At least one real path works end to end in the native app (input, processing, output), even if incomplete. |
| `completa` | The spec is implemented in the native app and its acceptance criteria are verified. Visible changes still need Java's visual OK. |

All ten tools are **`UI falsa`**. The catalog is honest about it: the activation notice says the tool is not available
in the beta and that the processing engines are not connected (`crates/halation-app/src/catalog.rs:148-157`).

## Native baseline

The native app has a catalog of eleven entries: the ten media tools plus Library (`catalog.rs:20-142`). Every media
tool is declared `available: false`; Library is the only available entry. The rail, Home strip and Settings > Tools
all render that catalog (`ui/app.slint:312-324`, `ui/pages/home.slint:127-131`,
`ui/pages/settings.slint:497-523`). Activating anything other than Library only sets a notice; it does not navigate
or create a page (`crates/halation-app/src/app.rs:544-562`). The native navigation has four pages — Home, Library,
Jobs, Settings — and none is a tool page (`crates/halation-app/src/navigation.rs:2-10`). Tests lock the current
truth: Downloader is unavailable and produces the notice (`crates/halation-app/tests/services.rs:365-366`), while the
rail still lists its name (`crates/halation-app/tests/ui_layout.rs:202-203`).

The same catalog lists thirteen downloadable components with approximate sizes (`catalog.rs:159-175`), but the native
beta cannot install any of them; the comment above the list says so. There is no native engine status, install flow,
per-tool settings, job submission from a tool, preview, export or session state for these tools. The core queue,
process and engine contract exist without connected engines ([jobs.md](features/jobs.md)), and the global destination
rules exist without an export using them ([save-location.md](features/save-location.md)).

## Summary

| Tool | Native id | Tauri id | Status | Spec |
| --- | --- | --- | --- | --- |
| Downloader | `downloader` | `downloader` | `UI falsa` | [downloader.md](features/downloader.md) (new) |
| Converter | `converter` | `convert` | `UI falsa` | [converter.md](features/converter.md) |
| Vocal Remover | `vocal-remover` | `stems` | `UI falsa` | [vocal-remover.md](features/vocal-remover.md) |
| Audio Visualizer | `audio-visualizer` | `visualizer` | `UI falsa` | [audio-visualizer.md](features/audio-visualizer.md) (new) |
| Grade | `grade` | `grade` | `UI falsa` | [grade-looks.md](features/grade-looks.md) |
| Cover Test | `cover-test` | `covertest` | `UI falsa` | [cover-test.md](features/cover-test.md) |
| Background Remover | `background-remover` | `removebg` | `UI falsa` | [remove-background.md](features/remove-background.md) |
| Upscale | `upscale` | `upscale` | `UI falsa` | [upscale.md](features/upscale.md) (new) |
| AI Interpolate | `ai-interpolate` | `interp` | `UI falsa` | [framerate.md](features/framerate.md) |
| Frame Capture | `frame-capture` | `framegrab` | `UI falsa` | [frame-capture.md](features/frame-capture.md) (new) |

The Tauri registry that defines these ids, their components, accepted content and stage is
`main:app/dist/modules.js:22-31`. The native ids differ in seven places and must be mapped when importing behaviour:
`converter` → `convert`, `vocal-remover` → `stems`, `audio-visualizer` → `visualizer`, `cover-test` → `covertest`,
`background-remover` → `removebg`, `ai-interpolate` → `interp`, `frame-capture` → `framegrab`.

## Tools

### Downloader

**Status: `UI falsa`.** Catalog card, rail entry and Settings row exist; activation shows the unavailable notice. No
page, preview, queue or download path exists.

- **Spec:** [downloader.md](features/downloader.md) (new; Tauri behaviour verified from code and recorded there).
- **Tauri origin:** `main:app/dist/downloader.js`, `downloader.html`, `spotify.js`; component/engine handling in
  `main:app/src-tauri/src/tools.rs`; commands registered in `main.rs` and implemented in `web.rs` (`http_text`,
  `http_bytes`), `procs.rs` (`proc_start`) and `save_location.rs`.
- **Components:** yt-dlp (18 MB) and FFmpeg (140 MB) required; Cutout (445 MB) optional. The native catalog says
  `yt-dlp, FFmpeg` missing (`catalog.rs:21-31`).
- **Reference behaviour:** link preview with `yt-dlp -J`, playlist listing capped at 300 tracks, Spotify metadata
  with YouTube Music/YouTube matching and scoring, video H.264/AAC MP4, audio "Original" or MP3 VBR q0, Spotify
  tagging without re-encoding, PNG covers, cancellable per-item jobs.
- **Gaps:** every engine, network call, preview, queue, Spotify search, tagger and cover converter; no yt-dlp/FFmpeg
  detection or install; no download session or destination call.

### Converter

**Status: `UI falsa`.** Catalog entry only; the full spec already exists and the Tauri implementation is the
reference. No native page or conversion engine.

- **Spec:** [converter.md](features/converter.md).
- **Tauri origin:** `main:app/dist/convert.js`, `convert.html`, `convert.css`; backend
  `main:app/src-tauri/src/convert.rs` (probe, planning, image/PDF paths) and `encode.rs` (FFmpeg plans), component
  install in `tools.rs`.
- **Components:** FFmpeg (140 MB), Pandoc (40 MB), LibreOffice (360 MB), PDFium (4 MB); all optional in the Tauri
  registry, with images usable without FFmpeg (`modules.js:23`).
- **Reference behaviour:** content-based detection, curated input → output table, copy-before-re-encode, fixed
  defaults per format, batch groups, document/PDF v2 paths, `.part` files and cancellation.
- **Gaps:** all of it in native: detection, plan, image encoders, FFmpeg/Pandoc/LibreOffice/PDFium orchestration,
  previews, batch UI and sessions.

### Vocal Remover

**Status: `UI falsa`.** Catalog entry only; no native separation path.

- **Spec:** [vocal-remover.md](features/vocal-remover.md).
- **Tauri origin:** `main:app/dist/stems.js`, `stems.html`, `stems.css`; backend `main:app/src-tauri/src/stems.rs`
  (ONNX Runtime, models, separation) and component install in `tools.rs`.
- **Components:** FFmpeg (140 MB), ONNX Runtime with DirectML (36 MB), UVR-MDX-NET Inst HQ4 (59 MB); HTDemucs
  (170 MB) optional.
- **Reference behaviour:** two-stem or four-stem separation, GPU/CPU choice, progress and preview peak, jobs and
  cancellation, outputs through the save policy.
- **Gaps:** ONNX Runtime integration, model installation and validation, audio decode/encode, separation jobs,
  stem playback and all native UI.

### Audio Visualizer

**Status: `UI falsa`.** Catalog entry only; no preview canvas, renderer, preset store or export.

- **Spec:** [audio-visualizer.md](features/audio-visualizer.md) (new; the full verified schema and defaults are
  recorded there).
- **Tauri origin:** `main:app/dist/visualizer.js`, `visualizer.html`, `visualizer.css`; shared encoding in
  `main:app/src-tauri/src/encode.rs`, cutout in `cutout.rs`, component install in `tools.rs`. The visualizer itself
  runs page-side.
- **Components:** FFmpeg (140 MB), not needed by the Tauri single-video path but required for the layer export; Cutout
  (445 MB) optional.
- **Reference behaviour:** audio + square cover preview, seven setting groups with all defaults, named presets and
  JSON import/export, single MP4 (H.264 or VP9 + AAC or Opus), layered export (ProRes 4444/WebM/PNG, WAV, envelope),
  batch queue and clip trimming.
- **Gaps:** native renderer and preview, audio analysis (FFT/bass envelope), preset persistence, MP4 encoder choice,
  layer export, batch jobs and all controls.

### Grade

**Status: `UI falsa`.** Catalog entry only; no image pipeline, LUT or look browser.

- **Spec:** [grade-looks.md](features/grade-looks.md).
- **Tauri origin:** `main:app/dist/grade.js`, `grade-looks.js`, `grade-color.js`, `grader.js`, `grade.html`,
  `grade.css`; presets in `main:app/src-tauri/src/presets.rs`; Cutout in `cutout.rs`.
- **Components:** Cutout (445 MB) optional.
- **Reference behaviour:** non-destructive grading, looks/LUTs, before/after, crop and cutout chain, export through
  the save policy.
- **Gaps:** colour pipeline, LUT parsing/application, look presets, preview, export and native UI.

### Cover Test

**Status: `UI falsa`.** Catalog entry only; no cover preview or comparison workspace.

- **Spec:** [cover-test.md](features/cover-test.md).
- **Tauri origin:** `main:app/dist/covertest.js`, `covertest.html`, `covertest.css`; no dedicated
  `main:app/src-tauri` module. Shared file/save commands only.
- **Components:** none (`modules.js:27`).
- **Reference behaviour:** up to three covers previewed inside local recreations of the YouTube, Spotify and
  SoundCloud artist, release and feed views at their real sizes, with real surrounding content, an artist profile and
  a cached feed, a draggable position for the cover, and PNG export at the view's size.
- **Gaps:** every platform template, profile/feed reading and cache, cover crop and positioning, export and native
  UI.

### Background Remover

**Status: `UI falsa`.** Catalog entry only; no Cutout engine connected.

- **Spec:** [remove-background.md](features/remove-background.md).
- **Tauri origin:** `main:app/dist/removebg.js`, `removebg.html`, `removebg.css`, `cutout-worker.js`; backend
  `main:app/src-tauri/src/cutout.rs` and component install in `tools.rs`.
- **Components:** Cutout (445 MB), marked optional in the Tauri registry but required to remove a background; the tool
  offers its download when it is missing.
- **Reference behaviour:** background removal with SAM/Cutout, mask editing, transparent PNG and save-policy
  destinations.
- **Gaps:** Cutout runtime and model, mask editing, PNG export and native UI.

### Upscale

**Status: `UI falsa`.** Catalog entry only; no Upscayl/SPAN engine and no image or video path.

- **Spec:** [upscale.md](features/upscale.md) (new; verified models, defaults and pipelines are recorded there).
- **Tauri origin:** `main:app/dist/upscale.js`, `upscale.html`, `upscale.css`; engine/model/SPAN install and
  discovery in `main:app/src-tauri/src/tools.rs`; shared work folder/count commands in `interp.rs`.
- **Components:** Upscayl engine (10 MB), models (70 MB), SPAN (14 MB), FFmpeg (140 MB); Cutout (445 MB) optional.
- **Reference behaviour:** image ×2/×4 with four models, PNG/JPG, optimal odd-size padding and crop, optional
  cutout; video ×2/×4 through FFmpeg → SPAN → FFmpeg with exact rational fps, H.264 CRF 16 and audio copy/AAC 320k.
- **Gaps:** engine discovery/install, model validation, image and video pipelines, GPU jobs, before/after preview,
  cancellation and native UI. The "Sharp" model's non-commercial licence notice must survive the port.

### AI Interpolate

**Status: `UI falsa`.** Catalog entry only; no RIFE engine and no interpolation jobs.

- **Spec:** [framerate.md](features/framerate.md) (AI Interpolate).
- **Tauri origin:** `main:app/dist/interp.js`, `interp.html`, `interp.css`; backend
  `main:app/src-tauri/src/interp.rs` (RIFE 4.6 install/run, work folder) and `encode.rs` (output encode), component
  install in `tools.rs`.
- **Components:** RIFE (180 MB) and FFmpeg (140 MB).
- **Reference behaviour:** frame-rate multiplication with RIFE, exact rational fps, preview, audio handling, jobs
  and cancellation.
- **Gaps:** RIFE runtime/model, frame extraction and encoding, interpolation parameters, preview, jobs and native UI.

### Frame Capture

**Status: `UI falsa`.** Catalog entry only; no viewer, timeline, decoder, queue or export.

- **Spec:** [frame-capture.md](features/frame-capture.md) (new; exact-frame, crop and destination behaviour is
  recorded there).
- **Tauri origin:** `main:app/dist/framegrab.js`, `framegrab.html`, `framegrab.css`; backend
  `main:app/src-tauri/src/framegrab.rs` (content key, ranged reads, workspace cache, picker) and the shared
  `frameAt`/keyframe services in `main:app/dist/services.js`.
- **Components:** FFmpeg (140 MB).
- **Reference behaviour:** exact-frame viewer with keyframe index and FFmpeg fallback, timeline scrub/step/play,
  sharpest-frame search, layouts and draggable crop, queue of 8, PNG export to Back/Send/Library/Image.
- **Gaps:** native decoder or FFmpeg frame service, keyframe index/cache, timeline widget, crop math, queue,
  destinations and native UI.

## Cross-cutting gaps

1. **No tool page or controller.** Only Home, Library, Jobs and Settings exist as pages; a tool page needs a
   navigation entry and a Rust service, not UI state in a Slint page instance.
2. **No engine lifecycle.** Components are a static list; nothing installs, locates, validates or reports an engine.
3. **No job submission from tools.** The core queue exists, but no tool submits work, reports progress, cancels or
   records an output.
4. **No save/export integration.** The destination policy is specified but unused; every tool still needs to call it
   and to record exports in the Library/session.
5. **No visual contract.** These specs fix behaviour, not layout. Any native page will be a new clean-room design
   and "implemented, pending visual review" until Java approves it in the native window.
6. **Licences stay with the component.** yt-dlp is Unlicense, FFmpeg is GPL-3.0, upscayl-ncnn and the
   Upscayl-published models are AGPL-3.0, SPAN's runner is AGPL-3.0 (its models keep the upstream licences), and the
   "Sharp" model is CC BY-NC-SA 4.0 (results non-commercial). If Halation ever mirrors a build instead of downloading
   it from upstream, the corresponding source and notices are required. See
   [THIRD_PARTY.md](../THIRD_PARTY.md) and the licence sections of the specs.

## Sources

- Native: `crates/halation-app/src/catalog.rs`, `app.rs`, `navigation.rs`; `crates/halation-app/ui/app.slint`,
  `ui/pages/home.slint`, `ui/pages/settings.slint`; `crates/halation-app/tests/services.rs`, `tests/ui_layout.rs`.
- Tauri on `main`: `app/dist/modules.js`, the ten tool pages and modules, `app/src-tauri/src/{tools,download,convert,
  encode,stems,interp,framegrab,cutout,presets}.rs`.
- Existing specs linked above; new specs written in this change for Downloader, Audio Visualizer, Upscale and Frame
  Capture.
