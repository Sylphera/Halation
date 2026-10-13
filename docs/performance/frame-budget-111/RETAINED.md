# Retained media and real jobs — ongoing validation

Product decisions: animated Auralis 320 px / 15 Hz, cheap stationary blue-noise at 50%. Historical no-grain, static and low-frequency variants are experimental controls, not product defaults.

## Qualified native results before bounded progress motion

`native-retained-final50-verified-focus` progressively loaded nine media tools plus an unsubmitted Downloader URL draft. Fixtures: 2048² PNG, 720p30 VP9 video, 12 s mono WAV. All qualified intervals retained native focus. Grade, Frame Grab, Cover Test, Converter and Visualizer had no sustained GL draws or application rAF while hidden. This does **not** establish zero Canvas 2D activity: the earlier probe did not count event-driven 2D drawing.

Vocal Remover automatically started separation and Background Remover prepared its model. Therefore the final part of that run is **not** a no-jobs baseline. Its raw job states are retained. Initial file injection also used Playwright's WebView payload fallback, which reconstructs files from base64 on the UI thread; cold-load timings from that protocol are not a clean estimate of native file-picker cost.

`native-followup-loaded-realjobs` reused the same verified loaded inputs, after automatic work completed or the owned separation fixture was cancelled:

| Scenario | Owned GPU 3D | Layouts / 10 s | p95 opportunity | Maximum gap | Long tasks |
|---|---:|---:|---:|---:|---:|
| Ten retained inputs, no active jobs | 0.494% | 2 | 7.2 ms | 7.5 ms | 0 |
| Three real FFmpeg encodes, Processes closed | 0.397% | 14 | 7.1 ms | 7.4 ms | 0 |
| Processes open | 5.983% | 22 | 7.1 ms | 7.4 ms | 0 |
| Navigation during encodes | 5.035% | 105 | 7.1 ms | 27.9 ms | 0 |
| Owned encodes cancelled | 0.386% | 2 | 7.2 ms | 7.5 ms | 0 |

Navigation includes the action and its settle interval, rather than exactly ten seconds. Frame opportunities are not presented FPS. Three FFmpeg processes encode 720p30 with x264 fast, two threads each, real-time paced input and null output; the harness checks running state before/after and cancels its own jobs in cleanup. Processes-open progress interpolation is attributed separately in `PROCESS-UI.md`.

## GPU memory ownership

The follow-up retained approximately 1.35 GiB summed dedicated process memory. A PDH sample attributed **991 MiB to the native Tauri PID**, versus approximately **377 MiB to the WebView GPU PID**. Do not label the entire sum as hidden WebGL texture memory. Windows per-process surface accounting can overlap.

`stems.rs` retains its ONNX `Engine` in a static mutex after separation. This is a strong measured hibernation candidate independent of the job scheduler. A safe release must avoid interrupting inference, dropping a model on the UI thread, or repeatedly introducing cold model initialization during a batch. No backend cache-release change is validated yet.

## Cold loading

The harness now uses `DOM.setFileInputFiles` for native retained inputs, with the same HTML change handler as the local picker. `native-retained-native-input-profiles` removes the base64 reconstruction from the CPU profile. Grade still exhibits a real approximately 29 ms image upload and cumulative LUT/readback/shader-initialization cost. Frame Grab still exhibits approximately 153 ms maximum gap and two approximately 50 ms `fetch` blocks; their callers require stack-level attribution before changing product code. Existing profiles are preserved. New profiling runs save the complete sampled call tree as a separate JSON artifact.

## Fresh after protocol

From the repository root, using the existing Windows helper:

```powershell
$env:HAL_PERF_RETAINED_NO_AUTORUN='1'
$env:HAL_PERF_RETAINED_JOBS='1'
& .tools/performance111.ps1 benchmark native-retained-bounded-realjobs
```

Use a new label for each execution and keep Preview focused throughout qualified intervals. The no-autorun switch changes **only benchmark-served assets**, preventing automatic separation/speculative embedding while retaining files; it is recorded in metadata. Real FFmpeg work then runs against all ten loaded tools. This control does not replace the earlier real automatic-processing run. Normal product autorun behavior remains unchanged.

## Fresh bounded-progress result

`native-retained-bounded-realjobs` completed with no page errors and qualified native focus throughout. It uses native file inputs and the recorded no-autorun control above; the native process did not load/retain the separation model. Consequently memory and cold-load measurements must not be presented as a pure progress-motion before/after. The ten-input / three-encode interaction scenario is the same workload class as the preceding follow-up.

| Scenario | Owned GPU 3D | Layouts | Style recalculations | p95 opportunity | Maximum gap | Long tasks |
|---|---:|---:|---:|---:|---:|---:|
| Ten retained inputs, no jobs | 0.355% | 0 | 0 | 7.2 ms | 7.6 ms | 0 |
| Three encodes, Processes closed | 0.491% | 12 | 66 | 7.1 ms | 7.3 ms | 0 |
| Processes open | 0.256% | 19 | 25 | 7.1 ms | 7.4 ms | 0 |
| Navigation during encodes | 3.865% | 100 | 649 | 7.1 ms | 20.8 ms | 0 |
| Owned encodes cancelled | 0.269% | 0 | 0 | 7.2 ms | 8.3 ms | 0 |

Steady intervals are ten seconds. Three encodes are confirmed running at both endpoints of each active interval. Closed/open GPU differences below half a percentage point are noise/clock-sensitive, not proof that opening Processes saves GPU. The substantial result is the removal of the earlier approximately six-percent sustained open-panel cost, consistent with the isolated instant-bar experiment. Dedicated process sum before jobs is 351 MiB and RAM working-set sum 558 MiB, versus the prior model-warmed approximately 1.35 GiB dedicated sum; no production model-cache hibernation was implemented to obtain this difference. Compact provenance and metrics: `retained-bounded-summary.json`.

Cold loading still has gaps: Grade approximately 90 ms, Frame Grab 153 ms, Converter 76 ms, Visualizer 160 ms, Background Remover 250 ms and Interpolate 160 ms in this run. Subsequent visible/hidden steady intervals are smooth. These are unresolved load-path costs, not a completed 60 FPS acceptance claim.

## Hidden Vocal Remover follow-up

`stems-lifecycle.js` reproduced 40 waveform redraws from 20 progress events while hidden. The product change coalesces hidden queue/status/waveform presentation until return, keeps progress and peaks precise, suspends the player AudioContext on departure and defers result-file reads/decoding until visible. Already-started decode cannot be cancelled; its stale result is discarded, and subsequent original-track reads are skipped. The focal test verifies zero hidden waveform draws/mutations, no hidden result reads, exact latest progress and lazy decode/reuse on return. The normal auto-separation and auto-export behavior is preserved.

Memory cycles, cold-load fixes, native primary regressions and manual review of changed progress/tool lifecycle remain pending.

## Frame Grab transfer attribution and measured fix

`native-retained-framegrab-stack-profile` saved a complete CPU call tree. The two dominant `fetch` blocks are Tauri `sendIpcMessage`, called by `services.js:copyIn` (53.4 ms sampled self time) and `sessions.js:ref` / `session_file_put` (51.9 ms). This is redundant renderer-to-backend transfer of the same browser video: FFmpeg needs a temporary disk copy, while session capture uploads the Blob again before that copy is ready. Maximum frame gap was 159.8 ms.

`framegrab.js:sessionVideo` now awaits/references the existing disk-copy promise. Backend `session_file_reference` persists workspace media, preserving the file independently of temporary cleanup. If the copy fails while browser decoding remains usable, capture retains its Blob fallback and propagates session-storage errors. `framegrab-session.cjs` covers those paths, including replacement during an outstanding capture.

The native experiment `native-retained-framegrab-reused-copy-512kb` also reduced `copyIn` chunks from 8 MiB to 512 KiB **only through benchmark asset instrumentation**. Its qualified load interval had p95 7.1 ms, maximum **14 ms**, **no long tasks**, and no session-upload block. The remaining roughly 52 ms cumulative IPC fetch cost is distributed across separate smaller requests, not one continuous block. Visible/hidden steady intervals remain quiet. This result justifies adopting 512 KiB in production `services.js`.

The production-path repeat `native-retained-framegrab-product-copy` passed with whole-interval focus, p95 **7.1 ms**, maximum **14.1 ms**, no long tasks and no page errors. It also verified all **4,538,574 bytes** of the persisted Sessions `.media` video against the source SHA-256. Subsequent visible/hidden intervals had max 8.1/8.0 ms and no recurring GL/2D drawing. The session helper, `session.js --functional`, coordinator runtime and `sessions-media.js` pass; the latter fixture explicitly initializes the current global native-picker preference/path, retaining all round-trip, save-error, cancel and missing-source assertions.

Reproduce the before-size control with `HAL_PERF_COPY_KB=8192` and the measured variant with `512` (benchmark only). Set `HAL_PERF_RETAINED_TOOLS=framegrab`, `HAL_PERF_PROFILE=1`, then use a fresh `native-retained-*` output label. Leave `HAL_PERF_COPY_KB` unset for product-path verification. No export pixels, video bytes, processing settings or session format were changed.

## Test limitations

The focal Stems lifecycle check, Jobs, Processes, render-budget, tool-transitions, Grade runtime, 42 baseline LUT hashes, session coordinator runtime and `session.js --functional` pass. The broad `stems.js --functional` runner is stale at its per-tool destination dialog: it expects `st.destAsk` / `opts.destAsked`, while both HEAD and the working implementation use the superseding global `SAVE_LOCATION_SPEC.md` contract and delete those old options. This is recorded as an existing test/spec mismatch; the old UI was not restored and the assertions were not weakened. A Windows-only local launcher shim is also needed because that mock installs FFmpeg PE bytes without `.exe`; its normal initial selection/waveform checks pass once the identical executable bytes are launched with an extension.

## Final state

See [FINAL.md](FINAL.md) for closure, the qualified final native suite, resource-cycle evidence and known nonblocking debt. Earlier open investigation notes here are historical.
