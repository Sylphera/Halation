> Latest approved product decision: **50% static grain strength,320px field,15Hz**. The user’s50% selection supersedes70% and the earlier100% reference; measured100% artifacts remain historical evidence.

> 2026-10-12 — latest visual decision: user approved cheap STATIC blue-noise grain over the ANIMATED320px field, then compared15/10/8Hz with that grain and explicitly selected15Hz ("he hecho las pruebas, se queda a15"). Product cadence remains15Hz, including focused Home under pressure.10/8Hz remain benchmark-only rejected normal-product trials. Native comparison used the approved cheap-grain experiment; compiling/verifying the integrated product renderer remains separate. Older status/results below are historical and do not override this decision.

> 2026-10-12 — product correction: the static candidate below was rejected as product behavior. It is retained ONLY as a GPU measurement control. Focused visible Home must remain organically animated. Continuous fullscreen compositor crossfades/transforms are also rejected by measured cost. Animated tiny-field/direct, two-field interpolation and noise-lookup experiments are in progress; visual acceptance remains manual. Historical results below remain unchanged.

# Auralis 2 experiment status

Implemented, not visually approved. No grain. Baseline snapshot is unchanged.

Fresh optimized Auralis 1 native baseline: Home untraced 5.648% GPU engine-0/3D, 30 updates/s (60 GL draw calls/s, field plus output dither), 740×470 field and 1480×940 output.

Minimal cached Auralis 2: Home untraced 3.062%; hiding the cached Auralis surface gives 3.218%, so this residual is not an observed procedural Auralis cost. Auralis has one generation total, zero idle draws, zero active rAF, zero idle uploads/uniform updates. Field 512×325, output 1480×940. Navigation reuses this result.

Native experimental pause of Home's remaining CSS animation: GPU 0% in the sampled interval, Auralis remains visible and cached. This is a benchmark-only isolation, not an approved product change. Investigating the cost of continuous compositor movement before choosing an ambient presentation.

The old unfocused scenario did not actually move native focus (document.hasFocus and budget remained true). Its label is not valid focus-loss evidence. The harness now checks native foreground loss; the existing Tauri focus event overrides stale WebView document focus in the render budget. No GPU model detection.

Current lifecycle regression covers idle draws/coverage/uniforms, palette invalidation, hidden/minimized budget, focus, Welcome coverage, debounced resize, reduced motion, context loss/no resurrection/restoration and disposal. More browser/native regressions and final native Preview remain pending.

Sources: frame-budget-111/native-auralis1-baseline.json, native-auralis2-static.json, native-cache-experiments.json (in progress). Windows counters sum only matching adapter/physical-engine PIDs in the owned Preview tree; process GPU memory sums may count shared surfaces more than once. rAF timing is scheduling opportunity, not presented FPS.

Functional validation: auralis-resources.cjs, real WebGL auralis-lifecycle.js, auralis-runtime.js (cached navigation assertions), render-budget.js and tool-transitions.js pass. The broad motion.js runner still contains its previously documented .992 exit-scale expectation and a removed intro-tab warmup; it failed unchanged. The original transition report explicitly preserves these pre-existing failures without relaxing assertions. Native-focused verification failed on focus loss and is diagnostic only, never a valid focused Home result.

Cache/compositor sweep completed: paused Home animation + visible static Auralis0% GPU; continuous crossfade2/3/4 fields11.607/11.242/11.018%; single-canvas compositor transform9.974%. Retained idle fields themselves0%, but2/3/4 caches increased process dedicated-memory sum to131.1/137.4/143.6MB from107.3MB. No long tasks, max rAF gap8.2ms in these preparation/retention experiments. Counter intervals round short generation bursts to0%; this is not proof that generation has zero GPU cost. Field256/384/512 preparation produced no measured >33ms gap; visual resolution comparison remains manual/pending. Consequently none of the continuous compositor variants enters production.

Additional functional checks passed: processes.js --functional and progress-runtime.js (15,000 reports,8 visual paints, exact internal progress; minimized0 paints). Preview rebuild in progress.
