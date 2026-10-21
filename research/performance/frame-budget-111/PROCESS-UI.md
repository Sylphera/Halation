# Process UI attribution —2026-10-12

## Confirmed independent faults

1. A killed dock hover tween retains fractional progress after removal from the GSAP timeline. The SVG union geometry loop checked progress alone and kept reading geometry/writing its path every frame forever. The fix checks timeline membership and pause state too. A later hover still wakes and completes normally.
2. Grouped job events repainted island text, controls and geometry even when visible rounded progress/title/state were unchanged. The island now compares its visible presentation before processing data-only job notifications; geometry/interaction/settings paths can still force a paint. Process-list progress patching avoids identical text writes and reads surface geometry only when rebuilding rows. Full internal job precision is unchanged.

## Functional before/after

Software Chromium; actual shell/manager, mocked backend. These are layout/activity measurements, **not native GPU evidence**. Three-second steady intervals. Raw artifacts are adjacent JSON files.

| Scenario | Before layouts | After layouts |
|---|---:|---:|
| Cancelled dock hover, no jobs |150|0|
| Three reporting jobs, Processes closed |38|2|
| Three reporting jobs, Processes open |74|9|

Cancelled-hover RAF callbacks150→0; geometry reads300→0. Progress fixture:3jobs reporting50times/s each, nominal120s work, actual job manager batching retained. Island geometry passes38→2 closed,37→3 open; list rows continue to receive precise progress. Closed list render entry calls are not actual list renders: the existing hidden guard exits immediately.

Held jobs and queued jobs waiting for RAM showed no continuous layout when stabilized. The earlier native9.67%/1298layouts capture used3**running** jobs blocked on Promises, not jobs whose state was queued/waiting. It also contained663callbacks namedstep. The killed-tween reproduction proves an independent cause, but does not yet attribute the entire historical GPU interval. No claim that9.67% is fixed until native comparisons qualify.

## Reproduction

With Node22/Playwright and the existing test environment:

- `node app/tests/dock-lifecycle.js`
- `node app/tests/progress-runtime.js`
- `node app/scripts/process-ui-benchmark.cjs process-ui-measurement`

Set`HAL_PROCESS_PROGRESS_ONLY=1` for the reporting-jobs subset. Native harness component`HAL_PERF_COMPONENT=process-ui` supports`HAL_PERF_PROCESS_STATE=idle|running|waiting|held|progress`,`HAL_PERF_PROCESS_OPEN=0|1`,`HAL_PERF_DOCK_CANCEL=1`, and benchmark-only`HAL_PERF_DOCK_LEGACY=1` to reintroduce the old continuation condition as an experimental control. Owned native PID/executable/CDP settings follow the existing GPU harness. Keep whole-interval focus validation enabled.

## Native dock control comparison

Whole-interval focus-valid,10s, three running Promise jobs, Auralis320px/15Hz with50% static grain, Home CSS mark paused. Legacy continuation condition vs fixed:

- Owned GPU3D **4.046% →1.273%**.
- CDP layouts **1447→0**, style recalculations **1447→0**, dock RAF callbacks **1447→0**.
- Process UI renders/job events were zero in both intervals: the sustained work came from the dock, not progress events.
- PDH CPU one-core percentage **72.91→8.76** (12logical-core host; not system CPU%).
- Opportunity p957.1ms both; max7.2/7.3ms; no long tasks.

Raw labels: `native-process-running-closed-cancel-legacy-repeat` and `native-process-running-closed-cancel-fixed`; compact `process-native-dock-comparison.json`. This attributes a concrete residual loop but does not explain all of the historical9.67% interval.

## Waiting jobs and composition follow-up

## Progress interpolation attribution and bounded clock

The retained-media follow-up `native-followup-process-progress-attribution` kept ten inputs loaded and three real FFmpeg encodes running. With Processes open, the ordinary progress interpolation used **5.978% owned GPU 3D**, 23 layouts and 943 style recalculations/10 s. A benchmark-only instant-bar control used **0.481%**, 18 layouts and 27 style recalculations. Both complete intervals retained native focus and had no long tasks. This isolates the interpolation of the featured progress bar; it is not evidence that GSAP generally is expensive.

`motion.js` now advances progress springs through one shared 30 Hz render-budget task per realm, with paused GSAP tweens. Updates smaller than one CSS pixel snap to their exact target. Finished/interrupted tweens are disposed, and hidden/unfocused/minimized views finish pending progress without retaining a clock. The progress value and backend precision remain unchanged.

`native-process-progress-open-bounded-valid` verifies the implementation with three reporting jobs, Processes open, Home mark paused for attribution and product Auralis active: **1.692% owned GPU 3D**, opportunity p95 **7.2 ms**, max **7.5 ms**, no long tasks. This is a different workload from the real-encode follow-up and must not be reported as its paired after result. `progress-motion` and `progress-runtime` pass, including exact interruption, iframe time origin, subpixel updates, 15,000-report bursts and suspension. Jobs, Processes and tool-transitions functional regressions also pass.

The fresh ten-input real-encode after run `native-retained-bounded-realjobs` subsequently passed: Processes-open **0.256% GPU**, 19 layouts / 25 style recalculations, p95 **7.1 ms**, max **7.4 ms**, no long tasks, three encodes running at both endpoints. It used a fresh model-cold no-autorun control and native file inputs rather than the prior model-warmed page; see `RETAINED.md` for comparison limits. Manual visual approval of progress motion remains pending.

Reproduce the reporting-job native check with the existing Windows helper: `& .tools/performance111.ps1 benchmark native-process-progress-open-bounded-valid` from the repository root. Use a new output label for every run. The failed/crashed and focus-invalid `bounded` / `bounded-retry` artifacts are excluded.

### Earlier waiting/composition measurements

`native-process-waiting-closed-final50-focusfix`: three genuinely queued jobs waiting for RAM, Processes closed, Home mark paused only for attribution, product Auralis320px/15Hz/50% grain. Whole interval focus-valid: **0 layouts,0 style recalculations,0 island paints,0 list render calls,0 job events**, no long tasks; opportunity p957.2ms/max11.3ms. Owned engine-0/3D1.613%; process dedicated-memory sum98.1MiB. This establishes quiescent waiting-job UI, not a normal Home-total measurement.

The normal Home keepalive pair already had1447 style recalculations/10s **without jobs**; waiting had1448. Those counts must not be attributed to the waiting jobs. Pausing Home's sole CSS animation (the levitating mark) removes them. A short CDP check also showed that the144Hz frame-opportunity probe causes main-thread style sampling of that animation:217 recalculations/1.5s with the probe,29/1.5s without it. Native GPU composition remains measurable separately; this probe-dependent style count is not an application144Hz JavaScript loop.

`native-keepalive-home-pair`: keepalive inactive in both arms; normal Home3D3.504/3.581%. `native-keepalive-waiting-final-repeat`: keepalive also inactive,4.485/4.427%; this separate-run difference is not yet a clean attribution of the extra GPU cost. `native-keepalive-tool-pair`: empty Grade visible, keepalive ON0.0896%, OFF0%; no Auralis draws/layout/style work. OFF inhibits its2D writes for attribution while retaining its timer. The production shadow/composition workaround is preserved.

Focus bridge follow-up: WebView focus after reload now refreshes the actual native focus/minimized state. Native focus event notifications also query current state instead of immediately applying a potentially stale payload. The render-budget regression covers recovery after reload, stale notifications, real blur and minimize. The native harness preserves raw event payloads alongside verified `isFocused()` results; an actual loss still invalidates the interval. Interrupted artifacts remain excluded and are never overwritten.

## Forced keepalive static control

`native-keepalive-static-forced-final-retry` makes the keepalive eligible even on Home **only in benchmark-served code**, pauses the mark and suppresses Auralis draws. It establishes an actual ON/OFF pair rather than testing two arms where the production live-scene guard disables it. Both ten-second intervals retained focus: ON **0.1086% owned GPU 3D**, OFF **0%**, zero layouts/style recalculations/long tasks in both. The 2D probe confirms **50 corner writes→0**. The OFF arm inhibits writes while leaving the timer/counter active for consistent attribution. The first attempt did not obtain focus and is excluded.

This agrees with the earlier empty-tool approximately 0.09% cost. The Windows shadow/composition workaround is therefore retained; no production forced-keepalive mode or removal is introduced. Reproduce with `HAL_PERF_FORCE_KEEPALIVE=1` and a fresh `native-keepalive-static-*` label. Clear that environment variable for production-policy measurements.
