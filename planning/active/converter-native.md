# Native Converter

Status: Implemented, pending visual review — Java selected the complete media Converter (2026-10-22). No visual approval yet.

## Scope and boundaries

- Port the media backend, not the Tauri interface. Documents/PDF remain outside this delivery.
- Use the approved tool frame: Files, preview canvas, Output inspector and one top-bar Convert action.
- Rust owns inputs, plans, jobs, progress, destinations and component installation. Slint presents that state.
- Keep Library removed and Activity as the existing small top button. Do not start migration or updater work.
- Home memory is accepted; no further decoder experiment is part of this task.
- Components and previews load only on demand. FFmpeg stays an external program; image decode has explicit limits.

## Evidence path

One implementation owner verifies these distinct claims:

1. Content detection and curated plans: synthetic stream/encoder tables, misleading extensions and generated images.
2. Execution: generated local media through real FFmpeg; inspect output codecs and copied packet hashes.
3. Safety: cancelled queued/running jobs, partial cleanup, colliding names, failed encoding and original preservation.
4. Integration: controller tests for input/format/job state across navigation; existing Settings/navigation tests.
5. Presentation: headless bounds at supported sizes, then Java's review in the real native window.

Required fmt, clippy, workspace tests and docs checks remain gates. A release build is deferred until Java orders it.
No copyrighted media fixtures, desktop automation, cloud processing or idle polling.

## Implementation checkpoint (2026-10-22)

Implemented, not visually approved:

- Media content probe, curated image/audio/video plans, codec filtering cached by path/mtime, stream copy before
  transcode, text-subtitle handling and consequence notes. HEIC and document engines stay excluded.
- Shared native-task scheduling, duration-based FFmpeg progress, cancellation/shutdown and process-tree ownership.
  Image export and preview jobs reserve the light lane so those scheduled decodes never overlap each other.
  Probing uses its own sequential finite worker; peak overlap with probing remains a performance-validation item.
- Image formats in Rust (including alpha-to-white JPEG, lossy/lossless WebP, EXIF orientation, ICC where supported,
  16-bit LZW TIFF and bounded ICO canvases). FFmpeg handles audio/video and AVIF input.
- Native Files/canvas/Output page, lazy previews, folder batches with relative paths, common group targets, retry,
  panel shortcuts, top-bar primary action, progress strip, Settings component status and explicit FFmpeg installation.
- Shared destination choice, isolated managed exports, native manual Save dialog, successful-location persistence,
  no-clobber publication and explicitly confirmed manual replacement. Original-path checks remain unconditional.
  Folder walks stop at 4096 entries / 256 inputs and report the limit rather than silently walking indefinitely.

Evidence already collected:

- Generated-media integration example: actual component download/install; H.264/AAC MKV → MP4 with identical encoded
  video packet hash; MP3/M4A/FLAC/OGG/Opus/AIFF, WebM/MOV/GIF and audio extraction; real encoder progress and
  cancellation without output/partial files. Repeated successfully after the Windows publication change.
- Controller test: 12 inputs, one broken; 11 outputs, original inputs retained, state survives page recreation.
- Image tests: JPEG white background, EXIF orientation 6, alpha WebP, all curated image outputs, LZW/16-bit TIFF,
  refused collisions and confirmed manual replacement.
- Headless frame tests cover four supported sizes and both sidebar/files-panel states. An offscreen capture exposed
  implicit centering of the Files panel; explicit anchors and a position assertion now prevent that regression.
- Final checkpoint checks: `cargo test --workspace --no-fail-fast` (121 passed),
  `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, `python tools/check-docs.py`, and
  `cargo run -p halation-core --example verify_converter -- <isolated-evidence-directory>` passed. Default feature
  graphs show winit/Skia/OpenGL without Qt/FemtoVG/software renderer. Registry metadata confirms the new dependencies'
  MIT/Apache/BSD-compatible licensing. Headless controller tests still emit asset-default lookup warnings in the test
  executable directory; the actual offscreen capture resolves the real assets. No release build was run.

## Completion (2026-10-22, second pass)

Implemented, pending Java's visual review in the native window:

- Audio preview: FFmpeg decodes (a separate process, like every conversion) and `halation-core::playback` plays through
  shared-mode WASAPI (stereo `f32` at the device rate, Windows converts the layout). The canvas shows a 480-column
  vector waveform computed in the preview job (centre-line skeleton until it arrives), the heard part in the accent,
  a head, play/pause, `m:ss` clock, click or drag to seek (the seek happens on release), arrow keys ±5 s and Space.
  Pause and seek end the decoder; a 33 ms timer runs only while playing. Leaving the page, another file or closing
  stops playback. No audio device: playback ends with a message. Without FFmpeg the player is not offered (audio
  needs FFmpeg to convert anyway). There is no 80 MB limit: decoding streams instead of loading the file.
- Spec parity: "Recommended" badge on the first output, video's audio-only outputs under an "Audio only" caption,
  each output's description plus its consequence line (§4.5), durations as `m:ss`, finished rows with the size before
  and after.
- Performance: [research/performance/2026-10-22-converter-native.md](../../research/performance/2026-10-22-converter-native.md)
  (copy 1.8 % of re-encoding; UI thread ≤ 4.8 ms per update during a 256-file batch, asserted under 50 ms).

Evidence: `tests/playback.rs` (real FFmpeg: waveform silence/tone, real-time playback after a seek, immediate stop,
file without audio); controller test (player state, seek while paused, pause, ±5 s, leaving the page); WASAPI code
type-checked against `x86_64-pc-windows-msvc`; offscreen capture `converter-audio`.

Round 1 of Java's review (2026-10-22): "can close files, needs audio controls, video preview with controls, bottom
bar misaligned". Implemented, pending a new visual review:

- Files rows carry a × that takes the file off the list (never off the disk); a file converting or queued keeps it.
- Transport for audio and video: −5 s, play/pause, +5 s, clock, mute and a volume slider (mute restores the level).
- Video player: `Player::start_media` runs one FFmpeg for the sound and one for RGBA frames scaled to fit 1280 × 720
  (never enlarged, at most 30 fps); frames follow the sound clock, or the wall clock for a silent video, and late
  frames are skipped. Two frame buffers are reused; the 33 ms timer uploads the newest one. Paused, a seek shows the
  still at the head (a preview job). Cost while playing: two decoder processes and about 3.5 MB per frame upload at
  1280 × 720; nothing at rest.
- Footers of the canvas and inspector share one 64 px height; "Save location" and the source line align.
- Each row's removable check no longer scans the job list per row (it had pushed batch updates to 70–260 ms).

Evidence added: `tests/playback.rs` (video frames in real time with and without sound, picture fit); controller test
(video: still after a paused seek, mute/restore, frames while playing, removal); offscreen capture `converter-video`.

Still open, not claimed: Send to / sessions while the other tools are unported, Windows timings and the WASAPI path
heard on a real device (Java's PC).

## Sources

- `docs/features/converter.md`, `save-location.md`, `jobs.md` and `planning/active/ui-redesign.md` §9.
- Tauri backend on `origin/main`: `convert.rs` media probe/table/plan/image logic; `tools.rs` FFmpeg lookup/install;
  `download.rs` streaming download and selected ZIP extraction. Adapt behind native interfaces, with tests.
- No Tauri visual source consulted or imported for this feature.
