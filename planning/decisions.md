# Decisions

One line per decision in force and why, with its date when known. Add a line for every new decision; a decision that
stops applying is removed here (the Tauri app's own decisions are in [archive/tauri/decisions.md](../archive/tauri/decisions.md)).

## Product

- Interface text is English; Spanish only on request: no half-translated strings while features move.
- Releases carry the NSIS setup only (Java, 2026-10-13: no portable exe); the setup installs over an older version without losing data.
- The logo is a hand-drawn vector stroke, white on a `#111111` square for the window icon (Java, 2026-10-22; `docs/media/brand/source/halation-mark.svg`, `tools/render-brand.js`): drawn in code so the artwork is the project's own; images from generators whose terms keep ownership (Recraft's free plan) are not used for the brand.
- Home's background is called Drape (Java, 2026-10-14): Auralis is the name of the unlicensed component it was rewritten from; the old name stays only in history (`CHANGELOG.md`, `research/performance/`) and provenance notes.

## Repository and process

- Two lines (Java, 2026-10-21): Halation Tauri is `main`, untouched except for its own fixes while it is what ships;
  Halation Slint is `slint/native`, restructured as a Cargo workspace. The old code is read from Git and tags
  (`v1.2.0`, later `tauri-final`), never duplicated in the new tree.
- Nothing merges into `main` without Java's explicit approval, the cut-over included (Java, 2026-10-21). For this line
  it replaces the older rule that agents squash-merge to `main` once CI is green.
- One place for agent instructions (Java, 2026-10-21): `AGENTS.md`; `CLAUDE.md` only imports it.
- Folders exist only when they have content (Java, 2026-10-21): `docs/` how Halation works, `planning/` what is meant to
  change and why, `research/` what was measured, `archive/` what stopped applying.
- A feature's state comes from tests and reviews, not from a path existing (Java, 2026-10-21): CI checks paths, links
  and `Status:` lines; "implemented and verified" needs linked evidence.

## Downloader (Spotify)

- Spotify's audio is never requested: only public pages (track page and embed `__NEXT_DATA__`, oEmbed as fallback); no API, it needs an app key.
- Two yt-dlp searches at once (YouTube Music songs, `ytsearch5`), query: first artist and the cleaned title.
- Score 0.45 title + 0.25 artist + 0.30 length, halved for another version unless Spotify says so, +0.03 YouTube Music; under 60 % warns.
- "Original" is the AAC stream as M4A: it holds the cover without re-encoding. FFmpeg copies it with Spotify's tags; the untagged file stays if FFmpeg fails.

## Slint beta renderer

- Reference metric for the beta is private resident memory (`WorkingSetPrivate`), measured on Home, with total working set and commit reported next to it and never alone (Java, 2026-10-20): a single favourable counter would make the app look lighter than it is.
- Renderer (Java, 2026-10-22): Skia over **desktop OpenGL** (`require_opengl()`), not Direct3D 12. It measured 49.7 MB private on the reference Home scene and about 90 MB with the recorded Drape at 1920 × 1009 ([SLINT_VISUAL_SYSTEM.md](../docs/SLINT_VISUAL_SYSTEM.md)), against 122.4 MB for Direct3D 12. The first beta was built on Slint's Windows default D3D12 by mistake (165.6 MB private at 1936 × 1048); the build now enables `skia-opengl` by default. The OpenGL window is pending visual review. Virtual machines and PCs without an OpenGL driver are out of scope (Java, 2026-10-20).
- Slint's default Skia OpenGL context (GLES 3.0) does not draw stroked `Path` elements with more than one segment or any arc on the AMD driver tested (`atio6axx.dll`); closed filled shapes, single-segment lines and PNGs do draw. Requesting desktop OpenGL draws every icon, antialiased, with no change to `icons.slint`; `anti-alias: false` also works but is jagged. Not checked on other GPU vendors.
- Icons stay one stroked `Path` per icon in `ui/icons.slint` (viewbox 24, stroke 1.7): no per-driver adjustments, no SVG (it would need Slint's `svg` feature and its memory).

## Source boundary (native beta)

- The Rust backend is kept and may be imported into the native crate; only the visual layer (Slint and its Rust glue) stays clean-room (Java, 2026-10-21): the backend holds validated behaviour worth reusing, the interface is what is being redesigned.
- Imported backend modules never carry `tauri::*`: a module coupled to Tauri gets its own interface; no path dependencies or FFI towards `app/src-tauri`, so both apps keep building on their own.

- Assets ship apart from the executable, in `assets\` beside it (Java, 2026-10-21; installer only, no portable): images, icons, the Inter typeface and Home's backdrop are files the installer places, loaded at start; a missing one is reported, not fatal.
- Home's backdrop is the original Drape recorded as a seamless 2-minute loop (Java, 2026-10-21): the recording tool may run the original `drape.js`, the beta only plays the result. Luma-only H.264 recorded from 16-bit luma with a lifted curve plus a colour table (0.67 MB, no colour blocks, no plateaus), decoded by Media Foundation (Windows' own decoder, no added weight), scaled to the window's size with a cubic B-spline and dithered in Rust, so the 8-bit window shows neither bands nor squares.
- Home's grain is a standard static Gaussian grain drawn at 10 % (Java, 2026-10-21), generated at start: the original's own grain was tried and dropped.
