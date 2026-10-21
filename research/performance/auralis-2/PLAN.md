> 2026-10-12 — product correction: the static candidate below was rejected as product behavior. It is retained ONLY as a GPU measurement control. Focused visible Home must remain organically animated. Continuous fullscreen compositor crossfades/transforms are also rejected by measured cost. Animated tiny-field/direct, two-field interpolation and noise-lookup experiments are in progress; visual acceptance remains manual. Historical results below remain unchanged.

# Auralis 2 — measured architecture experiment

Base: task/performance-111, edf8a82, unpublished1.1.1. No grain, no merge/push.

1. Archive the current optimized assets and run the same native PDH/frame/resource protocol before replacement.
2. Minimal single-field event-driven renderer: one invalidation-driven task, cached field/final dither, no procedural idle clock.
3. Measure its GPU and lifecycle; retain the last valid result across navigation and debounced resize.
4. Compare compositor movement and2/3/4 cached states separately. A compositor animation is not free; keep it only if native GPU/frame evidence supports it.
5. Extend context-loss/disposal/resource regressions, native focus/minimize/resize and reduced motion.
6. Build and leave the actual Preview open for explicit visual review. Prior no-grain approval does not approve a new motion architecture.

One common engine varies field resolution/cache parameters. No GPU model detection. Atmosphere and tool/export/session logic are outside this architecture change.

Current pre-change snapshot: root .tools/performance111-auralis1/dist (not a worktree). Measurements are in docs/performance/frame-budget-111/native-auralis1-baseline.json and raw GPU JSONL; content hashes identify the served assets.
The old incomplete full-suite run contains three failed synthetic Blob workers. These phases were repeated successfully in native-workers-before after fixing the benchmark wrapper; real FFmpeg phases were unaffected.
