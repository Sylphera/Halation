# Native beta visual system (Slint)

Status: replica of the original Halation (Java, 2026-10-21: "que la aplicación se vea exactamente igual al halation
original … mismos settings, se quita jobs, mismo home; desde ahí podremos empezar a iterar"). Implemented, pending
Java's visual review. Annex of `docs/SLINT_SPEC.md`, which keeps architecture, services and gates. It replaces the
first pass of this file (a launcher redesign, approved only as a starting point and then superseded).

## Principles

1. **Look like the original.** Same Home, rail, top dock, Settings and Library frame, within what Slint and Skia
   draw. Jobs has no page (its queue stays in the backend).
2. **Clean-room.** The reference is only the original's rendered result: its frontend from `main` rendered over the
   mocked backend in headless Chromium at 1920 × 1080 and 1280 × 800, measured from the pixels and the computed boxes,
   colours and fonts of the rendered page. No HTML, CSS or JS of the original is read or copied. Reused identity assets:
   Lucide icon SVGs, the Halation mark, the wordmark (as rendered) and the Inter typeface (OFL).
3. **As cheap as possible** (Java, 2026-10-21): the original was heavy because of its renderer and costly animations.
   Here nothing runs at rest: no timer, shader, blur, drop shadow or continuous animation. Motion is native Slint
   `animate` on colour, opacity, position and size, only while something changes (hover, rail opening, toggles).

## Measured layout (1920 × 1080; 1280 × 800 checked too)

- **Ground:** `#070707`, `#0b0b0c` at the top on pages other than Home. Panels `#111111` with a 1 px
  `rgba(255,255,250,0.11)` border and a 1 px top sheen; raised items `#242424`; fields `#080808` with a `#3d3d39`
  border. Text `#f5f5f2`, secondary `#b5b5af`, tertiary `#9a9993`; accent lavender `#a3a8dc`; activity `#82b5d6`.
- **Type:** Inter. Section titles 13.5 px / 600, body 12.5 px, small 12 px, Home strip labels 10.5 px / 500.
- **Rail:** floating at x 22, 62 px wide, radius 26, height `min(800, window − 90)` and centred. 44 px items with
  4 px gaps and 10 px divider margins at 800 px; both shrink with the window, items too below 726 px. Groups: mark |
  Downloader, Converter | Vocal Remover, Audio Visualizer | Grade, Cover Test, Background Remover, Upscale | AI
  Interpolate, Frame Capture | Library | Settings | open/close. Active item: raised fill and a 3 × 18 px accent bar on
  the rail edge. Closed items show a white tooltip pill on hover. **Open** ("the dock"): 232 px wide, full height,
  labels at 13.5 px; pages move right with it.
- **Top dock:** 184 × 32 at the top right, radius 14: activity dot, keyboard shortcuts, Halation folder, language,
  save session.
- **Home:** content centred right of the rail. Mark 176 × 87 at `window/2 − 259`; wordmark 241 × 26 at +113; tagline at
  +153; tool strip (all tools, 62 px tall, radius 18) at +202. Drop zone 640 × 150 (radius 24, dashed border) and
  recent files bar 593 × 55 (radius 22) anchored 70 px above the bottom.
- **Settings:** page title at the top left (26 px icon box + name); 880 px column with a fixed tab bar (General,
  Interface, You, Files, Processing, Tools, Storage, About, search, Restore defaults) over sections that scroll; a tab
  jumps to its section and follows the scroll. Each section is a panel with its rows, selects (260 × 34), switches
  (34 × 20) and an "Advanced" disclosure.
- **Library:** same page title and tab bar frame (References, Sections, Add), search field and list panel.

## What the beta does with each control

- Every Settings value is stored in the beta's own `settings.json` (`settings.rs`, additive fields with defaults;
  older files load). Real effects today: reduce animations, show processes dock, dock mode (keep open opens the
  rail), open the window (maximized or full screen; "as I left it" opens maximized until the size is stored), tools
  turned off leave the rail and Home, Settings search jumps to a section, folder buttons open the beta profile's
  folders, Restore defaults.
- Stored only, no engine yet: language (Spanish is saved, the beta is English), notifications, artist and links,
  save location, name templates, processing and job counts, workspace budget, updates.
- Buttons with nothing behind them in the beta (Install, Update engine, test notification, search other sites,
  check for updates, changelog, keyboard shortcuts, language, save session) show an honest notice at the top.

## Differences from the original

| Original | Here | Why |
|---|---|---|
| Animated "Auralis/Drape" silk on Home | Static silk computed once in Rust (`atmosphere.rs`, 800 × 450, dithered, scaled smoothly) | No per-frame cost; see the plan below |
| Glass panels with `backdrop-filter: blur(20px)` | Same panels at 68 % opacity, no blur | Blur per frame is the costly part |
| Text copy that names engines | Copy that says what the beta does (drop zone, recent files, folders) | No engines connected |
| Settings > Storage per-folder list, codec list, folder list of `Documents\Halation` | Beta profile size and folders | The beta has its own profile only |
| Native select menus | Slint popup lists | Same function |
| Tool cards of varying height | Uniform cards, clipped | Simpler, cheap layout |

## Animated background, later (not in this pass)

Preferred option (Java, 2026-10-21): a **pre-rendered loop of the silk at about 320 px wide and 15 fps**, scaled to the
window, with a **fixed grain texture** on top (the original's grain was a static image, so it does not move). Notes:

- Decoding 320 px video costs very little CPU; drawing it scaled is one texture blit per frame in Skia.
- It needs a codec: two minutes of raw RGBA frames at 320 × 180 are about 800 MB. Options: Media Foundation on Windows
  (no new dependency beyond `windows`), a small pure-Rust decoder crate, or a shorter loop (a few seconds of frames
  at low resolution fit in a few MB).
- To hide the 15 fps steps, blend each pair of neighbouring frames (cross-fade) when presenting.
- Pause the loop while the window is minimized or covered, and with reduced motion.
- Slint has no custom shaders: the grain is a tiled noise image laid over the backdrop, drawn once.

Fallbacks, cheapest first: (c) two or three baked silk images cross-faded or drifted very slowly with `animate`;
(b) a short sequence of pre-rendered low-resolution frames held in memory; (a) a real video loop with a decoder, as
above.

## Measured cost (KernelPanic, release, Skia OpenGL, Home maximized at 1920 × 1009, idle 30 s)

Private working set about 55 MB (peak 66 MB), commit about 198 MB, CPU 0.00 % at rest. The earlier shell measured
about 50 MB. Hover cost is not measured: no input is injected into Java's desktop.

## Acceptance

1. Side by side with the original at 1920 × 1080, Home, rail (closed and open), top dock, Settings and Library match
   in layout, colour and type, except for the differences listed above.
2. No timer, shader, blur or continuous animation; idle CPU stays at 0 % on Home.
3. `tests/ui_layout.rs` keeps every fixed control inside the window from 960 × 600 to 1920 × 1080 and checks the rail.
4. fmt, strict Clippy, all tests and the release build pass.

## Out of scope

The animated background (planned above), tool pages, a Library like the original's (collections, filters, grid),
Spanish text, the original's per-folder storage list and its native select menus.
