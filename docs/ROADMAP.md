# Roadmap

Parked ideas only, with a line on how each fits what exists.

- A halation (red film glow) pass for the Visualizer finish: the export spec mentions it, but the Visualizer has no such effect today (Grade does).
- Layer export for the export queue (several songs in layers).
- Single-video export through FFmpeg too (one code path, 10-bit/ProRes masters), keeping WebCodecs as the fast default.
- Sending only changed tiles instead of a bounding rectangle, to cut IPC further for the cover layer.
- Hardware encoders in FFmpeg (NVENC/QSV/AMF) for the opaque background layer.
- GPU-side readback (WebGL `readPixels` into a PBO) if CPU canvases become the bottleneck at 4K.
- Intro (out of scope in v1, `docs/INTRO_SPEC.md` §13): a real 3D camera, particles, a curve editor or manual keyframes, a stroke that follows the glyph's real outline, a holographic material, text on a path.
- Downloader: Spotify albums and playlists (today only their cover): each song through the same search, in the queue.
  Fit: `spotify.js` `fetchMeta` reads one track; an album needs its track list (embed page `trackList`) and one
  search per song, which is slow with yt-dlp full entries (a few seconds per song).
- Intro: Grade looks of the user ("My looks") and the look's effects (grain, blur…) in the global finish; today only the colour of the included looks.
- Cutout: BiRefNet (better edges, MIT) as a second, larger model to choose in Settings → Modules; WebAssembly
  threads (needs the window cross-origin isolated) for the CPU path.
- Intro: a complete redesign (Java, 2026-09-28), to be specified before any work.
- Grade looks v2, parked from docs/GRADE_LOOKS_SPEC.md §10: import/export of looks and third-party `.cube` files (the definition already has a `lut` slot the engine does not read yet); an editor for a look's curves and bands; Grade favourites synced with the Library star.
- Code signing (Authenticode) through SignPath Foundation, once the project has reputation (downloads, stars). Fit: everything is ready in `docs/SIGNING.md` (application answers, README section) and `docs/signing/build-signpath.patch` (CI); `build.yml` is untouched.
- Halation nativa (Rust + Slint + Skia, 2026-10-20): beta A–E en el crate `slint/`, especificación canónica en `docs/SLINT_SPEC.md`; pendiente revisión visual manual y roadmap posterior de servicios/motores.
- Motion Text (Java, 2026-10-14): la herramienta se eliminó; `docs/MOTION_TEXT_SPEC.md` queda como base para una idea nueva, por especificar.
