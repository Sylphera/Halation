# UI performance pass — 2026-10-04

Base: `8ee177fe0a6fd794999464d536b5844d913578fb`. Branch: `task/ui-performance`. No merge or release.

## Method

Same machine and verified 1.0.1 portable (SHA-256 `b92d0b8c29b0101528ef5accb9e6f715ce705de4fce5502505469f828246f943`), WebView2 154.0.4258.53. Historical or working-tree JavaScript was served through local CDP routes; the native backend was unchanged. This validates the frontend against the real backend, not a newly packaged executable.

Synthetic inputs: 2400×1600 PNG, 640×360 / 24 fps / 4 s H.264 video, and 320×213 PNG for a real 4× Upscayl job. FFmpeg and RIFE jobs ran natively. Model/cache state was warm. Session storage was cleared at startup; recovery from earlier benchmark work was discarded. The first baseline was saved before edits; these archived comparison runs repeat the final controlled protocol, including waiting for the last slider selection and resetting Grade's persisted state.

[initial-baseline.json](initial-baseline.json) preserves the original run before runtime edits. Use the matched baseline/optimized archives below for the final comparison; the protocol was subsequently tightened to remove persisted Grade-state differences and to include full Frame Capture export.

Run a disposable native window with remote debugging on localhost:9237, then `node app/scripts/ui-benchmark.cjs baseline --allow-reset` with `HAL_PERF_REVISION=8ee177fe0a6fd794999464d536b5844d913578fb`; unset the variable and run `node app/scripts/ui-benchmark.cjs optimized --allow-reset`. Playwright must be available in the workspace or .tools; FFmpeg can be supplied with FFMPEG. Do not use a window containing user work. Results go to .tools/ui-performance-<label>.json. No screenshots/video are generated.

Metrics are external harness counters, PerformanceObserver long tasks and CDP Performance metrics. rAF callbacks are not presented FPS. First visual latency is a visible DOM mutation followed by rAF, not a pixel/presentation assertion. Heap numbers exclude native decoded-media storage and VRAM; object URL counts and replacement tests provide separate retention evidence. Layout/style counts and canvas calls measure CPU work; compositor repaint area was not captured. Windows compositor/IPC scheduling produces variable peaks; single-run differences in unchanged tools are not claimed as optimizations. Menu and navigation action times include scripted waits. Job windows include approximately 10 s, with jobs confirmed active at all three navigation points, but jobs may finish during the trailing measurement interval.

## Retained changes

- Background Remover: same selection/refinement math in one local worker, one in-flight request, latest settings coalesced, source/probability/paint buffers reused. Selection bitmap is composed in the worker. Apply, flush and manual Session capture await the latest result. Worker resources/buffers are released/reset on replacement/unload; synchronous fallback remains. Automatic, wand, brush, feather and shift masks compare byte-for-byte with the existing canvas algorithm.
- Background Remover: reused committed brush alpha/history and tint canvases, coalesced overlay redraws without dropping stroke points; removed per-pixel neighbor-array allocation; skipped edge-cleanup work only when no pixel could be changed by it. Detection reuses the already decoded original.
- Grade: lazy cached shader programs with basic preview passes warmed after the first UI render; identical shader/pass math and full-resolution exports. Replacing or failing to decode media releases its Object URL.
- Shared shadows: batch native-style/geometry reads before writing shadow planes. Shadow shaders, dither, geometry formulas, colors and resolution remain unchanged; no CSS/design changes.
- Upscale: original temporary-file preparation and image decoding run concurrently. The input is committed and Run enabled only after both succeed. Original bytes/path, crop, job and Session behavior remain unchanged; failure revokes the newly created URL.

Sessions coordinator, autosave/recovery semantics, public Session format, i18n, Title Intro and product structure were not changed. No instrumentation/bypass was added to shipped runtime.

## Before / after

| Case | Action ms before → after | Shell rAF/s before → after | Max gap ms before → after | Long tasks before → after |
|---|---:|---:|---:|---:|
| shell.open.removebg | 209 → 196 | 101.7 → 104.0 | 48.4 → 41.7 | 0 → 0 |
| shell.open.interp | 256 → 256 | 115.6 → 117.5 | 34.8 → 34.8 | 0 → 0 |
| shell.open.grade | 479 → 329 | 84.3 → 97.1 | 215.3 → 76.4 | 1 → 0 |
| shell.open.framegrab | 264 → 237 | 117.1 → 118.2 | 41.7 → 41.6 | 0 → 0 |
| shell.open.upscale | 158 → 134 | 114.6 → 116.0 | 34.6 → 34.8 | 0 → 0 |
| shell.switch | 208 → 200 | 98.7 → 99.9 | 41.8 → 48.6 | 0 → 0 |
| shell.menus | 471 → 493 | 117.2 → 122.6 | 14.0 → 14.2 | 0 → 0 |
| removebg.load.detect | 825 → 635 | 86.7 → 95.1 | 180.6 → 173.5 | 2 → 1 |
| removebg.sliders | 4750 → 549 | 33.0 → 136.6 | 118.1 → 20.8 | 0 → 0 |
| removebg.brush.erase | 2809 → 2160 | 115.9 → 135.2 | 180.4 → 180.6 | 1 → 0 |
| interp.load | 716 → 695 | 99.7 → 97.9 | 194.5 → 222.3 | 0 → 0 |
| interp.parameters | 133 → 120 | 144.0 → 143.6 | 7.4 → 7.2 | 0 → 0 |
| interp.job.navigation | 1664 → 1631 | 128.3 → 131.6 | 55.5 → 48.6 | 0 → 0 |
| grade.load | 414 → 405 | 28.1 → 22.2 | 125.1 → 152.8 | 1 → 1 |
| grade.layers.sliders | 814 → 834 | 111.8 → 108.6 | 20.8 → 27.9 | 0 → 0 |
| grade.crop.overlay | 669 → 676 | 118.2 → 119.6 | 34.7 → 27.6 | 0 → 0 |
| grade.replace.media | 2779 → 2688 | 38.8 → 41.6 | 111.3 → 104.3 | 0 → 0 |
| framegrab.load | 712 → 634 | 108.0 → 107.9 | 83.2 → 76.3 | 0 → 0 |
| framegrab.scrub | 831 → 832 | 143.9 → 143.9 | 7.4 → 7.2 | 0 → 0 |
| framegrab.capture | 46 → 44 | 144.0 → 144.2 | 7.2 → 7.2 | 0 → 0 |
| framegrab.thumbnails | 3 → 3 | 143.7 → 143.8 | 7.2 → 7.2 | 0 → 0 |
| framegrab.export.capture | 214 → 189 | 142.4 → 143.8 | 20.9 → 7.3 | 0 → 0 |
| upscale.load | 405 → 372 | 89.7 → 89.6 | 76.2 → 62.4 | 0 → 0 |
| upscale.prepare | 2 → 2 | 143.1 → 143.2 | 14.0 → 14.0 | 0 → 0 |
| upscale.job.navigation | 1311 → 1282 | 129.9 → 130.6 | 55.6 → 55.6 | 0 → 0 |

| Case | First visual DOM mutation + rAF ms before → after | Readiness + rAF ms before → after |
|---|---:|---:|
| removebg.load.detect | 87.5 → 73.6 | 792.0 → 608.0 |
| interp.load | 77.0 → 71.3 | 640.4 → 626.1 |
| grade.load | 67.3 → 97.3 | 382.7 → 378.8 |
| framegrab.load | 44.4 → 40.8 | 640.8 → 562.6 |
| upscale.load | 279.7 → 260.3 | 377.9 → 345.5 |

The complete per-realm IPC/status frequencies, synchronous handlers, canvas calls, layout/style durations and heap samples are in [baseline.json](baseline.json) and [optimized.json](optimized.json). Background Remover brush pointermove handlers totaled 478.1 ms before and 15.0 ms after for the same 275 callbacks. Grade replacement retained six Object URLs before and one after. The worker keeps bounded current-image buffers, not an unbounded cache.

## Validation

Test maintenance preserved the assertions: Cutout obtains crop parameters from the current Grade adapter instead of obsolete localStorage; Upscale awaits the crop dimensions announced by the dialog before checking navigation/export. Functional flags suppress screenshots only. Upscale additionally verifies concurrent decode, failed-file cleanup, unchanged Session input, exact ×2/×4 output dimensions, pixel/edge fidelity, queue cleanup and Send to Grade.

Passed: removebg --functional (selection/undo/redo, rapid edits followed by Save, crop, full-size PNG/WebP/mask alpha); grade-runtime (lazy programs, five replacements, failed decode cleanup, all 18 effects rendered/exported at original size); cutout --functional (cache, edge/brush restore, rotated GPU crop matches the original pixels, shared Cutout in Grade/Visualizer/Intro); Sessions runtime/system/media/autosave; Jobs; localization; scan --localization; changed-file syntax and git diff whitespace checks. Upscale --functional and Sessions media were repeated after the concurrent-load change.

Native recovery validation passed with real recovery JSON/binary references after restarting the WebView without normal close, exact restored typed buffers, dirty close Cancel, Discard and clean close; no permanent Session was created. The native instance was reloaded with production source and all benchmark probes absent. No Rust files changed; Cargo/Clippy and a new packaging build were not run. The full repository suite was not run.

## Discarded experiments / remaining limits

- Pausing Grade's thumbnail queue during gestures and drawing one thumbnail per frame: slider sequence 1299 vs 1319 ms, no material improvement; reverted. A separate thumbnail worker would add substantial rendering/font architecture for little measured benefit here.
- No progress throttling added: real native jobs used only about 0.4–0.6 set_progress IPC/s; DOM status mutations were about 19–22/s. Frame Capture already coalesces scrub requests and the tested sequence had roughly 7 ms maximum gaps. No tool-by-tool framework or polling replacement was introduced.
- No blur/shadow aesthetic reduction, preview/export resolution reduction, approximation of masks, or lowering of export quality retained. Media decode/GPU upload and initial analysis still have load peaks around 160–200 ms in this workload; this pass does not establish zero freezes for arbitrary large files or every effect stack.
- One WebView renderer crash occurred on root reload after repeated benchmarking/profiling, before the experimental tool code executed. Its dump records 0x80000003 in msedge.dll; there was no diagnostic CHECK text and no proven root cause. That run was invalidated. The WebView recovered, subsequent complete runs and native recovery tests passed. No product change was made to conceal it.
