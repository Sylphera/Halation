# Frame Capture — Specification

Status: Partial. The native UI was implemented on `slint/tools-all` (2026-10-23), pending Java's visual review; the
`slint/frame-quality` backend adds in-process decode, early audio errors, persistent results and measured resource
bounds. Its 8K60 performance target was not met on the reference PC. The viewer, timeline, playback, sharpness,
layouts/crop, queue, Library/Image capture and session work. Back/Send and the result
Crop/Cutout/Send actions remain unavailable because the native app has no tool-origin or image-tool plumbing; they are
shown as unavailable, not as dead controls. See §11 for the implementation record and the stated limits.

UI contract: the native page follows the [shared tool-page contract](../TOOLS_STATUS.md#visual-contract-all-ten-tools): the approved Linear/Figma redesign, the same components, tokens, surfaces, typography and native motion, with Converter as the template. No tool-specific visual style.

Frame Capture opens a video, shows an exact frame, and exports one or more frames as full-size PNGs, optionally cut
to a layout. It is a viewer first: timeline, keyframe strip, frame stepping, playback with sound and a sharpest-frame
finder. This spec records the behaviour verified in the Tauri app so the native app can reproduce it without copying
that app's HTML, CSS or JavaScript. Destinations follow [the global save & export policy](save-location.md).

## 0. Principles

1. **Exact frames, not preview frames.** The picture on screen is convenient; the capture is always decoded at the
   video's native size. A crop is applied to that native frame.
2. **The video is never loaded whole.** Reads are ranged; decoded frames are cached around the playhead within a
   fixed budget.
3. **Fast while scrubbing, exact when resting.** Fast drags may show keyframes; stopping settles on the exact frame.
4. **The frame index is the contract.** Times are derived from the frame rate for display only; captures use the
   frame index so no rounding drift appears.
5. **Nothing is implicit.** Layout, crop, destination and queue selection are visible; a capture uses those values
   at the moment it is taken.
6. **Rust owns decoding and files; Slint presents.** The native viewer does not hold media state in a page instance.
7. **Clean-room viewer.** The Tauri timeline, crop overlay and queue are behaviour references, not templates.

## 1. Inputs and access

- A video from the Library, a linked Library folder, the file picker, another tool ("Send to Frame Capture") or a
  drop. The Tauri picker accepts MP4, M4V, MOV, WebM and MKV (`main:app/src-tauri/src/framegrab.rs:62-69`).
- The backend only reads a file inside the Halation folder, inside a linked Library folder, or one explicitly chosen
  in the picker; anything else is rejected (`framegrab.rs:49-60`).
- The content key is FNV-1a over the size and three 64 KiB samples (start, middle, end), so the same video copied
  elsewhere reuses its cache (`framegrab.rs:29-46`). The key selects the workspace's `frames` area; cache entries
  obey the Storage budget.
- Reads are capped at 16 MiB per request (`framegrab.rs:23,91-103`). The native implementation must keep a bounded
  read path; it must not allocate the whole file.

The Tauri page decodes with Mediabunny from byte ranges and falls back to FFmpeg for videos it cannot decode
(`main:app/dist/services.js` `frameAt`, keyframe index). The native app cannot use that JavaScript library; it needs
an in-process decoder or an FFmpeg-backed frame service with the same externally visible behaviour.

## 2. Viewer and state

State (`main:app/dist/framegrab.js:18-31`):

```
video: { path, name, info: { w, h, fps, duration, frames }, size, key, pw, ph, eng }
n: current frame index (0-based)
playing, keys, strip, kp, queue, settled, req, dest, layout, crops, results, audio,
sound: { volume: 0.8, muted: false }
```

- `n` is clamped to `0…frames-1`. `time = n / fps` is shown as `mm:ss.cc` (or `h:mm:ss.cc`), while captures keep
  `n`.
- The preview is capped at 1920 px wide (`PREVIEW = 1920`) and decoded frames are cached at preview size around the
  playhead under a byte budget; the farthest frame is dropped first (`framegrab.js:61-65`). After
  the playhead is quiet the decoder is released (`QUIET = 1500` ms) and leaving the page forgets the decoded frames.
- The keyframe index and strip are prepared once per video and cached by content key. Videos the page cannot decode
  use keyframe pictures at preview size so the timeline still works; the fallback still extracts exact frames.
- The transport shows time and `frame n of N`. Sound defaults to **80 % volume, unmuted**; volume/mute persist.

## 3. Timeline and navigation

- The timeline contains the keyframe strip, ticks for queued frames and a playhead. Dragging anywhere scrubs:
  fast movement shows keyframes, slower movement shows exact frames, and releasing (or resting) settles on the exact
  frame under the pointer (`framegrab.js:729-760`).
- Keyboard (when focus is not in a text field):
  - `←` / `→`: one frame; `Shift` + arrow: one second (rounded to `max(1, round(fps))` frames).
  - `Home` / `End`: first / last frame.
  - `Space`: play/pause.
  - `M`: add the current frame to the queue (already queued: select it again).
  - `S`: find the sharpest frame nearby.
- Playback uses the video's sound when the decoder can play it; the picture and audio share a clock, and playback
  stops when the frame changes manually. The transport exposes play/pause, seek, volume and mute.
- The sharpest-frame search checks the **±12 frames** around the current one (`SHARP_R = 12`), computes the variance
  of the Laplacian of luma on a **360 px**-wide copy (`SHARP_W = 360`), and shows the highest-scoring frame without
  changing the current position permanently (`framegrab.js:499-539`).

## 4. Layouts and crop

- Layouts: **16:9 (default)**, **9:16**, **1:1**, **4:5**, and **Original** (the whole frame)
  (`framegrab.js:607`).
- For a layout whose ratio differs from the video, the largest exact-ratio crop is centred initially. It is stored
  as fractions of the video so it survives scrubbing and view resizing.
- The crop frame is dragged with the pointer; arrow keys move it by 1 % of the video (Shift: 10 %). Each video keeps
  one crop per layout for the session, so switching back restores the framing (`framegrab.js:609-670`).
- If the video already has the layout's shape, there is no crop frame and the whole frame is used.
- A capture is decoded at the native size, then cut with the crop. It is never upscaled from the preview and never
  uses a screenshot of the viewer (`framegrab.js:678-685`).

## 5. Queue and export

- The queue holds at most **8 frames** (`QMAX = 8`), in time order, each with a thumbnail, selection state and
  remove action. Select all/none are available; a queued frame can be clicked to jump to it.
- Adding a frame selects it. Adding the same frame again only selects it; it does not duplicate it.
- With nothing selected, export is disabled; the button text says so.
- Destinations (`framegrab.js:798-834`):
  - **Back to `<tool>`** — only when Frame Capture was opened from another tool. A single-frame request (for
    example a video layer) returns the frame shown; otherwise the selected frames are returned. Cancelling the
    origin clears the request.
  - **Send to…** — another tool that accepts images; only the first selected frame is sent.
  - **Library** — saved in `Library\Frames`.
  - **Image** — a loose PNG through the global save policy (Tauri default `Exports\Frames`).
- Output is always PNG. The stem is the video's file stem and the name is `{stem} - frame {n+1}.png`
  (`framegrab.js:882-925`). No JPEG/WebP option exists.
- The result list keeps the last **12** captures, newest first, each with **Crop**, **Cutout**, **Send to…** and
  **Show in folder**. Crop/Cutout save versions beside the capture through their own services; the Frame Capture
  result itself is not rewritten.

## 6. Session

- The session stores the video reference, `n`, sound, layout, non-null crops, destination and queue (`n`, `sel`).
  It does not store decoded pictures or results across restarts. Restoring loads the video and returns to the saved
  frame, then rebuilds the queue (`framegrab.js:1250-1264`).
- There are **no user presets** for this tool. The remembered layout/crop/destination are session state, not named
  presets.
- Leaving the page stops playback and releases decoded frames; the current frame stays on screen until the next
  move decodes again.

## 7. Native distribution (clean-room)

- **Slint:** video surface, transport, keyframe strip/timeline, crop overlay, layout selector, queue, destination
  selector, result list. New layout and interaction; do not translate the Tauri DOM.
- **Rust / core:** file authorization, content key and cache, keyframe index, exact-frame decode/extract, preview
  cache with a byte budget, crop math, queue/export state, file naming, destination calls, session persistence.
  Decoding runs on worker threads; Slint receives frames through the event loop, never by mutating models from a
  worker. Stale frame requests are dropped by generation; a closed video cancels its work.
- **Decoder:** an in-process decoder is preferred for scrubbing. FFmpeg remains the reference for exact capture and
  the fallback for undecodable files. Frame stepping must not spawn one FFmpeg process per frame at interactive
  speed; if FFmpeg is the only decoder, the design must still meet the scrub/step requirements or state the
  limitation before implementation.
- **Cache:** bounded by bytes, not by an unbounded map; clearing it on leaving the page is required. The disk cache
  lives under the workspace and respects its Storage budget.
- **Jobs:** analysing the video (keyframes/strip) is a background CPU job; capture is a short user job. Both are
  cancellable and finite.

## 8. Acceptance criteria

1. A 23.976/29.97 fps video opens; the displayed frame count and last frame match the decoder; stepping by one frame
   never skips or repeats because of time rounding.
2. A drag across the timeline shows keyframes while fast and an exact frame after release; no stale frame overwrites
   a newer request.
3. Playback with sound starts at the current frame, stays in sync and stops on a manual frame change.
4. `S` picks the frame with the highest Laplacian variance within ±12 frames on a synthetic sharpness fixture.
5. Each layout produces the largest exact-ratio crop; dragging and arrow keys move it; switching layout and back
   restores the per-video framing.
6. A capture from a 4K source into 16:9 is a native-resolution crop (for example 3840×2160 → 3840×2160 when the
   source is already 16:9, or the correct cut size otherwise), never a 1920-wide preview upscale.
7. The queue caps at 8, selects/deselects, removes, and exports the selected frames in time order with the
   `{stem} - frame {n+1}.png` name.
8. Back/Send/Library/Image each do what §5 says; Back is absent when there is no origin; Send sends one frame.
9. Cancelling or closing a video removes temporary files and stops decode/analysis work; the cache stays within its
   byte budget.
10. The UI remains responsive during scrubbing, analysis and export; the UI thread never decodes a full-resolution
    frame or reads a whole video.
11. A video the in-process decoder cannot open still offers the keyframe preview and exact FFmpeg capture with a
    clear indication of the fallback.

## 9. Out of scope

- Video editing, trimming, frame-rate conversion, interpolation, grading, stabilisation or audio export.
- Animated GIF/WebP export, contact sheets, batch capture across several videos, or subtitle extraction.
- Capture from DRM-protected streams, network URLs or files outside the allowed roots.
- Copying the Tauri Frame Capture viewer's markup, CSS, canvas compositing or keyboard help text.

## 10. Open questions

These three were resolved by the native implementation; see §11.

1. Which in-process decoder the native app uses for scrubbing (the Tauri page uses Mediabunny, a JavaScript
   library); the choice must be validated on long videos and odd codecs before the page is built.
2. Whether the native player can reuse the existing video preview service or needs its own audio clock; the
   behavioural requirement is A/V sync and stop-on-step.
3. Whether the workspace cache key stays FNV-1a + three samples or moves to a stronger hash; the visible behaviour
   (same video copied elsewhere reuses its cache) must stay.

## 11. Native implementation (2026-10-23)

Status: native viewer is implemented on `slint/tools-all`, pending Java's visual review. Backend quality changes on
`slint/frame-quality` add Media Foundation decoding, bounded 8K-safe batches, early playback errors, persistent capture
history and synthetic performance diagnostics; the visual layer is intentionally unchanged. Per-point acceptance
evidence is in [TOOLS_STATUS.md](../TOOLS_STATUS.md#frame-capture).

- **Decoder.** On Windows, Rust `frame_decoder` uses Media Foundation Source Reader in-process, requests hardware
  transforms, converts NV12 samples to RGBA and maps sample timestamps through the probed rational rate. Rotation,
  variable-rate, HDR/BT.2020 and non-8-bit/non-4:2:0 formats stay on FFmpeg to preserve frame/color handling;
  unsupported or incomplete Media Foundation windows also fall back to FFmpeg. Exact captures use native-sized decode
  and PNG output, never the preview. `DecodeBackend` and controller `decoder_backend()` expose which implementation
  completed the preview for a later status binding. The system enumerated a hardware-flagged H.264 MFT named
  `Microsoft H264 Video Decoder MFT`; registration does not prove each stream was GPU-decoded. FFmpeg/ffprobe remain
  external profile components for probing, keyframes and fallback.
- **Timeline and cache.** Fast movement shows the nearest keyframe; slow movement follows exact frames. A 160 ms quiet
  interval while the pointer remains held settles on the exact current frame, and release settles exactly at once.
  The one-shot debounce is restarted on movement (no polling); decoded windows and preview cache are reused, with
  request generations dropping stale work. The preview LRU is bounded at 96 MiB, a transient preview batch at 48 MiB,
  and a single full-resolution still at 160 MiB (enough for 8K RGBA); over-budget batches fail before decoding. The
  cache drops the farthest frame first.
- **Playback.** Reuses `halation_core::playback::Player::start_media` (shared-mode WASAPI; picture at most 1280 × 720
  and 30 fps). Picture playback waits for the audio sink and decoder to become ready. Output initialization/decode
  failure stops both paths and is exposed immediately; audio-bearing files are not presented as successful silent
  playback. WASAPI was not heard on a physical device in this backend test.
- **Layouts and crop.** Five layouts, the largest exact-ratio crop, one crop per layout for the session, pointer drag
  and arrow keys (1 %, Shift 10 %). Captures apply the crop at native resolution.
- **Queue and capture.** Eight frames in time order, select/remove/all/none/clear, PNG only,
  `{stem} - frame {n+1}.png`. Library writes `Library\Frames`; Image goes through the global save policy (base
  `Exports\Frames`, asking when no location is remembered). The result list keeps the last 12 with Show in folder.
- **Session/results.** `profile/frame-capture.json` stores the video reference, picked flag, frame, volume/mute, layout,
  crops, destination and queue. `profile/frame-capture-results.json` atomically stores the newest 12 result paths and
  display metadata; startup prunes missing PNGs and never removes a PNG. Results survive controller/app recreation.
  Decoded pictures are not persisted. Leaving the page stops playback, clears the cache and workspace and flushes the
  session.
- **Not implemented.** Back/Send need a native tool-origin/request channel that does not exist; the result
  Crop/Cutout/Send actions need those image tools. The page shows a note instead of dead controls.
- **Known limitations.** On the i5-12400F / RX 6650 XT (4 GiB), the release synthetic H.264 preview diagnostic did not
  meet 60 fps: Media Foundation produced 30.7 fps at 1080p, 17.3 fps at 4K and 9.7 fps at 8K; the FFmpeg software CLI
  baseline produced 51.8, 27.4 and 11.0 fps respectively. Media Foundation's working-set increase was lower
  (134.8/221.8/720.2 MiB) than the FFmpeg child peak (180.7/405.7/1369.9 MiB), but neither path reached 8K60. The
  hardware-flagged generic Microsoft H.264 MFT was registered; this test cannot prove it used the RX GPU for each
  stream. Instrumentation measured the MFT `ReadSample` stage at 21/80/184 ms and NV12→RGBA CPU conversion at
  124/153/152 ms for the six-frame batches; the rest is Source Reader startup/seek and controller-independent
  overhead. At 8K the full batch took 616.5 ms and added 720 MiB to the app process working set. These short
  `testsrc2`, 30-frame synthetic clips are not a guarantee for
  every codec or long GOP. Fast drags still show keyframes until a 160 ms pause or release; visual review pending.
  Back/Send and result Crop/Cutout/Send require future integration with tool-origin and image-tool
  services; these dependencies are absent, so their controls remain unavailable rather than simulated.
- **Evidence.** Core tests include generated FFmpeg windows/captures, Media Foundation frame-index/color/crop/
  cancellation/rational-rate/rotation checks on Windows, bounded preview/capture budgets and the release 1080p/4K/8K
  diagnostic. Controller tests verify generated-video session behavior, restart-persistent results and missing-PNG
  pruning, plus scrub settle/release and stale generations. Existing 4K coverage proves a
  1920 × 1080 preview and a 3840 × 2160 capture; the NTSC test proves 24000/1001 with 24 frames and last frame 23.
  Audio failure is covered by an injected sink failure (not a physical device). The target machine enumerated the
  hardware H.264 MFT but the active per-stream hardware route was not identified. Visual review remains pending.
- **Still unverified.** Visual review in the native window; a real WASAPI device; the manual Image dialog;
  picker/drag-and-drop interaction; pointer-drag automation; per-stream confirmation that Media Foundation used the
  GPU rather than software; long-GOP and broad codec coverage; all-codec 8K60.

## Sources

- Native: `crates/halation-core/src/framegrab.rs`, `crates/halation-app/src/framegrab.rs`,
  `crates/halation-app/ui/pages/framegrab.slint`, `crates/halation-app/ui/components/media.slint`,
  `crates/halation-app/src/strings.rs`, `crates/halation-app/locales/en.json`,
  `crates/halation-app/tests/ui_layout.rs`, `crates/halation-app/tests/services.rs`.
- Tauri: `main:app/dist/framegrab.js`, `framegrab.html`, `framegrab.css`; `main:app/src-tauri/src/framegrab.rs`;
  `main:app/dist/services.js` (`frameAt`, keyframe index, preview frames). Behaviour only; no visual source copied.
- Verified lines: `framegrab.js:18-31,61-65,499-539,607-670,729-760,798-834,879-935,1250-1264`;
  `framegrab.rs:23-24,28-60,97-108`.
- Shared rules: [save-location.md](save-location.md), [library.md](library.md),
  [AGENTS.md](../../AGENTS.md) (threads, weak callbacks, bounded work).
