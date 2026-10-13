> Latest approved product decision: **50% static grain strength,320px field,15Hz**. The user’s50% selection supersedes70% and the earlier100% reference; measured100% artifacts remain historical evidence.

# Auralis static blue-noise —2026-10-12

## Product decision

The user explicitly approved the cheap stationary blue-noise texture over the animated320px field. After comparing15/10/8Hz with that texture, the user selected **15Hz**. Earlier no-grain and8Hz product proposals are superseded. Legacy procedural film grain remains benchmark-only.

The integrated renderer generates a320px-long-edge half-float field, then presents it at CSS-pixel resolution with stationary quantization dither and two precomputed blue-noise samples. No procedural grain warp, grain updates or texture uploads per frame. One framebuffer, two textures, two programs, one buffer;15field generations/s and30GL draws/s. DPR does not multiply either buffer. Hidden, unfocused, minimized and Welcome-covered states suspend completely. Reduced motion retains the last image.

## Native comparison

RX6650XT; owned native Preview process tree via Windows PDH,10second focus-valid intervals. Native window1480×940,DPR1; field320×203. Isolation pauses the Home CSS mark; normal Home includes it. These are prototype comparison measurements, not yet the integrated build verification. Full raw provenance and values: [grain-comparison.json](grain-comparison.json).

| Variant | Atmosphere | Isolated GPU3D % | Home GPU3D % |
|---|---|---:|---:|
| No grain, tiny direct | OFF |1.102|3.208|
| No grain, tiny direct | ON |1.247|3.579|
| No grain, final-pass control | OFF |1.317|3.456|
| Legacy grain, final pass | OFF |1.805|invalid focus|
| Cheap static grain, final pass | OFF |1.295|3.490|
| Cheap static grain, final pass | ON |1.475|3.795|

Legacy+Atmosphere ON lost focus and is excluded. All qualifying intervals have no long tasks, requestAnimationFrame opportunity p95 about7.1–7.2ms and maximum gaps7.4–10ms. Opportunity timing is not presented FPS. Cheap isolated process-sum dedicatedGPU memory was116.10MiB OFF /122.36MiB ON. Shared surfaces can be counted by more than one process, so memory sums are a consistent comparison, not unique physical allocation.

Cheap vs same final-pass no-grain control is within measurement noise; cheap vs legacy isolated saves about0.51percentage points. Adding the native-size presentation costs memory and work compared with the tiny direct canvas. Atmosphere recorded zero worker draws in all qualifying idle intervals and its Home pass supplies no grain. ON/OFF differences cannot be claimed as procedural grain cost: compositor residency, clocks and sampling noise remain.

## Verification and review

Resource/lifecycle, realGL runtime, background runtime and render-budget checks passed for integration before intensity tuning. SwiftShader navigation had large frame gaps despite functional passes; it is not native performance evidence and does not satisfy the frame-budget target. Native integrated measurements remain required.

The intensity tuning panel is Preview-only:0–300%,100% earlier reference,15Hz unchanged. It adjusts a single cached uniform on change, retains the same blue-noise texture and never adds a loop. The user selected70%, then explicitly replaced that decision with **50%**. The integrated product default and locally compiled Preview now use50%; no persistent Settings preference was introduced.

Commands from the worktree, with Node22 and Playwright available:

`node app/tests/auralis-resources.cjs`

`node app/tests/auralis-grain.js`

`node app/scripts/auralis-grain-strength-review.cjs` (native Preview CDP9247)

Native GPU harness: set`HAL_PERF_CDP=http://127.0.0.1:9247`,`HAL_PERF_NATIVE_PID` and`HAL_PERF_NATIVE_EXE` to the owned Preview instance; set`HAL_PERF_COMPONENT=auralis-grain`,`HAL_PERF_GRAIN=none|legacy|cheap`,`HAL_PERF_GRAIN_ATMOSPHERE=0|1`,`HAL_PERF_GRAIN_FINAL=1` for the final-pass control,`HAL_PERF_MS=10000`; run`node app/scripts/frame-budget-benchmark.cjs native-grain-<variant>-<on|off>-final`. Preserve failed focus intervals and exclude them from conclusions.

## Integrated native verification

`native-product-isolated-grain-integrated-repeat.json` is whole-interval focus-valid. GPU3D1.502% traced /1.512% hardware-idle (sampling rAF stopped);117MiB process-sum dedicated /18.59MiB shared GPU memory. Field320×203, presentation1480×940,15.04 updates/s, two textures, one framebuffer, zero steady uploads, no long tasks, zero traced layouts/style recalculations. Opportunity p957.2ms, maximum12.7ms. Atmosphere ON; Home CSS mark paused only for isolation. The first integration interval and the subsequent pressure interval lost focus; raw artifacts retained and excluded.

Intensity slider is now available in the actual integrated native Preview.100% remains the default pending the user’s final intensity selection. Its local review selection persists only in the disposable Preview profile; it does not modify product Settings.
