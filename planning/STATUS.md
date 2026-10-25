# Status

Updated 2026-10-25. One page at most; if it goes two weeks without an update, delete it rather than trust it.

- **Halation Tauri 1.2.0** is the published app, on `main`.
- **A2 architecture/docs (2026-10-25, isolated proposal):** `slint/dev-workflow` now has [architecture](../docs/architecture/overview.md), [persistence](../docs/architecture/persistence.md), [distribution](../docs/architecture/distribution.md), [design](../docs/design/design.md), a [real-code project guide](../docs/development/PROJECT_GUIDE.md), a [feature index](../docs/features/README.md) and consistency checks. **Not yet merged or released.** Milestones C/D remain pending and product acceptance is separate.
- **Halation Slint** (`slint/native`): Home and Settings run natively (Library stays removed); the first media tool,
  Converter, is approved and merged through PR #30. Home's approved appearance is unchanged.
- **Approved** (Java, 2026-10-22): everything the native beta built from `42cb9ca` contains: the UI redesign,
  material and type, Silver/Gold themes with the accent hue, motion and the logo.
- **Renderer** (Java, 2026-10-22): Skia over desktop OpenGL is the shipping path and was reviewed. The first beta had
  been built on Slint's Windows default D3D12 (165.6 MB private on Home at 1936 × 1048); the build now enables
  `skia-opengl` by default. At 1280 × 800 the renderer alone is 28.7 MB private; Home is 122.0 MB with the loop,
  of which about 43 MB is Media Foundation's decoder open and about 21 MB the frame buffers.
- **Approved** (Java, 2026-10-22): Home's drop-zone pointer light, in build `f7211e8` (desktop OpenGL).
- **Done** (2026-10-21, pending Java's review): [repository reorganization](active/repo-reorg.md) milestones 0, A1
  (instructions and documents) and B (Cargo workspace `halation-core` + `halation-app`, `assets/`, `tools/`, CI).
- **Done**: the [UI redesign](active/ui-redesign.md), implemented and approved by Java on 2026-10-22 (Home and Settings).
- **Pending merge**: PR #27 (motion), #28 (material and themes) and #29 (logo), stacked, onto `slint/native`.
- **Approved** (Java, 2026-10-22, on 8179b05): the [complete media Converter](active/converter-native.md), with
  audio/video, FFmpeg installation and the audio and video preview. PR #30 also carries the commits of #28 and #29. Library stays removed.
- **Home memory accepted** (Java, 2026-10-22): no further decoder or lazy-player spike.
- **Next on this isolated branch**: review A2 architecture and automatic agent gates before integration; separately continue tool implementations. Milestones D and C require their own safe development and real upgrade validation before any approved native cut-over to `main`.
