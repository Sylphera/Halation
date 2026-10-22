# Animated Auralis experiments — correction of static candidate

The user rejected a frozen Home background. Static Auralis is a measurement control only, archived in static-control/. The candidate must remain organically animated on visible focused Home. No film grain. No continuous fullscreen CSS transform/crossfade, which the native cache experiment measured at approximately10–11.6%3D.

Benchmark-only implementations live in app/scripts/auralis-animated-experiment.js, routed into the real native Preview only by component=auralis-animated. index.html does not load this file. No production GPU-model checks or ablation flags.

Three common-lifecycle candidates:

- direct: the existing organic simplex field and coverage stabilizer, one tiny output buffer, one pass/update; stationary quantization dither baked in that buffer. 96/128/192/256-pixel long edge and8/15/30Hz tested. UI clocks remain independent.
- interpolate: two tiny half-float fields generated at2/4Hz, one tiny presentation shader interpolates them at15/30Hz and adds stationary quantization dither. One reusable FBO. No fullscreen CSS blending.
- lookup: one512×512 periodic simplex atlas generated once; five bilinear noise lookups replace procedural simplex calls in the same organic-field formula. One tiny output pass/update. The atlas has a64-unit repeat with an8-unit stitched edge, so this is an approximation requiring visual review and not a selected production implementation.

All variants pause for native blur/minimization, hidden tools and Welcome; coalesce resize for160ms; use the existing shared render budget; clean programs/shaders/textures/FBOs/observers/tasks/listeners and preserve context-loss/restoration lifecycle. Benchmark selection recreates only renderer resources, with logical palette/settings preserved.

Native protocol: exact owned Preview process tree, Windows PDH GPU Engine and GPU Process Memory, identical1480×940CSS/DPR1 geometry. Pausing the Home logo CSS motion is an explicit benchmark-only isolation; normal Home remains separately measured. Each animated measurement records actual native focus validity, including focus-loss events throughout the interval. Invalid intervals stay in the artifact and can be retried once; they cannot qualify a candidate. DWM is separate; GPU-memory process sums may double-count shared surfaces. rAF opportunity is not presented FPS. No automated visual captures.

Current partial evidence: native-animated-comparison.json. Valid direct96/128/192 at8Hz:0.726/0.668/0.697%3D respectively; paused control0%;120draws over approximately15s; p957.2ms, max7.6ms, zero long tasks. These are partial results, not visual acceptance or final architecture selection.

Repeat from repository root:

    & .tools/performance111.ps1 benchmark native-animated-comparison-repeat

Portable harness environment: HAL_PERF_CDP=http://127.0.0.1:9247, HAL_PERF_NATIVE_PID=<owned Preview root>, HAL_PERF_NATIVE_EXE=<exact Preview exe>, HAL_PERF_COMPONENT=auralis-animated, HAL_PERF_MS=10000, CHROME/FFMPEG/FFPROBE as documented in README. Run node app/scripts/frame-budget-benchmark.cjs <unique-label>. The native window must be available for foreground measurements.

Pending: complete all three GPU variants; low-frequency/higher-resolution confirmation; functional regressions against the selected animated candidate; native build and manual visual comparison. No final visual acceptance has been given.

## Completed native candidate sweep

Only full focus-valid intervals from animated-comparison.json qualify. Direct192px at8Hz0.6969%3D; two-field interpolation192px at8Hz/2Hz generation0.6591%; lookup192px at8Hz0.6931%. These differences are too small to justify a more complex production engine on GPU evidence alone. Direct192px at4/5/15/30Hz:0.3282/0.4146/1.2274/2.2966%. Static paused control0%. All qualifying isolated samples have p95rAF~7.2ms and zero long tasks. 192px has the most spatial detail among the focus-valid tiny direct samples at8Hz. The256px sample was focus-invalid and does not qualify.

The provisional production candidate now uses the original field formula/speed, a single192px-long-edge buffer, one program and buffer, no textures/FBOs;8Hz HIGH and4Hz under existing frame/job pressure. The shared clock has a validated setFps API. DPR does not multiply this buffer. Reduced motion retains the last frame and invalidations redraw once. Hidden/blur/minimize/Welcome do zero work. Context restoration retains field time. Stationary quantization dither remains but is now sampled in the tiny output; banding/fidelity MUST be reviewed manually. The cached static renderer exists only in static-control/.

Native integrated product Home (native-product-home.json): normal unmodified Home3.2877%3D,81draws in10.03s, p957.2ms, max7.6ms, no long tasks. This is total Home including the unchanged CSS logo levitation, not Auralis-only cost. The subsequent isolated interval lost focus and is excluded. Further focused isolated/suspend/navigation/resize measurements remain in progress.

Functional validation passed: animated resource VM, real WebGL lifecycle (visible Home animation, hidden Grade, blur/minimized/Welcome resize, reduced motion, context-loss/no resurrection/phase restoration), scheduler8/4Hz plus existing60/30/5Hz/minimize/Converter/Visualizer checks, auralis-runtime continuity, all three experimental variants. Native1.1.1 compiled successfully. First background-runtime run failed its unchanged>50ms main-thread assertion (two tasks); the same primary runner against the static control passed, though software rAF still had long gaps. Investigating/repeating the isolated candidate run; this failure is not hidden or dismissed as a proven pre-existing failure. General motion runner retains its separately documented pre-existing failures.

Native manual comparison: node app/scripts/auralis-review.cjs (HAL_PERF_CDP and owned PID/exe environment as above), or & .tools/performance111.ps1 review. It adds a benchmark-only selector for three variants, frequency and field size to the real native Preview. No capture or encoding. Reload returns to the compiled animated candidate. No visual acceptance yet.
