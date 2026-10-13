# Halation 1.1.1 performance closure

Branch: task/performance-111. Original base: edf8a82. No remote changes.

## Final product decisions

Auralis remains animated at 320 px long edge / 15 Hz, with stationary blue-noise grain at 50%. It uses a small organic field plus a cheap CSS-pixel presentation pass, independent of monitor DPR. The Home logo is completely static. Composition keepalive is retained for the Windows shadow/composition defect. Processes uses the approved shared bounded progress clock. Processing algorithms and export resolution/quality are unchanged.

**Performance work for 1.1.1 is complete.** The user explicitly approved the clean native Grade Preview and asynchronous thumbnail presentation on 2026-10-12 after the final regressions. No important reproducible lifecycle/correctness/progressive-retention or clearly avoidable normal stutter issue remains within the agreed closure scope. Stop condition reached; no new performance investigations or product changes are planned. The branch is locally committed for integration review; nothing has been merged or changed remotely.

## Final native metrics

Final raw suite: native-runtime-final-111.json (30 scenarios, no page/harness errors). All normal acceptance intervals are state/focus qualified. navigation-cpu-4x and the original final home-soak lost focus and are excluded from focused claims. The soak was repeated on the exact same retained native PID/profile/assets after the completed 180 s wait: native-runtime-final-soak-focused.json. Summary: native-runtime-final-summary.json.

| Scenario | Owned 3D mean | Shell rAF p95 / max | Long tasks inside frame window | Layouts |
|---|---:|---:|---:|---:|
| Home hardware idle | 1.488% | 7.2 / 7.5 ms¹ | 0 | 0 |
| One empty visible tool | 0.156% | 7.2 / 7.6 ms | 0 | 0 |
| Rapid navigation | 1.440% | 7.2 / 13.9 ms | 0 | 99 |
| Ten tools / ten retained inputs, Home | 1.460% | 7.1 / 25.1 ms | 0 | 0 |
| Loaded navigation | 4.879% | 7.1 / 34.8 ms | 0 | 195 |
| Three real FFmpeg jobs, retained inputs | 1.764% | 7.1 / 7.4 ms | 0 | 27 |
| Same real jobs, Processes open | 1.746% | 7.1 / 7.4 ms | 0 | 40 |
| Unfocused hardware idle | explicit 0% | sampler stopped | 0 | 0 |
| Minimized hardware idle | explicit 0% | sampler stopped | 0 | 0 |
| Focused follow-up after soak | 1.584% | 7.2 / 7.7 ms | 0 | 0 |

¹ Home GPU is the 20 s hardware-idle interval with the artificial frame sampler stopped; timing is the separate 10 s Home sample in the same native run. Auralis updates remain ~15/s (two GL draws per update). All ten hidden tools have zero recurring rAF, GL draws and 2D paints in the retained steady interval; Converter and Vocal Remover AudioContexts are suspended. Hidden logical model processing may legitimately finish. No zero-memory claim is made.

Final cold Grade max 48.5 ms (idle max 8.4 ms); Frame Grab cold max 41.7 ms (scrub max 9.4 ms). Loaded navigation has a single ~34.8 ms maximum; this is disclosed, not called perfect 60 FPS. CPU-4x Home valid max 55.4 ms; its navigation loses focus and is not qualified. Earlier focused CPU-4x max104.1/145.9 ms remain historical future-work evidence.

RAM/VRAM are owned process sums (MiB), with model/cache/session state retained:

| State | Private RAM | Working set | Dedicated GPU | Shared GPU |
|---|---:|---:|---:|---:|
| Home hardware idle | 315.88 | 152.82 | 101.41 | 18.59 |
| Ten retained inputs, model preparation still active | 1738.11 | 1457.10 | 467.49 | 48.93 |
| Three real jobs + Processes open | 3738.27 | 3522.79 | 445.71 | 39.82 |
| Final focused settled retained-input follow-up | 1073.69 | 730.54 | 417.61 | 59.18 |

These are different legitimate workload states, not a paired before/after memory optimization. The valid native Vocal Remover cache-expiration comparison is below. Final follow-up contains 7 primed PDH intervals; jobs-open 2 and the other 10 s intervals generally 3. Short Converter intervals may have no qualified GPU sample: missing is not zero.

A final reporting boundary correction clips shell long tasks to frameSampleStart, matching rAF gaps. The raw ten-input array retains one 230 ms task ending ~982 ms before the measured frame window; it is excluded from the compact in-window count, not hidden or attributed to a product fix. Future harness code applies this cutoff directly; the final raw harness hash precedes this reporting-only correction. CPU/layout deltas remain conservative and can include baseline CDP queries. No product code changed after the measured release build.

## Confirmed improvements

- Hidden tools stop recurring visual work; Auralis sleeps behind tools, Welcome, blur and minimize. Visualizer no longer has an idle perpetual rAF. Converter stops hidden waveform/playback work and suspends its AudioContext, including delayed resume races.
- Cancelled dock motion no longer retains a monitor-rate geometry loop: paired waiting-job layouts 1447→0 per 10 s, owned 3D 4.046→1.273%. Processes avoids unchanged/full hidden list paints; progress shares a 30 Hz/subpixel clock. Real-job open Processes measured 5.978→0.256% in sequential qualified runs, with different model residency (not a randomized identical-state comparison).
- Vocal Remover defers hidden waveform/decode/UI work (40 hidden redraws→0), and expires its inactive native model cache after 30 s without interrupting inference. A parked condition-variable thread replaces polling.
- Frame Grab reuses the existing session disk copy and transfers 512 KiB instead of 8 MiB IPC payloads. Localized native max gap 159.8→14.1 ms; later cold runs vary. Persisted video bytes/SHA-256 are unchanged.
- Cutout transfers model files in acknowledged 512 KiB chunks, assembling only inside its worker. Aligned ten-media native max gap 270.9→7.5 ms; 276 ms long task→none; all three actual encoder feature tensor hashes match. Completion max 27.9→7.8 ms. Worker stop now clears/rejects pending callbacks and prevents late completions from arming replacement-engine timers.
- Grade moves invariant LUT math outside the loop, keeps all 42 LUTs byte-identical to edf8a82, prepares thumbnail LUTs in a bounded worker and uses one asynchronous PBO/fence readback at a time. Hidden/teardown paths cancel pending readback/worker work. Render-target pools no longer retain obsolete resize targets; busy export targets remain protected.
- Cover Test revokes original image URLs on removal (five removal cycles retained 5→0 URLs). Grade repeated resize/replacement texture counts stabilize rather than growing (40→45 corrected to 40; 43→48 corrected to 43).
- Static Home logo removes continuous style/composition work: sequential Home control 5.386→1.623% GPU and 1445→0 style recalculations/10 s. Earlier procedural Auralis was ~27–28% Home GPU; final animated Home is around 1.4–1.6% on this desktop. These historical values have different interventions and must not be summed as independent savings.

## Grade source ImageBitmap experiment: rejected

The final worker-prepared ImageBitmap candidate lowers the isolated upload/gap but worsens input→first rendered preview: 46.2→73.1 ms. Max shell gap falls 48.7→34.8 ms. PNG/JPEG/WebP inputs produce byte-identical full-resolution PNG exports in the experiment and lifecycle tests pass, but this is not a clear end-to-end improvement. The candidate is NOT in production; its scripts are archived only under app/scripts/fixtures and grade-image-source-experiment.js. No third strategy is attempted. See grade-source-final-decision.json and the two final native Grade controls.

Other rejected controls: frozen Auralis, continuous cached crossfade/transform, 4/5/8/10 Hz normal cadence, very low resolution, legacy procedural grain, and main-thread ImageBitmap preparation. They remain measurement history, not selectable production engines.

## Lifecycle and memory interpretation

Session documents, decoded inputs and useful cached tool resources are deliberately retained. Hidden tools are not required to retain zero RAM/VRAM. Bounded focal cycles cover Grade resize/replacement, Cover original removal, Converter replacement/closed AudioContext, Cutout stop/late callbacks, and native Vocal Remover cache expiration. The primary native suite opens ten tools and retains ten actual media inputs across the nine file-input tools (Visualizer has cover+audio; Downloader is open without a network download), then navigates them, real job cancellation, focus/minimize/restore and delayed model completion. No progressive growth bug remains demonstrated by these checks; this is bounded evidence, not a proof of unlimited lifetime leak freedom.

The qualified Vocal Remover native cache repeat measured dedicated per-process sums 1108.09→107.48 MiB, native DirectML PID 991.19→explicit 0 MiB, private RAM 1578.45→480.44 MiB after expiration (4/3 primed intervals). These sums may double-count shared surfaces and are not unique physical VRAM residency. Do not compare unrelated cold/warm profiles as a memory optimization claim.

## Validation

Raw focal results: final-tests.json / final-tests.log (30 attempted, 27 passed in the software-renderer batch). Supplement: final-checks.json; the unchanged production Auralis lifecycle repeat passes with hardware, giving 28 passing product checks. The two remaining failures are archived candidate tests, explicitly excluded from product acceptance. Product lifecycle Auralis passes unchanged with ANGLE D3D11 hardware; its 500 ms animation assertion fails under SwiftShader load and that failure is preserved. Historical candidate tests auralis-animated / auralis-grain fail prototype expectations/restoration; they route discarded experimental renderers, not production. Assertions have not been weakened.

Rust cargo check passes; cargo test: 67 passed, 0 failed, 3 ignored. Preview release build passes. Strict clippy fails two pre-existing chunks_exact_to_as_chunks lints at convert.rs:149 and stems.rs:735 on Rust 1.99; no suppression or unrelated processing refactor was added. Legacy motion/Stems/Cover tests expecting removed UI remain documented as obsolete. Full Converter runner has a Unix pandoc preflight on Windows; converter lifecycle and native input/playback-state inventory are covered separately. Linux /proc memory runner is not reported as passing on Windows. No automated visual-review captures were generated for this closure.

Production scan finds no active HAL_PERF, __gpuAblation, source-worker experiment or experimental renderer import in app/dist. Functional test changes initialize the current save-location fixture and guard capture-only checks with --functional; processing/export assertions remain intact.

## Known nonblocking debt / stop condition

- Cold Grade source decode/upload still has a ~49–56 ms frame gap; the attempted worker strategy worsens total load latency and is discarded.
- Cold Frame Grab load and first media decode vary across runs; the large duplicate/IPC bottleneck is fixed, not every cold decode.
- CPU 4x can show 100–146 ms gaps. This is future low-end evidence, not an acceptance requirement or reason to start another optimization cycle.
- Job manager resource admission/thread budgets can still overcommit mixed CPU/GPU/model workloads; engine thread counts lack a shared UI reserve and per-line backend logging IPC can be costly. Existing ~60 ms event batching is preserved; no manager rewrite was attempted. Three real concurrent FFmpeg jobs are measured, not every combination of heavy AI jobs.
- Keepalive has small measured composition cost and remains for correctness. No further GPU decimal chasing.
- Strict clippy/toolchain and legacy test maintenance noted above.

The final normal-runtime regression and manual visual approval satisfy the stop condition. Do not open another performance investigation for 1.1.1.

## Repeat on the measured Windows host

From repository root, in a fresh PowerShell without prior HAL_PERF overrides:

~~~powershell
& ./.tools/performance111.ps1 native-build
& ./.tools/performance111.ps1 native-start
& ./.tools/performance111.ps1 native-window restore
$env:HAL_PERF_PROFILE='1'
& ./.tools/performance111.ps1 benchmark native-runtime-final-111
& ./.tools/node-v22.16.0-win-x64/node.exe app/scripts/performance-soak-followup.cjs
# Follow-up requires the same still-open PID/profile from the final suite; HAL_PERF_NATIVE_PID,
# HAL_PERF_NATIVE_EXE, HAL_PERF_CDP, NODE_PATH and npm_config_prefix as described below.
& ./.tools/performance111.ps1 test grade-runtime
& ./.tools/performance111.ps1 test grade-thumbnails
& ./.tools/performance111.ps1 test grade-resources
~~~

The helper is machine-local orchestration, not a product dependency. Portable harness entry: node app/scripts/frame-budget-benchmark.cjs native-runtime-final-111 from this worktree with NODE_PATH/CHROME/FFMPEG/FFPROBE configured, HAL_PERF_CDP=http://127.0.0.1:9247, HAL_PERF_NATIVE_PID set to the verified disposable Preview PID, HAL_PERF_NATIVE_EXE set to its absolute executable, HAL_PERF_MS=10000 and HAL_PERF_PROFILE=1. Start the Preview with a disposable HALATION_PREVIEW_PROFILE and WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9247. The harness does not install engines; use the already installed models/tools. Do not run heavy tests/builds concurrently or change focus during focused intervals.

Native counters attribute root+verified descendants only, separate DWM/unrelated apps, and require whole-interval focus/state validity. PDH wildcard queries reopen and prime to capture late processes: coverage is discontinuous (~1 s each ~2.7 s), not continuous. Missing counters are not zero. Frame timing is rAF opportunities, not confirmed presented FPS. Physical hardware: i5-12400F, RX 6650 XT 8 GB, 1480×940 CSS, DPR 1, 144 Hz, WebView2 154. CPU 4x is not an iGPU simulation. The primary soak reports a 5 s sample after 180 s wait; its final repeat is a 20 s focused sample of the same retained instance after that wait. Neither is continuous 180 s tracing.
