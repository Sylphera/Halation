# Tool follow-up — 2026-10-12

The user approved the integrated static-logo Preview before these changes. Auralis remains animated at 320 px / 15 Hz with stationary grain at 50%. No exports or job scheduling policy are changed.

## Grade: measured work removed from the UI thread

Native OS-backed input, same 2048² PNG, profiled load interval; all three load intervals retained focus. Frame timings measure rAF opportunities, not presented frames.

| Version | Load p95 | p99 | Maximum gap | Long tasks |
|---|---:|---:|---:|---:|
| Existing optimizations, synchronous readback | 20.9 ms | 41.7 ms | 55.4 ms | 0 |
| WebGL2 pixel-pack buffer / fence | 14.0 ms | 20.8 ms | 41.7 ms | 0 |
| Same readback + LUT worker | 7.1 ms | 7.2 ms | 41.7 ms | 0 |

Raw labels: native-retained-grade-decoding-baseline, native-retained-grade-async-readback, native-retained-grade-worker-readback. Complete CPU sample trees, native PDH intervals and code hashes are preserved beside each result. See tool-followup-summary.json.

The synchronous readPixels cost was approximately 96 ms cumulatively across thumbnails in the baseline. A single outstanding pixel-pack buffer and GPU fence now defer retrieval until completion; zero-timeout polling never waits for GPU completion. Hidden state deletes the fence/buffer, releases the target and returns the interrupted thumbnail to the queue. Source/key checks reject stale pixels. The pool has at most one outstanding readback.

The LUT worker uses shared pure colour math (grade-color.js), one request at a time and transferable bytes. Hidden/idle closes it. A failed worker falls back to the existing synchronous LUT path. Export remains the original full-resolution path. Both the synchronous colour evaluator and worker buildLUT bytes match all 42 original edf8a82 hashes. Grade runtime renders/exports all 18 effects at original dimensions. grade-thumbnails.js checks interruption, resume, source replacement and complete fence/buffer/worker cleanup.

The separate HTMLImageElement.decode experiment was rejected: it did not reduce the approximately 30 ms texImage2D sample cost. Its raw native-retained-grade-decoding-prepared result is retained as an experiment. The remaining approximately 42 ms source-upload gap is unresolved; the steady visible/hidden tool remains at p95 7.2 ms, zero recurring draws/layouts.

## Grade resource cycles

A five-resize regression, after waiting for every look thumbnail, reproduced retained targets for old preview sizes: 40→41→42→43→44→45 live textures, still 45 after returning to the original size. fitPreview now purges only idle targets of mismatched dimensions; busy readback/export targets remain protected. The same sequence stays at 40 throughout.

The same test with a text layer exposed a separate cache keyed by layer ID and every old output size: 43→48. Text cache entries now record exact owning layer and dimensions; cleanup retains active preview and 160² thumbnail sizes. The same five cycles remain at 43, including return to the initial viewport. No source/LUT or export resolution is reduced.

Test: grade-resources.js. The benchmark-only HAL_GRADE_LEGACY_POOL=1 route restores the old pool policy in the served asset for reproduction; it intentionally fails the ordinary bounded-resource assertion. Normal production has no bypass. No visual captures or pixel comparisons are used.

## Cover Test source URL leak

A regression test reproduced one original-image Object URL left alive per removal: five cycles gave [1,2,3,4,5] from a zero baseline. Derived crop URLs were already revoked. removeCover now also revokes img.__url. The same five cycles now give [0,0,0,0,0]. Test: covertest-resources.js. No visible behavior change. The broad covertest.js test is not passing: several existing layout expectations fail and the run later stops at a null offsetWidth selector (line 291); its assertions were not changed.

## Native suspension

native-product-suspend-staticlogo-verified completed both qualified intervals. Minimized and unfocused: zero Auralis draws, zero layouts/style recalculations, approximately 0.5% of one CPU core (not system-wide CPU). This clears the earlier interrupted-minimization measurement, whose artifacts remain excluded. Probe sampling was stopped for the hardware idle intervals.

## Vocal Remover native cache

Implementation under native validation: expire the cached ONNX engine after 30 seconds of inactivity using one parked condition-variable thread. A usage generation invalidates old deadlines; try_lock refuses active inference. The engine is taken under its mutex and destroyed outside it. Returning to another song within the idle interval reuses the existing cache. Logical queue/results/audio files remain intact. This is independent of the job scheduler.

cargo check passes. cargo test --features preview: 66 passed, 3 ignored, including stale-generation/active-lock/nonblocking cache expiration. Strict clippy fails on two preexisting chunks_exact-to-as_chunks lints in convert.rs:149 and stems.rs:735 with the current toolchain; no allow or relaxed invocation was added. The first native cache run proved a private-memory drop (1598→430 MiB), but its GPU sample was invalid for late DirectML instances. This exposed a sampler issue: a continuous wildcard PDH query retains its startup instance set. performance-gpu.ps1 now reopens the query each interval, uses the second primed rate sample, records the actual first→second timestamps, and discovers later GPU PIDs/engines. Existing Auralis/Grade measurements use the preexisting WebView GPU PID and are unaffected by this specific omission; measurements involving newly GPU-active backend/child PIDs require rechecking. The first corrected run now identifies 991.1875 MiB on the native PID while warm. The corrected run completed: native dedicated GPU memory 991.1875 MiB→explicit 0 bytes, owned-tree dedicated sum 1107.2→107.5 MiB, private bytes 1554→459.8 MiB, no long tasks. Warm interval had only one qualified PDH sample and expired had three; the harness now measures a 12 s warm interval for a stronger repeat. Raw label: native-retained-stems-cache-dynamic-pdh. The longer native-retained-stems-cache-qualified-repeat confirms 991.1875 MiB→explicit zero on the native PID; dedicated process sum 1108.09→107.48 MiB, private bytes 1578.45→480.44 MiB. Warm has four qualified PDH intervals (4.055 s), final focused expired repeat has three (3.035 s); the first expired interval lost focus and is excluded. Both accepted intervals have p95 7.2 ms, maximum 7.5 ms and no long tasks. The 12 s HQ4 real GPU separation completed successfully and its two output files remain present.

## Repeat commands

From repository root on this Windows host, with the existing local helper:

~~~powershell
$env:HAL_PERF_RETAINED_TOOLS='grade'
$env:HAL_PERF_RETAINED_NO_AUTORUN='1'
$env:HAL_PERF_PROFILE='1'
& .tools/performance111.ps1 benchmark native-retained-grade-worker-repeat
& .tools/performance111.ps1 test grade-thumbnails
& .tools/performance111.ps1 test grade-runtime
& .tools/performance111.ps1 test covertest-resources
& .tools/performance111.ps1 test sessions-media
& .tools/performance111.ps1 benchmark native-product-suspend-repeat
$env:HAL_PERF_RETAINED_TOOLS='stems'
$env:HAL_PERF_RETAINED_NO_AUTORUN='0'
$env:HAL_PERF_STEMS_CACHE='1'
& .tools/performance111.ps1 benchmark native-retained-stems-cache-repeat
~~~

No automated visual captures were generated. The new asynchronous thumbnail presentation is implemented and functionally tested; it still requires manual review in the rebuilt native Preview. This is not completion of the full performance task.

## Full native runtime repeat

native-runtime-tools-verified-suspension completed all 29 primary scenarios, including original non-multitask checks, real media, three simultaneous real FFmpeg jobs, CPU throttling, and the final 5 s sample after 180 s soak. Focused normal intervals retained native focus. Home hardware-idle owned engine-0/3D mean 1.541% (7 primed PDH intervals, 7.09 s coverage); empty tool 0.104%; ten open empty tools with one visible 0.136%. Both whole-interval qualified suspension samples report explicit zero owned GPU and zero Auralis draws/layouts.

Grade load p95 7.1 ms/max 34.6 ms, no long task. Frame Grab load max 55.6 ms without a reported long task: earlier 14.1 ms result is not a guarantee of every cold load. Three real encodes with retained inputs: p95 7.1 ms/max 13.9 ms, GPU 1.926%; navigation during those jobs max 14.1 ms/GPU 3.982%.

The ten-loaded-media Home interval is **not accepted as stutter-free**: p95 7.1 ms but max 326.3 ms, four long tasks (51/265/217/331 ms), 0 layouts. Long-task owner is unknown in the shared main realm. Its GPU mean is 2.513%; hidden tools have zero recurring rAF/draws/2D paints. Isolated Background Remover with actual model preparation did not reproduce this hidden spike (max 13.7 ms); its image load did expose an 82 ms task including two getImageData calls (~55 ms combined). Attribution of the combined-load spike is ongoing; it is not assumed to be Auralis or solely model inference. CPU-4x control also retains max 83.4/131.9 ms gaps and is not acceptance on low-end hardware.

Compact primary data: native-runtime-tools-summary.json; raw data/GPU intervals remain preserved. Missing GPU intervals (Converter samples too short for the reopened/primed query) are missing, not zero. rAF timings describe opportunities rather than confirmed presented FPS.

The focused combined-load CPU-profile repeat native-runtime-loaded-attribution reproduces max 319.3 ms and long tasks of 181/327 ms. Its main-realm samples are predominantly native/program work and GC (127 ms sampled GC), without a dominant application JavaScript function. This does not establish which subsystem causes the native stall. Isolated RemoveBG is insufficient to reproduce it; further native/GC tracing and controlled model-preparation ablation are required.

## Converter idle audio graph

The primary native inventory exposed an AudioContext still running in hidden Converter, even with no active playback. convert-lifecycle.js reproduced the idle-state failure. Converter now suspends the graph before decode, when paused/hidden and at natural playback completion; Play resumes it without replacing the decoded buffer or changing the playback position. The focal test passes idle, hidden, replay, natural completion and replacement/closed-context checks. Native confirmation remains pending.

## Cutout native model IPC attribution and bounded transfer

Controlled loaded-only repeats keep the same ten tools/media and product backgrounds. native-runtime-cutout-prep-off-smoke suppresses only speculative RemoveBG embedding in benchmark-served code: focused max 14 ms/no long tasks/Home GPU 1.628%. With preparation enabled, native-runtime-cutout-prep-on-smoke reproduces max 291.5 ms and 169/295 ms long tasks. The detailed native trace identifies an EmbeddedBrowser Mojo message with 277,384,168 bytes and a 295.6 ms renderer-main data-pipe callback. Worker WASM compilation also appears, but the large IPC receipt is concrete main-thread contention independent of job scheduling.

Production now reads model assets through read_path_chunk, authorized by the existing inside_base rule and capped at 512 KiB. Each response transfers directly to the Cutout worker with acknowledgement; only that worker assembles wasm/decoder/encoder buffers. No model, inference, mask or export math changes. Existing whole-file read_path behavior remains unchanged for other consumers. Worker staging checks order/completion, discards staged parts after adoption and supports retry. Rust chunk/EOF round-trip and worker byte identity/cleanup/error tests pass. Native after measurement is pending.

Current Rust: 67 passed, 3 ignored; strict clippy still reports only the two documented unchanged chunks_exact lints. Full removebg --functional passes selection, model idle restoration, brush/wand, undo/redo, full-resolution PNG/WebP/mask, crop and send-to checks after initializing the current global save-mode fixture. Its unconditional 1px visual captures were discovered on the first run and are now confined to non-functional visual mode; that visual check remains pending manual review. All assertions are retained for explicit visual runs. Sessions-media passes again after the worker protocol change. Converter lifecycle passes including a delayed resume after navigation; full Converter runner is blocked in preflight by its Unix command -v pandoc invocation on Windows.

## Qualified Cutout before/after — 2026-10-12

The aligned native controls reproduce the original transfer bottleneck: whole-model IPC gives a 270.9 ms shell frame gap and a 276 ms long task with ten real media retained. Production 512 KiB transfer gives max 7.5 ms and no long tasks in the same 10 s scenario. Both have p95 7.1 ms and zero layouts. Actual model completion is also covered: max 27.9→7.8 ms, no long tasks in either completion interval. All three real WASM encoder feature tensors are byte-identical by SHA-256 between controls. See cutout-model-transfer-comparison.json and both native-runtime-cutout-*-aligned-smoke raw reports.

Owned Radeon engine-0/3D is 1.379% versus 1.378% in the ten-media interval (3 primed samples/~3.05 s coverage each); this fix removes main-thread IPC stalls, not continuous GPU work. Completion GPU varies 2.312% versus 1.430%; these are sequential runs, so no causal GPU/memory reduction is claimed. Worker assembly still temporarily duplicates model bytes inside the worker. Native Converter inventories now confirm its idle/hidden AudioContext is suspended.

Measurement correction: shell rAF windows now begin AFTER baseline profiler/metrics/process CDP queries, immediately before the timed action. A 270 ms profiler/query task in the first chunked run occurred before the actual scenario and was erroneously included by the old baseline timestamp. That raw run is preserved; aligned whole and chunked controls use the corrected boundary. GPU samples still require wholly contained primed intervals. CPU/metrics deltas conservatively include baseline-query overhead.

Repeat on this host (root helper changes cwd; absolute paths shown):

~~~powershell
$env:HAL_PERF_PROFILE='1'
$env:HAL_PERF_LOADED_ONLY='1'
$env:HAL_PERF_NO_CUTOUT_PREP='0'
$env:HAL_PERF_MODEL_WHOLE='1'
& ./.tools/performance111.ps1 benchmark native-runtime-cutout-whole-aligned-repeat-smoke
# In a fresh shell for production transfer:
$env:HAL_PERF_PROFILE='1'
$env:HAL_PERF_LOADED_ONLY='1'
$env:HAL_PERF_NO_CUTOUT_PREP='0'
$env:HAL_PERF_MODEL_WHOLE='0'
& ./.tools/performance111.ps1 benchmark native-runtime-cutout-chunked-aligned-repeat-smoke
# Primary suite, fresh shell: no loaded-only / model-whole overrides
$env:HAL_PERF_PROFILE='1'
& ./.tools/performance111.ps1 benchmark native-runtime-tools-chunked-regression
~~~

Cold Grade/Frame Grab load and CPU-4x gaps remain unresolved. The primary suite is being repeated with the current transfer and Converter lifecycle; its original scenarios have not been removed.

## Cutout teardown cleanup

A focal test against the actual service transport reproduced one callback retained after stopping its worker. stop now clears the idle deadline and rejects/releases pending calls; completion callbacks from a stopped engine cannot arm a timer for a replacement engine. Late model reads fail the existing worker identity guard before sending bytes. cutout-transport.cjs passes these checks, alongside cutout-model-chunks.cjs byte/ordering/staging checks. This internal cleanup was added after the primary benchmark assets had loaded; its runtime integration requires the following rebuild/test.

Primary native repeat native-runtime-tools-chunked-regression completed 29 scenarios with no page/harness errors. Hardware idle Home owned 3D 1.542%; ten retained media Home 1.398%, max 7.4 ms/no long tasks/zero layouts; three real FFmpeg jobs 1.418%, max 7.3 ms/no long tasks. All ten hidden tools show zero recurring rAF/GL/2D work in the retained steady interval. Unfocused/minimized whole-interval qualified samples show explicit zero owned GPU and zero Auralis draws. Soak final 5 s sample after 180 s wait: max 7.4 ms/no long tasks, GPU 1.690%. Cold Grade max 55.5 ms (source texImage2D 29.7 ms); Frame Grab 41.8 ms; loaded navigation 34.8 ms; CPU-4x Home/navigation max 104.1/145.9 ms remain unresolved. See native-runtime-tools-chunked-summary.json.

cutout.js functional initially failed export because its fixture left the current global save location undecided. Its fixture now explicitly selects Halation folder, matching sessions-media/removebg fixtures; export/path/pixel assertions remain unchanged. Repeat pending.

cutout.js --functional now passes its full unchanged crop/export/transparency/Visualizer assertions after initializing the current save-location fixture. First bitmap upload control (native-retained-grade-bitmap-upload-experiment) lowers source texImage2D from ~30 ms to 10 ms, but createImageBitmap itself samples 18.4 ms on main and load max remains 55.5 ms; not adopted. A worker preparation control is measured separately.

## Closure decision

The source ImageBitmap worker variant is rejected on end-to-end evidence (46.2→73.1 ms to first preview, gap 48.7→34.8 ms). Fidelity/lifecycle passed but latency worsens. Candidate code is archived outside production dist. No further source strategy is attempted for 1.1.1. Cutout functional retest passes. The authoritative final state, qualified metrics, tests and deferred work are in [FINAL.md](FINAL.md); earlier pending/investigation notes above are historical.

Final closure: 30 primary scenarios, no execution/page errors; all normal acceptance intervals qualified. Focus was lost during the final CPU-4x navigation and primary soak; those are not focused evidence. The same-instance retained-media focused soak repeat passes (20 s, GPU1.584%, p957.2/max7.7 ms, zero layouts/long tasks). Clean native Grade thumbnail presentation explicitly approved by the user. Performance work for 1.1.1 is complete.
