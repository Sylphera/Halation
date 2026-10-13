# Halation 1.1.1 performance — closure record

## Closure status — 2026-10-12

The authoritative closure record is [FINAL.md](FINAL.md). The Grade source ImageBitmap worker experiment is rejected: first-preview latency 46.2→73.1 ms despite a smaller isolated gap. The final product build passes, focal regressions are recorded in final-tests.json/final-checks.json, and native-runtime-final-111 is the final primary repeat. No new optimization investigations are authorized after closure. The final 30-scenario native suite and same-instance focused soak repeat pass the agreed closure gates. The user explicitly approved the clean native Grade thumbnail Preview. **Performance work for 1.1.1 is complete.** Remaining notes below are history, not open work.

## Previous continuation — 2026-10-12

Latest independent fix: Cutout model IPC is bounded to 512 KiB and assembled only in its worker. Qualified native whole/chunked controls with ten real retained media: max shell gap 270.9→7.5 ms; 276 ms long task→none; all three actual encoder tensor SHA-256 hashes match. Completion interval max 27.9→7.8 ms. Converter now suspends its idle/hidden AudioContext including delayed resume races. Functional Cutout/Converter/session tests and Rust chunk round-trip pass. See TOOLS-FOLLOWUP.md and cutout-model-transfer-comparison.json. The full primary native repeat completed all 29 scenarios without execution/page errors: ten media max 7.4 ms/zero long tasks/zero layouts, three real FFmpeg jobs max 7.3 ms, and explicit zero owned GPU while unfocused/minimized; cold Grade/Frame Grab and CPU-throttled spikes remain open.

The user explicitly approved the integrated static-logo Preview and authorized continuing tool work. New follow-up changes: asynchronous Grade thumbnail readback and LUT worker (native load p95 20.9→7.1 ms; original 42 LUT hashes preserved), Cover Test original URL cleanup (five removals retain 5→0 URLs), and native Vocal Remover cache expiration after 30 seconds idle. The corrected dynamic PDH sampler identifies 991.1875 MiB on the native PID while warm and explicit zero after expiration; the longer qualified repeat confirms dedicated process sums 1108.09→107.48 MiB with 4/3 primed PDH intervals, p95 7.2 ms/max 7.5 ms and no long tasks. See TOOLS-FOLLOWUP.md. New thumbnail presentation still needs manual review; prior approval is preserved for the unchanged approved visuals.

Product decision: remove Home logo levitation completely. The CSS animation, motion token and Welcome pause/resume dependency are removed; finite navigation/Welcome transitions remain. Auralis stays at 320 px / 15 Hz with static grain at 50%. The earlier native home-decoration cadence experiment remains historical evidence, not a production frequency choice. Static-logo transition regression passes. Welcome handoff passes at 1480×940 and 960×640 with normal motion and at 1480×940 with reduced motion (geometry <0.01 px). The broad legacy motion test is not passing: it reports a navigation scale assertion and later times out looking for the removed Intro tab. Its assertions remain intact. Native Preview rebuilt after removal and left open for manual review. `native-home-decoration-static-logo-product.json` has a valid focused 10 s interval: owned-tree 3D 1.6233%, zero layouts/style recalculations, rAF-opportunity p95 7.2 ms/max 7.5 ms, no long tasks. Earlier normal animated-logo control was 5.3863% with 1445 style recalculations/10 s; this repeat uses a fresh disposable profile and is not a randomized paired trial. Auralis remains active at 15 Hz (302 GL draws = 151 two-pass updates in 10.05 s). Repeat: `$env:HAL_PERF_COMPONENT='home-decoration'; & ./.tools/performance111.ps1 benchmark native-home-decoration-static-logo-product` from repository root.

The sections below retain the investigation history; early “next steps” are not the current plan. Product Auralis is **animated, 320 px / 15 Hz, stationary cheap blue-noise at 50%**, visually selected by the user. Static and 4–8 Hz variants are rejected as product behavior. Legacy procedural grain remains removed.

Native PDH attribution, exact process-tree ownership and whole-interval focus validation are implemented. Cancelled dock motion no longer retains a 144 Hz geometry loop (paired native layouts 1447→0, GPU 4.046→1.273%). Genuinely queued waiting jobs stabilize at zero process paints/layouts. Open Processes with real encoding work exposed a separate progress-interpolation cost (5.978% versus 0.481% instant-bar control). The bounded 30 Hz/subpixel progress implementation passed the fresh ten-input / three-real-encode run: open-panel GPU 0.256%, p95 7.1 ms, max 7.4 ms, no long tasks. This was a model-cold repeat, not an identical VRAM state; see `PROCESS-UI.md` and `RETAINED.md` for qualified evidence and limitations.

Hidden Stems waveform/decode work is now deferred until return (focal regression: 40 hidden redraws→0). Frame Grab's duplicate session upload and 8 MiB IPC copy were attributed and fixed; native production load max 159.8→14.1 ms, no long tasks, persisted video SHA-256 preserved. Jobs, Processes, lifecycle, transitions, Grade runtime, LUT hashes and session/media round-trip checks pass. The legacy full Stems test still expects a removed per-tool save dialog and is recorded as stale, not passing.

Remaining work includes Grade and other cold media-loading spikes, native cached model GPU memory, resource cycling, final primary native regressions and manual review of visible progress/tool lifecycle changes. The fresh Preview build compiled successfully. No claim of overall completion or approval of unreviewed visual changes.

## Earlier investigation log

Base edf8a82; branch task/performance-111. No merge, release or push.
Existing runtime changes are retained: bounded decorative scheduler, Auralis lifecycle/style-read removal, static Atmosphere, hidden Converter/Visualizer/Grade work suspension, framing observers, process/progress repaint reduction, native minimized signal.

## Evidence status

- before.json: headed hardware Chromium, mocked backend; final trace exceeded Node string limit. Diagnostic, not final acceptance.
- after-background-smoke.json: partial early implementation; not current after result.
- native-before.json: real Rust/media fixture run, but native minimize/window control was invalid. Do not cite its minimized result as evidence. Copy preserved in root .tools/performance111-artifacts/native-before-window-invalid.json.
- Grade runtime and initial render-budget/Auralis functional tests passed; latest extensions require rerun.
- GPU counters previously absent. GPU Engine and GPU Process Memory are available on this Windows host (RX 6650 XT, driver 32.0.21045.5002).
- 2026-10-11 22:03 UTC diagnostic: PID 20796 (WebView2 GPU), parent 25052, native root 13072, benchmark profile performance-111: 3D ~33.3% in five samples. Disposable benchmark was blocked by a recovery modal. This identifies this instance, not the user's earlier Task Manager observation. Raw diagnostic is in root .tools/performance111-artifacts/gpu-current-diagnostic.jsonl.

## Current next steps

Validate GPU sampler/aggregation and benchmark-only ablations, fresh profile and visible/minimized window verification. Run same native GPU protocol with original assets and current assets, then choose measured resolution/shader changes. Preserve non-multitask and real media/multi-job tests. No export quality changes.

## GPU methodology

performance-gpu.ps1 verifies the root executable and creation timestamp, discovers descendants by parent PID + creation time, rejects PID reuse, and samples Windows PDH GPU Engine / GPU Process Memory / GPU Adapter Memory alongside CIM CPU/RAM. It runs outside the renderer, nominally once per second. Raw interval timestamps are saved; summaries include only whole intervals inside each scenario and exclude priming.

Aggregate PIDs only on the same adapter/physical engine. Different engines do not form an additive total GPU percentage. DWM and unrelated activity stay separate. Per-process dedicated/shared memory sums can double count shared surfaces; they are comparative process sums, not unique VRAM residency. Adapter totals are contextual, not attributed to Halation. See Microsoft: https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/ . Missing/invalid counters must not silently become zero.

The ablation script is imported only by the harness, never production. Draw suppression retains contexts/CPU work, isolating GPU draw cost rather than simulating hibernation. Resolution experiments preserve CSS geometry, with actual buffer dimensions recorded. rAF opportunity is not presented FPS. CPU throttling is not an iGPU simulation.

Visual approval remains pending. No automated visual evidence has been generated.

## User-requested visual experiment

Film grain call in the Auralis fragment shader is temporarily removed. The field and quantization dithering remain unchanged. This is an experiment pending visual review, not a final product decision. The GPU sweep native-gpu-before was interrupted after DPR 1.25 to prioritize this request; its completed phases remain diagnostic evidence.

2026-10-12 product decision: user explicitly approved removing film grain permanently ("me gusto, halation se queda sin film grain, sigue con la optimizacion"). Film-grain shader helpers, blue-noise texture payload and sampling are removed; quantization dither is retained. New two-pass field-resolution changes still require visual review.
Native paired controls: grain on 13.1378% 3D, grain off 11.0306% (60 updates/s, 1480×940 DPR1). Half-resolution half-float field + full output dither: 8.0090% at60 updates/s; same split at30:5.7095%. Draw count is2 per update in split mode, not120 visual FPS. These are component measurements; full final native before/after is pending.

Native-suite-before DPR emulation did not resize the original canvas (all buffers remained 1480×940). Those four scenarios are invalid as DPR comparisons; component/output-scale results are unaffected. Repeat DPR with a real ResizeObserver invalidation and validate physical buffer dimensions.

Measured Grade baseline: one source upload 2048×2048 (~32.9 ms CPU submission/blocking), one mipmap generation (~0.1 ms call), cold 33³ LUT generation and four-thumbnail batches; max rAF gap166.6 ms, long task106 ms. Initial change hoists invariant contrast/exposure math and schedules one thumbnail per frame; native after and byte-parity checks pending.
Welcome baseline drew both its own fullscreen canvas and CSS-invisible Auralis at144Hz. Auralis now suspends under welcome-active; Welcome shares the30Hz decorative scheduler and caches settled geometry. New visual approval and functional run pending.
