# Tools status — native line

Status: FASE 0 inventory and shared UI contract (2026-10-23); the native base was integrated and Converter re-checked
on 2026-10-23. This branch (`slint/tools-all`) now carries `origin/slint/native` at `ac16162` (merge `222a9f5`),
including the redesign, Converter and the motion/material/themes work. Converter has a native page and engine path; the
other nine media tools are catalog entries only, with no native page, controller or connected engine, and none is
available in the beta.

This document says what each of the ten media tools has in the native app today, which spec owns its behaviour and
where the Tauri app on `main` implements it. It is an inventory, not a promise: a tool is not "ported" because it
appears in a list or because its name compiles into the catalog. The Tauri app is the behaviour reference; its
interface is not a template (see the clean-room rule in [AGENTS.md](../AGENTS.md)). The native visual template is
Converter, under the shared contract below.

## How to read the status

| Status | Meaning |
| --- | --- |
| `nada` | No trace in the native app. |
| `UI falsa` | A name, icon and card exist, but activating the tool opens nothing and runs nothing. This is an explicit placeholder, not a working imitation. |
| `parcial` | At least one real path works end to end in the native app (input, processing, output), even if incomplete. |
| `completa` | The spec is implemented in the native app and its acceptance criteria are verified. Visible changes still need Java's visual OK. |

Nine tools are **`UI falsa`**; Converter is **`parcial`** and is the template. The catalog is honest about the nine:
the activation notice says the tool is not available in the beta and that the processing engines are not connected
(`crates/halation-app/src/catalog.rs:148-157`). Converter's native page and the approval recorded upstream are in
[converter.md](features/converter.md). The FASE 0 audit began before Converter existed; this branch now contains the
native Converter, and the rows below describe that integrated code.

## Visual contract (all ten tools)

Java, 2026-10-23: finish all ten media tools for visual review, with one interface, not ten. Every native tool page
uses the approved Linear/Figma redesign already merged in `slint/native`: the same components, tokens, surfaces,
typography and native motion. **Converter is the canonical page template**; no tool gets its own visual language.
Where the redesign's §9 names Vocal Remover as the reference tool, this instruction supersedes it for the template.

- **Frame and components.** Use the shell (sidebar and top bar) and the tool frame of the
  [approved redesign](../planning/active/ui-redesign.md): left panel 220 px, canvas, inspector 280 px and docked bar
  40 px when the tool needs those regions; one primary action in the top bar. Reuse the shared Slint components and
  the Converter page's spacing, control sizes, row heights, empty states and primary-action placement.
- **Material and type.** Use the current native material and type in [material.md](features/material.md); use the
  colours and state tokens in [themes.md](features/themes.md). No page-local palette, font, radius, shadow, border or
  spacing scale.
- **Motion.** Use the current native contract in [motion.md](features/motion.md): native Slint animation only, no idle
  animation, and 0 ms with reduced motion. [MOTION.md](MOTION.md) documents the Tauri/GSAP app; it is not the
  native reference.
- **Template.** [converter.md](features/converter.md) is the reference page: same frame, controls, state treatment and
  primary-action placement. A tool may add only the controls its function requires, built from the shared components.
- **State and work.** UI state lives in Rust services, never in a page instance; heavy work runs off the UI thread.
  This is already the native rule and applies to every tool page.
- **Review gate.** A page is "implemented, pending visual review" until Java approves it in the real native window.
  Converter is already approved; the other nine must reach the same bar, and all ten are reviewed. No page is complete
  because it compiles or because its tests pass.

## Native baseline

On this integrated line, the catalog has eleven entries: the ten media tools plus Library
(`crates/halation-app/src/catalog.rs:20-142`). Converter is available and opens its page
(`catalog.rs:33-40`, `navigation.rs:2-35`, `ui/app.slint:222`); the nine other media tools are declared
`available: false`, and Library is also available. The rail, Home strip and Settings > Tools all render that catalog.
Activating an unavailable tool only sets a notice; it does not navigate or create a page.
Tests lock the unavailable nine: Downloader produces the notice (`crates/halation-app/tests/services.rs:366-367`),
while the rail still lists its name (`crates/halation-app/tests/ui_layout.rs:284-285`).

The same catalog lists thirteen downloadable components with approximate sizes (`catalog.rs:161-175`). Converter has
an FFmpeg installation path and submits real jobs; the other nine cannot install a component or submit work. There is
no engine status, per-tool settings, preview, export or session state for those nine. The core queue, process and
engine contract exist ([jobs.md](features/jobs.md)); the global destination rules are used by Converter
([save-location.md](features/save-location.md)).

## Summary

| Tool | Native id | Tauri id | Status | Spec |
| --- | --- | --- | --- | --- |
| Downloader | `downloader` | `downloader` | `UI falsa` | [downloader.md](features/downloader.md) (new) |
| Converter | `converter` | `convert` | `parcial` (native page approved; Send to and sessions remain) | [converter.md](features/converter.md) |
| Vocal Remover | `vocal-remover` | `stems` | `UI falsa` | [vocal-remover.md](features/vocal-remover.md) |
| Audio Visualizer | `audio-visualizer` | `visualizer` | `UI falsa` | [audio-visualizer.md](features/audio-visualizer.md) (new) |
| Grade | `grade` | `grade` | `UI falsa` | [grade-looks.md](features/grade-looks.md) |
| Cover Test | `cover-test` | `covertest` | `UI falsa` | [cover-test.md](features/cover-test.md) |
| Background Remover | `background-remover` | `removebg` | `UI falsa` | [remove-background.md](features/remove-background.md) |
| Upscale | `upscale` | `upscale` | `UI falsa` | [upscale.md](features/upscale.md) (new) |
| AI Interpolate | `ai-interpolate` | `interp` | `UI falsa` | [framerate.md](features/framerate.md) |
| Frame Capture | `frame-capture` | `framegrab` | `UI falsa` | [frame-capture.md](features/frame-capture.md) (new) |

Converter is the only tool with a native page; it is the reference implementation for the other nine under the
[visual contract](#visual-contract-all-ten-tools).

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

**Status: `parcial`.** The native Converter page was implemented and approved by Java on `slint/native` (2026-10-22):
tool frame, plans, jobs, FFmpeg installation, audio and video preview. Send to and sessions remain. It is the
canonical template for the other tool pages. The approval is the one recorded upstream; this integration does not add
a new visual approval.

- **Spec:** [converter.md](features/converter.md).
- **Native evidence:** `crates/halation-app/src/converter.rs` (controller and jobs),
  `ui/pages/converter.slint` (page), `catalog.rs:33-40` (available) and `navigation.rs:2-35` (page). Core media logic
  and its tests are in `crates/halation-core/src/convert.rs`, `components.rs`, `playback.rs` and
  `crates/halation-core/tests/`.
- **Tauri origin:** `main:app/dist/convert.js`, `convert.html`, `convert.css`; backend
  `main:app/src-tauri/src/convert.rs` (probe, planning, image/PDF paths) and `encode.rs` (FFmpeg plans), component
  install in `tools.rs`.
- **Components:** FFmpeg (140 MB), Pandoc (40 MB), LibreOffice (360 MB), PDFium (4 MB); all optional in the Tauri
  registry, with images usable without FFmpeg (`modules.js:23`).
- **Reference behaviour:** content-based detection, curated input → output table, copy-before-re-encode, fixed
  defaults per format, batch groups, document/PDF v2 paths, `.part` files and cancellation.
- **Gaps:** Send to and sessions; the document/PDF v2 paths (Pandoc, LibreOffice, PDFium); HEIC input. The media
  conversion, previews and FFmpeg installation are native. Documents remain out of scope for this pass.
- **Verified 2026-10-23 on this branch:** `cargo test --workspace` passed 136 tests with the already-installed FFmpeg
  pair on `PATH`, including the 12 media planner/encoder tests in `crates/halation-core/tests/converter.rs`, the six
  real-FFmpeg playback tests in `crates/halation-core/tests/playback.rs`, the controller batch test and the Converter
  bounds test in `crates/halation-app/tests/ui_layout.rs`. The explicit example
  `cargo run -p halation-core --example verify_converter -- <isolated-directory>` passed with generated media:
  content detection, packet-preserving MP4 remux, six audio outputs, WebM/MOV/GIF, audio extraction, real progress and
  cancellation with no output or `.part` file. It reused the FFmpeg pair already installed in the app profile, so this
  pass did not repeat the component download/install. `cargo fmt --check`, strict Clippy
  (`cargo clippy --workspace --all-targets -- -D warnings`), `python tools/check-docs.py` and `git diff --check`
  also passed.
- **Still unverified here:** no new native-window review was run (the approval is the upstream one); the WASAPI path
  was not heard on a real device; Windows timings were not re-measured (the performance note is from the Linux
  container).

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

1. **Tool pages and controllers.** Converter has a page and a Rust controller; the other nine need both, with UI state
   in Rust services, not in a Slint page instance.
2. **Engine lifecycle.** Converter installs and locates FFmpeg; the other nine have a static component list and no
   install, validation or engine status.
3. **Job submission.** Converter submits media and component jobs; the other nine do not submit work, report progress,
   cancel or record an output.
4. **Save/export integration.** Converter uses the destination policy; the other nine still need to call it and record
   exports in the Library/session.
5. **Visual implementation.** The shared contract is fixed above, but the nine pages are not built. Each one must use
   Converter's template and is "implemented, pending visual review" until Java approves it in the native window; a
   page with a tool-specific style is not done.
6. **Licences stay with the component.** yt-dlp is Unlicense, FFmpeg is GPL-3.0, upscayl-ncnn and the
   Upscayl-published models are AGPL-3.0, SPAN's runner is AGPL-3.0 (its models keep the upstream licences), and the
   "Sharp" model is CC BY-NC-SA 4.0 (results non-commercial). If Halation ever mirrors a build instead of downloading
   it from upstream, the corresponding source and notices are required. See
   [THIRD_PARTY.md](../THIRD_PARTY.md) and the licence sections of the specs.

## Sources

- Native on this branch: `crates/halation-app/src/catalog.rs`, `app.rs`, `navigation.rs`, `converter.rs`;
  `crates/halation-app/ui/app.slint`, `ui/pages/converter.slint`, `ui/pages/home.slint`,
  `ui/pages/settings.slint`; `crates/halation-app/tests/services.rs`, `tests/ui_layout.rs`;
  `crates/halation-core/src/{convert,components,playback}.rs` and `crates/halation-core/tests/{converter,playback}.rs`;
  `crates/halation-core/examples/verify_converter.rs`.
- Design: [planning/active/ui-redesign.md](../planning/active/ui-redesign.md),
  [features/material.md](features/material.md), [features/themes.md](features/themes.md),
  [features/motion.md](features/motion.md). `docs/MOTION.md` is the Tauri document.
- Tauri on `main`: `app/dist/modules.js`, the ten tool pages and modules, `app/src-tauri/src/{tools,download,convert,
  encode,stems,interp,framegrab,cutout,presets}.rs`.
- Existing specs linked above; new specs written in this change for Downloader, Audio Visualizer, Upscale and Frame
  Capture.
