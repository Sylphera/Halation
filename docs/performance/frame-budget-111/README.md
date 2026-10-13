# Native performance protocol — Halation 1.1.1

This work continues task/performance-111 from edf8a82. It does not publish a release or change exports.
Latest approved product decision: animated Auralis320px/15Hz with50% cheap stationary blue-noise. Legacy procedural film grain remains removed; the earlier complete no-grain decision is superseded. See [GRAIN.md](../auralis-2/GRAIN.md) and [PROCESS-UI.md](PROCESS-UI.md).
STATUS.md distinguishes completed measurements, interrupted diagnostics and pending validation.

## Measurement

Run app/scripts/frame-budget-benchmark.cjs in the real Preview WebView2, with Windows PDH sampling outside the renderer.
performance-gpu.ps1 verifies executable, root creation time and descendants (including tool subprocesses), rejecting reused PIDs.
GPU Engine utilization is summed across PIDs only within the same adapter/physical engine. Engines are separate, never added into
an invented total GPU percentage. DWM and other processes are recorded separately. Dedicated/shared process memory sums can
count shared surfaces twice; they are consistent comparative counters, not unique VRAM residency. Adapter totals are contextual.
See [Microsoft's GPU counter explanation](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/).

Each ordinary scenario records frame-callback gaps, long tasks, CDP CPU/layout/style/paint, native CPU/RAM/GPU, resource counts,
canvas physical dimensions, DPR, GL objects/uploads/draw passes, workers/media and known loops. rAF opportunities are not
presented FPS. CPU throttling is not an iGPU simulation. Read-back/upload call durations are CPU submission/blocking time,
not GPU timestamp-query timings. Worker GL instrumentation covers the classic Blob-based Atmosphere worker; it does not claim
all possible module/URL workers. Two-pass Auralis issues two GL draws per visual update.

Component phases warm up 5 seconds and measure 15 seconds. Home hardware-idle measures 20 seconds without tracing or the
frame probe. Other runtime phases use 10 seconds; the soak waits 3 minutes without tracing and measures the last 5 seconds.
Whole PDH intervals within each scenario are retained; priming and boundary intervals are excluded. Raw JSONL contains
intervals, identities, counter status and unrelated/DWM activity. Compare repeated component controls because clocks/load vary.
Tracing can perturb CPU; report CDP and CIM CPU separately where they disagree. Hardware-idle is the untraced control.

Benchmark-only ablations are in performance-ablation.cjs, never imported by production. Suppressing a main-thread draw retains
CPU uniform work and contexts; disabling Atmosphere pauses its worker. These controls isolate costs, not equivalent lifecycle
implementations. Resolution controls preserve CSS geometry and must validate the actual physical buffer. The initial
native-suite-before DPR phases failed that check (unchanged buffer); do not use those four phases as DPR evidence.

## Scenarios

Preserve the native single-tool scenarios alongside multitasking: Home/Welcome, one tool, rapid navigation, ten empty views,
three worker/progress fixtures, focus/minimize, audio playback, Grade load/controls, Cover Test, Frame Grab load/scrub, five
retained tools, then ten open views retaining ten inputs across nine media-capable tools (Visualizer holds image+audio;
Downloader has no local input). Three real FFmpeg encodes (720p, x264 fast, two threads each) run alongside retained media and
navigation. These are real backend processes, not a claim that arbitrary concurrent AI jobs are solved.

## Repeat on Windows

Use Node 22+, Playwright/Chromium and the existing FFmpeg/FFprobe dependencies. Build Preview locally without publishing:

~~~powershell
# From .worktrees/performance-111/app; use the cached target directory when available.
npm run tauri -- build --no-bundle --features preview --config src-tauri/tauri.preview.conf.json
~~~

In PowerShell from .worktrees/performance-111, launch a separate disposable profile (never point this at user data):

~~~powershell
$env:HALATION_PREVIEW_PROFILE = 'performance-111-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9247 --remote-debugging-address=127.0.0.1'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $PWD ('.tools/webview-' + $env:HALATION_PREVIEW_PROFILE)
$nativeExe = (Resolve-Path app/src-tauri/target/release/halation-preview.exe).Path
$nativeProcess = Start-Process -FilePath $nativeExe -WorkingDirectory $PWD -WindowStyle Hidden -PassThru
$env:HAL_PERF_CDP = 'http://127.0.0.1:9247'
$env:HAL_PERF_NATIVE_PID = [string]$nativeProcess.Id
$env:HAL_PERF_NATIVE_EXE = $nativeExe
$env:HAL_PERF_GPU_SUITE = '1'
$env:HAL_PERF_MS = '10000'
$env:HAL_PERF_SOAK_MS = '180000'
# Set CHROME, FFMPEG, FFPROBE to the installed executable paths if not on PATH.
node app/scripts/frame-budget-benchmark.cjs native-suite-after
~~~

For the original assets, extract the base without making another worktree:

~~~powershell
git archive --format=zip --output=.tools/performance-base.zip edf8a82 app/dist
Expand-Archive -LiteralPath .tools/performance-base.zip -DestinationPath .tools/performance-base -Force
$env:HAL_PERF_DIST = (Resolve-Path .tools/performance-base/app/dist).Path
node app/scripts/frame-budget-benchmark.cjs native-suite-before
Remove-Item Env:HAL_PERF_DIST
~~~

The native binary/backend is the same in both runs; the harness serves the selected frontend and records its content hashes.
Use a fresh native process/profile per run. Close other graphics workloads where practical; do not run browser tests, builds,
video encoding or screenshots concurrently with GPU measurement. Output JSON and raw GPU JSONL go beside this document.
The local machine runner is root .tools/performance111.ps1 (not a repository dependency); the recorded equivalent invocation
is: & '.tools/performance111.ps1' benchmark native-suite-before / native-suite-after.

## Focused checks

~~~powershell
node app/tests/auralis-resources.cjs
node app/tests/performance-gpu.cjs
node app/tests/render-budget.js
node app/tests/auralis-runtime.js
node app/tests/tool-transitions.js
node app/tests/grade-runtime.js
node app/tests/framegrab-perf.js
node app/tests/processes.js --functional
node app/tests/jobs.js
node app/tests/session.js --functional
node app/tests/sessions-runtime.js
node app/tests/settings.js --functional
node app/tests/library.js --functional
node app/tests/covertest.js --functional
node app/tests/motion.js --functional
~~~

Functional flags prevent visual artifact generation where supported. Frame Grab's pixel checks verify decoded output,
not UI visual approval. Do not pass --functional to Frame Grab: its positional arguments select video labels.
Native visual approval is done in the actual open instance. Automated screenshots/videos are not part of this iteration.
