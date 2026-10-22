# Status

Updated 2026-10-22. One page at most; if it goes two weeks without an update, delete it rather than trust it.

- **Halation Tauri 1.2.0** is the published app, on `main`.
- **Halation Slint** (`slint/native`): Home and Settings run natively (the Library page is out of the sidebar for now);
  no media tools or engines yet. Home's Drape loop, grain and visual replica are approved by Java (2026-10-21).
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
- **Next**: decide the remaining Home memory (the video pipeline dominates: Media Foundation's decoder and the frame
  buffers; a software-decode or lazy-player spike is the cheap test), then the first tool end-to-end (Converter is the
  proposed pilot: shared spine, Library selection, job, process, output, destination), then A2, D and C, then the
  cut-over of `slint/native` to `main`.
