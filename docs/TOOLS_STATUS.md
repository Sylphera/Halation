# Tools status — native line

Status: FASE 1, tool 1 of 9 — Frame Capture implemented natively on `slint/tools-all` (2026-10-23), pending Java's
visual review. Converter and Frame Capture are `parcial`; Frame Capture UI follows the Figma tool frame in §9.
The viewer, timeline,
playback, sharpness, layouts/crop, queue, Library/Image capture and session work; Back/Send and the result
Crop/Cutout/Send actions have no native plumbing and are not presented as controls. The other eight media tools are still
catalog entries only, with no native page, controller or connected engine, and none is available in the beta.

This document says what each of the ten media tools has in the native app today, which spec owns its behaviour and
where the Tauri app on `main` implements it. It is an inventory, not a promise: a tool is not "ported" because it
appears in a list or because its name compiles into the catalog. The Tauri app is the behaviour reference; its
interface is not a template (see the clean-room rule in [AGENTS.md](../AGENTS.md)). The native visual authority is
the approved tool frame in §9 of [ui-redesign.md](../planning/active/ui-redesign.md), referenced by the Vocal Remover mockup.

## How to read the status

| Status | Meaning |
| --- | --- |
| `nada` | No trace in the native app. |
| `UI falsa` | A name, icon and card exist, but activating the tool opens nothing and runs nothing. This is an explicit placeholder, not a working imitation. |
| `parcial` | At least one real path works end to end in the native app (input, processing, output), even if incomplete. |
| `completa` | The spec is implemented in the native app and its acceptance criteria are verified. Visible changes still need Java's visual OK. |

Eight tools are **`UI falsa`**; Converter and Frame Capture are **`parcial`**. The
catalog is honest about the eight: the activation notice says the tool is not available in the beta and that the
processing engines are not connected (`crates/halation-app/src/catalog.rs`). Converter's native page and the approval
recorded upstream are in [converter.md](features/converter.md); Frame Capture's native page and its evidence are in
[frame-capture.md](features/frame-capture.md).

## Visual contract (all ten tools)

Java, 2026-10-23: finish all ten media tools for visual review, with one interface, not ten. Every native tool page
uses the approved Linear/Figma redesign in [ui-redesign.md §9](../planning/active/ui-redesign.md#9-screens): the same
frame, components, tokens, surfaces, typography and native motion, with the Vocal Remover mockup as the reference.
This §9 frame is the layout authority; Converter is not a substitute composition template.

- **Frame and components.** Use the shell (sidebar and top bar) and §9 tool frame: left panel 220 px, flexible canvas,
  inspector 280 px with tabs, docked bar 40 px and one primary action in the top bar. Reuse shared Slint components;
  do not substitute Converter's page composition for the Figma/Vocal Remover frame.
- **Material and type.** Use the current native material and type in [material.md](features/material.md); use the
  colours and state tokens in [themes.md](features/themes.md). No page-local palette, font, radius, shadow, border or
  spacing scale.
- **Motion.** Use the current native contract in [motion.md](features/motion.md): native Slint animation only, no idle
  animation, and 0 ms with reduced motion. [MOTION.md](MOTION.md) documents the Tauri/GSAP app; it is not the
  native reference.
- **Reference.** The Vocal Remover mockup in §9 of [ui-redesign.md](../planning/active/ui-redesign.md#9-screens) is the
  Figma tool-frame reference. A tool may add only the controls its function requires, built from shared components.
- **State and work.** UI state lives in Rust services, never in a page instance; heavy work runs off the UI thread.
  This is already the native rule and applies to every tool page.
- **Review gate.** A page is "implemented, pending visual review" until Java approves it in the real native window.
  Converter is already approved; the other nine must reach the same bar, and all ten are reviewed. No page is complete
  because it compiles or because its tests pass.

## Native baseline

On this integrated line, the catalog has eleven entries: the ten media tools plus Library
(`crates/halation-app/src/catalog.rs`). Converter, Frame Capture and Library are available and open their pages
(`catalog.rs`, `navigation.rs`, `ui/app.slint`); the eight other media tools are declared `available: false`. The rail,
Home strip and Settings > Tools all render that catalog. Activating an unavailable tool only sets a notice; it does not
navigate or create a page. Tests lock the unavailable eight: Downloader produces the notice
(`crates/halation-app/tests/services.rs`), while the rail still lists its name (`crates/halation-app/tests/ui_layout.rs`).

The same catalog lists thirteen downloadable components with approximate sizes (`catalog.rs`). Converter and Frame
Capture have an FFmpeg installation path and submit real jobs; the other eight cannot install a component or submit
work. There is no engine status, per-tool settings, preview, export or session state for those eight. The core queue,
process and engine contract exist ([jobs.md](features/jobs.md)); the global destination rules are used by Converter and
Frame Capture ([save-location.md](features/save-location.md)).

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
| Frame Capture | `frame-capture` | `framegrab` | `parcial` (native page implemented, pending visual review; Back/Send and result actions are global integration gaps) | [frame-capture.md](features/frame-capture.md) |

Converter and Frame Capture have native pages. Future tool pages follow the §9 Figma frame and the per-tool mappings
in [tools-ui.md](../planning/active/tools-ui.md); Converter's composition does not replace that authority.

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
- **Next-unit handoff (2026-10-23):** begin from [cover-test.md](features/cover-test.md) and use the Frame Capture
  page/controller as the working pattern, not the Tauri DOM. Reuse the page frame and spacing,
  `crates/halation-app/src/strings.rs` with `locales/en.json`, the controller job/inbox/generation structure (or the
  simpler Converter controller where no jobs are needed), the destination policy and the session-file pattern;
  `crates/halation-core/src/artist_profile.rs` already owns the profile and the cached platform feed. Cover Test has
  no FFmpeg component and no tool-origin/request plumbing: it needs image previews at the platforms' real sizes, the
  three local templates, cover positioning and PNG export. Back/Send stay unavailable until a native tool-origin
  channel exists. It is a visible page, so it will also be "implemented, pending visual review".

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

**Status: `parcial`.** The native viewer/controller is implemented on `slint/tools-all` (2026-10-23), pending Java's
visual review; UI polish is in `slint/frame-ui`. Backend quality work on `slint/frame-quality` adds in-process Media Foundation decode with FFmpeg
fallback, 8K-bounded transient batches, immediate audio-device failure, persistent last-12 capture history and
synthetic performance diagnostics. This UI unit applies `ui-redesign.md` §9 and `tools-ui.md`'s Frame Capture mapping:
top-bar `Capture n` / adjacent `Cancel`, queue pane, flexible canvas, docked transport/actions, and Capture/Output
inspector tabs. It also improves the empty/open state, preview sizing and inspector legibility. The only behavior change
is the documented direct-open destination default (Image); no decoder or pipeline was changed. Offscreen evidence
covers empty, loading, error, synthetic queue, crop-overlay and output-result states at 1440x900 and 960x600. Back/Send and result Crop/Cutout/Send remain global
integration gaps; this page does not simulate them.

- **Spec:** [frame-capture.md](features/frame-capture.md).
- **UI mapping:** [tools-ui.md §Frame Capture](../planning/active/tools-ui.md#frame-capture), imported unchanged from
  `slint/native` commit `9e5c53f`; it is Draft. Layout authority is the user-directed [ui-redesign.md §9](../planning/active/ui-redesign.md#9-screens), not the Converter composition.
- **Native evidence:** `crates/halation-core/src/framegrab.rs` (probe, authorization, content key, bounded window and
  exact decode, native PNG, keyframe index/strip, Laplacian sharpness, byte-bounded cache, queue, naming, session types);
  new `crates/halation-core/src/frame_decoder.rs` (Media Foundation Source Reader, NV12 color conversion, timestamp
  indexing, hardware-MFT enumeration and cancellation); `crates/halation-core/src/playback.rs` (audio readiness/error
  gate); `crates/halation-app/src/framegrab.rs` (controller, jobs, playback, destinations, result persistence/API);
  `ui/pages/framegrab.slint` and `ui/components/media.slint` (shared transport/scrubber); `locales/en.json` and
  `src/strings.rs` (every visible string); `ui/models.slint`, `ui/app.slint`, `src/app.rs`, `src/navigation.rs` and
  `src/catalog.rs`. Tests: 13 in `crates/halation-core/src/framegrab.rs` (generated FFmpeg/MF synthetic media plus a
  release performance diagnostic), three controller tests on generated media in `crates/halation-app/src/framegrab.rs`,
  the locale-catalog test, the page-bounds test in `tests/ui_layout.rs` and the catalog test in `tests/services.rs`.
- **Tauri origin:** `main:app/dist/framegrab.js`, `framegrab.html`, `framegrab.css`;
  `main:app/src-tauri/src/framegrab.rs` (content key, authorization, picker) and the shared `frameAt`/keyframe
  services in `main:app/dist/services.js`. These were read for behaviour only; no Tauri markup, CSS, canvas or
  JavaScript was copied. Mediabunny is not used; Windows preview uses Media Foundation, with FFmpeg/ffprobe as the
  exact/fallback path.
- **Components:** FFmpeg (140 MB), located in the profile and installable on demand from the page. The in-process path
  uses the Windows Media Foundation system APIs already exposed by the existing `windows` dependency; no new third-
  party decoder library or bundled codec was added.
- **Implemented:** picker and drop with the Library/root authorization check and MP4/M4V/MOV/WebM/MKV filters; rational
  fps probe and exact frame count; FNV content key; a Windows Media Foundation in-process preview decoder (H.264
  hardware transforms requested; falls back when unsupported, VFR/rotation/HDR/non-420); FFmpeg remains the exact
  fallback/capture decoder; byte-bounded 96 MiB cache and 48 MiB preview batches, single full-resolution frame cap
  160 MiB; keyframe index from packet flags and a 1920 px strip of at most 300 thumbnails; scrub,
  step, Home/End, Space, M and S shortcuts; playback through the native `Player` (picture capped at 1280 × 720 and
  30 fps, stops on a manual frame change); ±12-frame Laplacian search on a 360 px copy; five layouts with the largest
  exact-ratio crop, pointer drag and 1 %/10 % arrow moves, one crop per layout; queue of 8 in time order with
  thumbnails, selection, remove, select all/none and clear; native-resolution PNG capture with the crop, atomic
  publication and `{stem} - frame {n+1}.png` names; last 12 results with Open folder, persisted in
  `frame-capture-results.json` and pruned when PNGs disappear; progress, cancel, FFmpeg install and a JSON session
  (video, frame, sound, layout, crops, destination, queue).
- **Destinations:** Library writes to `Library\Frames`; Image resolves through the global save policy with base
  `Exports\Frames`, asking for a folder when no location has been chosen. Captures never replace the source video.
- **Layout contract:** §9's 220 px queue, flexible canvas, 280 px tabbed inspector, 40 px dock and top-bar primary action.
  Narrow widths collapse the queue/inspector in turn, preserving a usable canvas; observed at 960x600 and 1440x900.
- **Limits/performance evidence:** Back/Send and result Crop/Cutout/Send are not connected; results offer Open folder
  only. A hardware-flagged system H.264 MFT enumerates as `Microsoft H264 Video Decoder MFT`; enumeration does not
  prove that a stream actually used GPU decode. Release synthetic H.264 High `testsrc2` (30 frames, 60fps, measured
  six-frame 1920-wide batches) on i5-12400F/RX 6650 XT measured Media Foundation 30.7/17.3/9.7 fps at 1080p/4K/8K;
  plain FFmpeg CLI measured 51.8/27.4/11.0 fps. Working-set deltas: MF 134.8/221.8/720.2 MiB; FFmpeg child peak
  180.7/405.7/1369.9 MiB. The six-frame 8K batch took 616.5 ms; instrumentation attributed 184 ms to Source Reader
  `ReadSample` and 152 ms to CPU NV12→RGBA conversion, with remaining time in setup/seek and other pipeline work.
  Neither 8K path reaches 60fps, and active per-stream GPU utilization was not attributed. Not an all-codec
  guarantee. Audio readiness/failure is tested with an injected sink; no physical WASAPI listening test. Rotation, VFR,
  HDR/BT.2020 and non-8-bit/non-4:2:0 sources stay on FFmpeg. Back/Send and result tools need future integration; fast
  scrub and visual review remain as stated above.
- **Verified backend quality tests:** generated baseline-profile H.264 exercises Media Foundation exact indices, 8-bit
  color comparison against FFmpeg, native PNG output, rational 24000/1001 frame indices, rotation-metadata dimensions
  and cancellation; lossless/high-profile MKV controller fixtures verify explicit FFmpeg fallback. Controller test
  recreates the controller after two captures, sees the result rows again, then proves missing-PNG pruning. Cache
  budget tests cover 1080p/4K/8K and reject multi-frame 8K native batches before decode. The release synthetic profile
  command is `cargo test --release -p halation-core synthetic_decode_performance_diagnostic_1080p_4k_8k_at_60fps -- --nocapture --test-threads=1`.
- **Acceptance against §8:** points 1, 4, 5, 6, 7 and the cache/shutdown part of 9 are covered by tests; point 2 is
  implemented with generation guards and the stale-result test, but the pointer drag itself is not automated; point 3
  is covered for the clock and stop-on-step, not with sound heard on a device; point 8 is partial (Library/Image real,
  Back/Send absent); point 10 is met by construction (decode and file work stay in jobs, only indices and prepared
  images cross to the event loop) and throughput/RSS were measured, though 8K60 was not met; point 11 has an in-process
  decoder and exact FFmpeg fallback, with backend identity available to the controller, but a visible fallback indicator
  remains for the subsequent UI task.
- **Still unverified here:** Java's visual review in the native window; the WASAPI path heard on a real device; the
  manual Image save dialog; picker and drag/drop interaction; cancellation cleanup asserted separately; timings on a
  real 4K source (the 4K test checks correctness, not speed).

## Cross-cutting gaps

1. **Tool pages and controllers.** Converter and Frame Capture have a page and a Rust controller; the other eight need
   both, with UI state in Rust services, not in a Slint page instance.
2. **Engine lifecycle.** Converter and Frame Capture install and locate FFmpeg; the other eight have a static component
   list and no install, validation or engine status.
3. **Job submission.** Converter and Frame Capture submit media and component jobs; the other eight do not submit
   work, report progress, cancel or record an output.
4. **Save/export integration.** Converter and Frame Capture use the destination policy; the other eight still need to
   call it and record exports in the Library/session.
 5. **Visual implementation.** The shared §9 Figma tool frame is the authority; eight pages are not built. Each one
    applies that frame and is "implemented, pending visual review" until Java approves it in the native window; a
   page with a tool-specific style is not done. Frame Capture is built and waits for that review.
6. **Licences stay with the component.** yt-dlp is Unlicense, FFmpeg is GPL-3.0, upscayl-ncnn and the
   Upscayl-published models are AGPL-3.0, SPAN's runner is AGPL-3.0 (its models keep the upstream licences), and the
   "Sharp" model is CC BY-NC-SA 4.0 (results non-commercial). If Halation ever mirrors a build instead of downloading
   it from upstream, the corresponding source and notices are required. See
   [THIRD_PARTY.md](../THIRD_PARTY.md) and the licence sections of the specs.

## Sources

- Native on this branch: `crates/halation-app/src/catalog.rs`, `app.rs`, `navigation.rs`, `converter.rs`,
  `framegrab.rs`, `strings.rs`; `crates/halation-app/ui/app.slint`, `ui/pages/converter.slint`,
  `ui/pages/framegrab.slint`, `ui/components/media.slint`, `ui/components/controls.slint` (`Segmented`),
  `ui/pages/home.slint`, `ui/pages/settings.slint`;
  `crates/halation-app/locales/en.json`; `crates/halation-app/tests/services.rs`, `tests/ui_layout.rs`;
  `crates/halation-core/src/{convert,components,playback,framegrab}.rs` and
  `crates/halation-core/tests/{converter,playback}.rs`; `crates/halation-core/examples/verify_converter.rs`.
- Design: [planning/active/ui-redesign.md](../planning/active/ui-redesign.md) §9 and
  [planning/active/tools-ui.md](../planning/active/tools-ui.md) §Frame Capture (copied unchanged from `slint/native`
  commit `9e5c53f`; Draft),
  [features/material.md](features/material.md), [features/themes.md](features/themes.md),
  [features/motion.md](features/motion.md). `docs/MOTION.md` is the Tauri document.
- Tauri on `main`: `app/dist/modules.js`, the ten tool pages and modules, `app/src-tauri/src/{tools,download,convert,
  encode,stems,interp,framegrab,cutout,presets}.rs`.
- Existing specs linked above; new specs written in this change for Downloader, Audio Visualizer, Upscale and Frame
  Capture.
