> Closure: see [Halation 1.1.1 FINAL](../frame-budget-111/FINAL.md). The documents below preserve experiment history. Product is animated320px/15Hz with stationary grain50%; static/low-frequency/crossfade controls are not production. Final Grade review approved; performance work is complete.

> 2026-10-12 — product correction: the static candidate below was rejected as product behavior. It is retained ONLY as a GPU measurement control. Focused visible Home must remain organically animated. Continuous fullscreen compositor crossfades/transforms are also rejected by measured cost. Animated tiny-field/direct, two-field interpolation and noise-lookup experiments are in progress; visual acceptance remains manual. Historical results below remain unchanged.

# Auralis 2: event-driven cached candidate

Status: implemented and functionally tested, pending explicit native visual review. Film grain stays removed. Stable idle has one cached dithered output, zero procedural draws and no Auralis clock. Existing wrapper/navigation motion remains; continuous ambient procedural morphing is deliberately absent in this candidate and must be judged manually.

## Architecture

One shared engine uses512/384/256 maximum field edge by quality, one half-float field texture/FBO where supported, two programs and one vertex buffer. Final output is viewport × capped DPR × quality scale. Unsupported half-float drivers use a single-pass shader with the same one-shot lifecycle.

Cache identity includes geometry, actual DPR, quality/output density and palette. Resize coalesces for160ms without clearing the valid surface while dragging. Invalidations request one render-budget task; completion returns to sleep. Re-entering Home uses the existing surface immediately. Tools, Welcome coverage, native blur/minimize and context loss suspend generation. Restoration recreates GPU resources once; disposal also removes observers, events, subscription and resize timeout. Read-only canvas.__auralisState() reports generations/presentations/field/output/cache/state without sampling.

Dither is baked during generation. There is no film grain, continuous uniform/coverage/noise work or procedural navigation-wave adapter. Atmosphere's architecture was preserved.

## Measurements

Raw and summarized native evidence lives in ../frame-budget-111/. Use native-auralis1-baseline.json, native-auralis2-static.json and native-cache-experiments.json. Older native-auralis2-verified/focused runs are diagnostics with invalid focus/control and are not accepted focused-Home measurements.

RX6650XT, i5-12400F,144Hz,1480×940CSS,DPR1, WebView2154. Auralis1 optimized Home untraced:5.648% engine-0/3D. Minimal cached Auralis2:3.062%, zero idle draws. Hiding its cached surface:3.218%. Pausing Home levitation only in the isolation harness:0% with cached Auralis visible. Thus remaining Home composition is not measured procedural Auralis work.

Continuous compositor experiments were rejected:2/3/4-field crossfade11.607/11.242/11.018%; one-field transform9.974%. They made no procedural idle draws, but did expensive continuous composition. Retained2/3/4-field caches alone measured0% while increasing dedicated process sums from107.3MB to131.1/137.4/143.6MB. No second production engine or prototype surfaces remain.

256/384/512 field-generation bursts showed no long tasks or gaps above8.2ms in this sweep. One-second GPU counters cannot resolve their short generation cost: sampled0% is not zero generation cost. Resolution appearance and static character are pending manual review;512 is the conservative candidate, not a visually proven optimum.

Windows attribution sums only PIDs in the verified Preview tree within the same adapter/physical engine. DWM is separate. Process dedicated/shared sums can count shared surfaces twice; they are not unique residency. rAF opportunities are not presented FPS.

## Repeat locally

From the repository root on this workspace (the helper selects .worktrees/performance-111):

```powershell
& .tools/performance111.ps1 native-build
& .tools/performance111.ps1 native-start
& .tools/performance111.ps1 benchmark native-auralis1-baseline-repeat
& .tools/performance111.ps1 benchmark native-auralis2-repeat
& .tools/performance111.ps1 benchmark native-cache-repeat
```

Run separately, never concurrently with browser tests/builds. Native focused intervals fail if focus is lost. The helper restores1480×940CSS geometry, verifies foreground/minimize state, and uses only its disposable Preview executable/profile. Keep the Preview foreground during focused phases.

The versioned harness is app/scripts/frame-budget-benchmark.cjs. For another environment set HAL_PERF_CDP, HAL_PERF_NATIVE_PID, HAL_PERF_NATIVE_EXE, CHROME, FFMPEG and FFPROBE; HAL_PERF_PHASE=auralis selects the dedicated protocol, HAL_PERF_COMPONENT=auralis-cache selects the rejected-variant sweep. Use a Preview profile containing performance-111; application data is asserted disposable. Set HAL_PERF_DIST to a complete asset directory to replay another renderer. baseline-assets/ archives the five Auralis1 files changed by this iteration; copy app/dist to a temporary directory and overlay those files. Verify result codeHashes against the saved baseline before treating it as identical.

## Focused regressions

From the worktree, with the repository's Node/Playwright/FFmpeg environment configured:

```powershell
node app/tests/auralis-resources.cjs
node app/tests/auralis-lifecycle.js
node app/tests/auralis-runtime.js
node app/tests/render-budget.js
node app/tests/tool-transitions.js
node app/tests/processes.js --functional
node app/tests/progress-runtime.js
```

All listed checks passed. The general motion.js runner remains blocked by pre-existing .992 exit-scale and removed Intro-tab assumptions documented in ../tool-transitions/README.md; its assertions were not relaxed. No screenshots, videos or automated visual-comparison artifacts were generated.
