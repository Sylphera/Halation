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
   colours and fonts of the rendered page. No HTML, CSS or JS of the original is read or copied into the beta. Reused
   identity assets: Lucide icon SVGs, the Halation mark, the wordmark (as rendered) and the Inter typeface (OFL).
   **One exception** (Java, 2026-10-21): the original's Drape code (`app/dist/drape.js`) may be reused **only to record
   and modify the Drape** for the beta's backdrop. It runs only inside the recording tool (`slint/scripts/record-drape.js`),
   never in the beta; the beta ships the recorded frames and the grain tile, which are allowed as rendered assets.
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
| Drape drawn live by a WebGL shader | The same Drape recorded as a seamless 2-minute loop of 15 fps frames, scaled by Skia | No shader or per-pixel work at run time |
| Glass panels with `backdrop-filter: blur(20px)` | Same panels at 68 % opacity, no blur | Blur per frame is the costly part |
| Text copy that names engines | Copy that says what the beta does (drop zone, recent files, folders) | No engines connected |
| Settings > Storage per-folder list, codec list, folder list of `Documents\Halation` | Beta profile size and folders | The beta has its own profile only |
| Native select menus | Slint popup lists | Same function |
| Tool cards of varying height | Uniform cards, clipped | Simpler, cheap layout |

## Home backdrop: the recorded Drape

- **Source:** the latest original Drape (`main` at the "darker backgrounds" change, with the fixed banding on bright
  crests), recorded by `slint/scripts/record-drape.js` from a checkout of the original. The original code is used only
  there, as Java allowed.
- **Seamless, no cross-fade:** the recording copy makes the Drape's time periodic over 120 s. Every time-dependent
  noise lookup moves on a circle through the noise volume (the time axis plus a small offset across it) at the original
  speed, and the diagonal slide becomes a wide circle at the original speed; at t = 0 both start like the original.
  Measured: frame 120 s against frame 0 differs by 0.0001 of 255 on average (1 at most); neighbouring frames by 0.06
  (3 at most). What changes from the original: the slide turns slowly instead of always running along the diagonal.
- **How much it covers:** in 2 minutes the slide travels about 0.9 screen heights (half a 16:9 width) and the folds
  reshape by about two thirds of a fold, so the loop only repeats every 2 minutes.
- **Video (`assets/drape-loop.mp4`, 0.67 MB):** the 1800 frames (15 fps, the Drape's own field rate) of 320 × 180,
  rendered without the original's dither and read from the shader as **16-bit luma**, stored as **luma only** in H.264
  (x264 veryslow, CRF 16, full range), lifted so the dark field gets most of the codes:
  `y' = 255 × sqrt(min(1, luma / 80))`, rounded once from the 16-bit value. Each stored code is then at most 0.6 of a
  window level (0.2 to 0.4 in the dark field). Colour is restored per pixel from
  `drape-tint.bin` (the frames' average colour for each luma; mean error 0.5 level). A first try with colour JPEG
  frames (6.7 MB) showed blocks: 4:2:0 colour at 320 × 180 becomes large blocks once scaled to the window.
- **Banding:** two causes, both fixed. First, the frames were read back from the browser as 8-bit colour, so the
  dark field was already a stair of one-level plateaus; scaled six times to the window, each plateau edge is a band
  that no dither can remove (the original never has them: it computes in floating point and rounds once, at the
  window, after its dither). Hence the 16-bit luma above. Second, the window draws into 8 bits per channel and grain
  laid over an image already drawn cannot break its steps, so each decoded frame is scaled here, on the decoding
  thread, to the window's own size (at most 2560 × 1600) with the original's cubic B-spline in floating point,
  coloured by luma and dithered by one level per pixel before the one rounding to 8 bits; Skia then draws it 1:1. A
  first version scaled twice here (640 × 360) and let Skia do the rest: its dither, magnified three times, showed as
  little squares (Java, 2026-10-21). Checked on a frame made by the beta's own code, with the brightness multiplied
  by 5: no bands, no squares.
- **Grain:** the original's output dither and stationary film grain together, as a fixed 512 × 512 tile
  (`drape-grain.png`, signed: white adds, black takes away) at twice the original's default strength, laid over the
  scaled frame at the window's resolution; Home shows it at half opacity, the original's default. The recorder draws it
  over one even grey (a copy whose field is replaced): a first tile cut from a patch of the real Drape carried that
  patch's light and shade, so every repeat showed as a block. A standard Gaussian grain was tried in its place and
  showed the codec's small blocks more (Java, 2026-10-21). For now a slider on Home (preview only, not saved, 50 % at
  start) sets the opacity while Java chooses it.
- **Playback (`backdrop.rs`, `app.rs`):** Windows' own decoder (Media Foundation, no added weight) reads the video on
  a thread of its own; a 15 Hz timer asks it for the next frame, which comes back as Home's backdrop image. Only the
  frame on screen is held decoded. It runs only while Home is shown with motion on and the window is not minimized;
  with reduced motion, or if the video cannot play, Home shows `drape-still.jpg`. Slint cannot tell when the window is
  covered, so a covered but not minimized window keeps playing.

## Measured cost (KernelPanic, i5-12400F, release, Skia OpenGL, Home maximized at 1920 × 1009, 30 s)

| Home | Private working set | CPU |
|---|---|---|
| Still frame (loop off) | about 66 MB | 0.00 % |
| Recorded Drape playing | about 90 MB (peak 100) | about 0.9 % of all 12 threads (about 11 % of one) |

On disk the loop takes 0.67 MB beside the executable. The extra memory is mostly Media Foundation and its decoder;
the CPU is Skia redrawing the window 15 times a second plus the scaling and dither of each frame. Those figures
are from the version that scaled to 640 × 360 (1.5 ms a frame); scaling to the window takes 9.5 ms a frame at
1920 × 1009 (4.6 ms at 1280 × 680, 16.8 ms at 2560 × 1369), about 14 % of one thread at 15 fps, off the window's
thread, and is still to be measured in the running app. The decoding itself takes about 0.2 ms. Hover cost is not measured: no input is injected into Java's desktop.

## Assets beside the executable

Java (2026-10-21): assets ship apart from the exe; installer only, no portable. The mark, wordmark, drop outline,
icons, the Inter typeface, the Drape loop, its colour table, still frame and grain live in `assets\` next to the
executable and are loaded at start (`assets.rs`; Inter through Slint's run-time font collection). `build.rs` copies the
crate's `assets/` beside the executable of development builds. A missing file is logged and named in a notice at the
top of the window; the app still runs (icons stay blank, Home keeps its plain ground).

## Acceptance

1. Side by side with the original at 1920 × 1080, Home, rail (closed and open), top dock, Settings and Library match
   in layout, colour and type, except for the differences listed above.
2. No shader or blur; the only continuous work is the backdrop's 15 Hz playback on Home, which stops on other pages,
   when minimized and with reduced motion.
3. `tests/ui_layout.rs` keeps every fixed control inside the window from 960 × 600 to 1920 × 1080 and checks the rail.
4. fmt, strict Clippy, all tests and the release build pass.

## Out of scope

Tool pages, a Library like the original's (collections, filters, grid),
Spanish text, the original's per-folder storage list and its native select menus.
