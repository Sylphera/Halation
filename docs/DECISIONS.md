# Decisions

One line per decision in force and why. Add a line for every new decision; remove the ones that stop applying.

## Project

- Plain HTML/JS/CSS in `app/dist`, no framework or bundler: small app, instant load in WebView2, each file readable alone.
- One iframe per tool, shared services on `window.__hal` in the main window: tools stay isolated and only the main window talks to Tauri.
- Interface text only in `en.json`, Spanish on request: no half-translated strings while features move.
- `tests/host.js` replicates the Rust commands in Node: the whole interface is tested in headless Chromium on Linux.
- One `[build]` commit per task: every build publishes a pre-release; builds are expensive and releases must mean something.
- Pre-releases carry setup and portable exe; the setup installs over an older version: testers update without losing data.
- One code file per tool with named sections and a code map in `ARCHITECTURE.md` (Java, 2026-09-27): a thread goes straight to the file instead of exploring dozens of modules. Replaces the 400-line limit.
- The 2026-09-27 merge was done with rollup (comments kept, no tree-shaking) and nothing else changed; a name declared in two sections got the section as suffix.
- Pieces two tools share stay their own files: `grader.js` (Grade looks), `libpanel.js`, `spotify.js` (Node tests load it).
- Rust stays one module per area: most areas serve several tools and none held one tool's code in several files.
- Upward calls inside a tool go through an `up` registry: sections stay ordered lowest first.
- Helpers every page repeats live once in `common.js` (`window.__ui`); the main window is `shell.js` + `services.js`, sharing `window.__shell`.
- The NSIS template (`windows/installer.nsi`) is Tauri's template with marked changes, kept diffable against upstream.
- A module registry (`modules.js`) is the one list of tools (rail, frames, Home, shortcuts, Settings → Modules); turning a tool off keeps its frame loaded, so work survives.
- Settings → Storage counts only what Halation itself takes; presets, exports, downloads and fonts are listed apart; a tool found elsewhere on the PC is never removed.
- The Upscale engine and its models are separate components but share one "upscaler" progress event.

## Dependencies

- Tauri stays on 2.x until 3.0 is stable; Windows-only crates are checked with `cargo clippy --target x86_64-pc-windows-msvc`.
- ureq 3 with SChannel and a 60 s response timeout but no whole-body timeout: the FFmpeg download can take minutes.
- Downloads fail after 30 s without a chunk (`download.rs` `STALL`) with a Retry: ureq has no timeout between reads.
- tauri-plugin-updater ~2.10 (the newest that keeps Tauri 2.11): the plugin checks and verifies the signed setup; update.rs runs the setup itself so "Install on close" and the restart choose `/R`.
- rfd stays, tauri-plugin-dialog is not adopted: it wraps rfd and its blocking save dialog cannot run where the sync export commands run.
- Mediabunny (MPL-2.0) muxes the single-video MP4 export: mp4-muxer is deprecated; frames decode identical.
- WebM with alpha stays on FFmpeg, not Mediabunny + WebCodecs: the latter loses ~8 levels on average over any background.

## Motion

- Only `transform` and `opacity` animate; hover colours are instant: the compositor animates them without layout or paint.
- GSAP + Flip through `motion.js` (Java, 2026-09-29, replacing WAAPI): professional easing and Flip for layout changes; the
  API of `motion.js` did not change. The loops of the waits stay CSS so they keep turning while a page loads (docs/MOTION.md).
- Direction "superfluid UI, Apple-like" (Java, 2026-09-29, after the first animation pass): no loading screens (the WebGL
  wait scene, the orb, comet rings and busy veils were removed); transitions carry the feeling instead. One critically
  damped spring whose speed carries over when interrupted, a slower spring and depth (scale, blur) for changing place,
  a tool growing out of its dock icon, skeletons of the real layout until the content is there, press feedback on the
  first frame, menus and dialogs from their origin, a short fade with reduced motion (docs/MOTION.md).
- Tool names (Java, 2026-09-29), English only (es.json untouched): Audio Visualizer, Grade, Downloader, Image Upscale,
  Frame Capture (was Frame Grab), AI Interpolate (was Frame rate), Background Remover, Library, Settings.
  Only the names shown change: ids, files and the Presets/Exports folders keep their names.
- One curve (expo out) for everything that arrives or moves, a short ease-in for exits, a critically damped spring for
  switches and pills; the interface stays under 300 ms, only waits are longer.
- A new animation starts from the current state of the old one: fast repeated clicks never jump or end half-animated.
- Accordions use FLIP instead of animating height: height animation forces layout every frame.
- A view grows from the dock icon that opened it while the old one fades on top of nothing (`.view.leaving`, no clicks);
  the dock stays live during the switch.
- Visualizer and Grade switch tabs instantly: animating their container would composite a live canvas every frame.
- Removed list items fade out on a ghost: lists are rebuilt with `innerHTML`, so the real element is already gone.
- Segmented controls have one pill placed from the option's offsets, re-placed by a ResizeObserver; options wrap between words: fixed widths overflowed in long languages and client rects skewed inside a scaling dialog.
- Things that leave to uncover a heavy canvas (empty stage, recording tag) stay instant.
- Snapping guides fade in and leave at once: a lingering line points where the element no longer is.
- Rebrand, visual part (Java, 2026-09-29, prototype approved first): pure black window, `#050504` bubbles, greys in
  wide steps, a white filled primary button (one per view). After the first review the accents were muted rather than
  dropped: flat black and white read as unfinished, so a periwinkle leads (slider fill, switches, selection, focus,
  progress, the dock's marker) and the state colours stay, all desaturated; a pale blue lives only in the atmosphere.
  Grain is its own full-resolution layer: drawn inside the scaled-down atmosphere it showed squares and flickered. The dock is a static bubble: no
  magnification, its movement comes from the animation thread (GSAP), which is separate and later.
- Boxes never show a straight cut (Java): in any scrolling column a box that crosses the edge keeps its rounded
  frame at the edge and only its content moves; once past, it is gone. One scroll per column, no nested scrolling:
  the frame is a clip-path that follows the scroll (`common.js`), so it works in every page with no markup changes.
- Two backgrounds by design: Home is lit and moving (the accent of Home), the tools almost black and nearly still.
- Home has no search (Java, 2026-09-29): the tools are one small bar lit by the dock's pointer light; the line under
  the wordmark sells the experience, not the app (the person is already in it). The background
  stays the same silk; each launch shows a variant of it (turn, mirror, size, point in its drift), checked on the CPU to
  show about as much silk as the reference so no launch opens on a black window. Grain: the 8 s cross-fade read as
  static on a poor screen and per-frame noise as TV static; it now jumps 8 times a second and breathes over 1.8 s.
- Settings and the Library are one scrolling page under one box at the top, as wide as the sections, with the section
  tabs and the page's button (Java: an index beside the page looked bad for so few settings; floating pills let the
  page show above and around them). The sections slide under the box and are cut at its foot. The tabs scroll to a section and follow the scroll, rather than hiding the
  others: everything stays reachable by scrolling and a section is one click away. Restore defaults keeps the language, the artist name and links, and the tools turned
  on or off. Selection is the same everywhere: a count, Select all (what is shown), Clear, then the actions.
- Home's drop zone is the one place a file lands on Home (Java, 2026-09-30): centred under the tool bar, big, and an
  image asks where it goes inside the zone itself instead of a menu at the pointer; other views keep the window overlay and menu.
- The first start asks one thing, the artist name, the default everywhere, and can be skipped (Java, 2026-09-30). With a
  name, Halation searches the web for its profiles (YouTube, Spotify, Instagram, TikTok) and asks "Are these yours?",
  yes or no per profile; only a yes saves a link. It asks on its own only that once; afterwards Settings → Artist →
  "Search other sites" asks again. The links are kept for thumbnails that will fill them in later. The search is a
  public web search (Bing's RSS, then DuckDuckGo's HTML page): no account, key or service of our own, and Spotify only
  for its public artist page. "First start" is an app state with no settings saved, so people updating are not asked.
  They draw in a Worker so a transition never waits on the GPU (with SwiftShader, drawing on the main thread broke
  the 50 ms rule).
- The window keeps the native Windows title bar.

## Export

- Frames go as raw bytes over IPC into FFmpeg's stdin: no temporary files, no whole video in memory.
- One FFmpeg per output file with a 3-frame queue: files encode in parallel; one process with several inputs would need named pipes on Windows.
- FFmpeg arguments are built in `encoder.js`, process and cleanup in `encode.rs`: one format table for every tool; the path is checked in Rust.
- Straight alpha everywhere: `getImageData` gives straight colours and ProRes 4444, VP9 and PNG store straight, as CapCut, Resolve and Premiere expect.
- BT.709 limited range, tagged: FFmpeg's default BT.601 shifts colours in editors.
- ProRes 4444 by default, WebM as the small alternative, PNG as last resort: ProRes is near-lossless; VP9 4:2:0 loses chroma at sharp colour edges.
- Background and separate finish layers are always H.264: both are opaque, and ProRes of grain is ~1.2 Gbit/s at 1080p.
- Partial frames go as a rectangle, unchanged frames as "same": IPC drops to a fraction for cover and text layers.
- Vignette in the background layer, glow as a Normal layer with screen(background, glow), grain baked or as Overlay over 50 % grey, fades scale every layer: the composite equals the full render.
- Settings are frozen when an export starts (`frozenR`): later edits never reach it.
- Layers render on CPU canvases (`willReadFrequently`): every frame is read back, and GPU readback costs more than it saves.
- Size estimates use measured bits per pixel per layer (`layerBits`): one figure per format was off by up to 8× with grain.

## Downloader (Spotify)

- Spotify's audio is never requested: only public pages (track page and embed `__NEXT_DATA__`, oEmbed as fallback); no API, it needs an app key.
- Two yt-dlp searches at once (YouTube Music songs, `ytsearch5`), query: first artist and the cleaned title.
- Score 0.45 title + 0.25 artist + 0.30 length, halved for another version unless Spotify says so, +0.03 YouTube Music; under 60 % warns.
- "Original" is the AAC stream as M4A: it holds the cover without re-encoding. FFmpeg copies it with Spotify's tags; the untagged file stays if FFmpeg fails.

## Cutout and Crop

- SAM 2.1 Base+ (Meta, Apache-2.0) on ONNX Runtime Web 1.30.0 in a module worker (2026-10-06, Java; replaces BiRefNet, which never shipped, and U²-Net): one promptable segmentation for the whole app. Automatic, the wand and the brush of Remove Background are prompts to the same mask, and the Cutout service's mask is Automatic's answer. Chosen over BiRefNet / IS-Net because those make one mask per picture and do not take clicks; the typical pictures (Pinterest, Instagram, filters, grain) are recognised as objects, not by colour.
- `app/scripts/sam21-export.py` exports Meta's checkpoint with Meta's code (pinned commit) as two graphs, the split of Meta's image predictor: the encoder (1024 × 1024, run once per picture) and the decoder (points, the last answer's logits → four masks with scores, run per click). The prompt encoder is written out with the same arithmetic; every file is checked against the predictor. No community ONNX. `--install` copies the files into `Tools\cutout` to try them without a release. Hosted as assets of the `cutout-sam21-v1` release of Sylphera/Halation.
- Three files: the encoder in fp16 for WebGPU with `shader-f16`, in fp32 for WebGPU without it and for the CPU (graph optimisations off there, as before), and the decoder in fp32. On the CPU the encoder takes tens of seconds (37 s in the container) and each decode ~0.25 s; Automatic's grid is 4 × 4 there and 8 × 8 on a GPU.
- Automatic: a grid of single clicks, each answered with its best mask; masks that run along the top or a side (or cover most of the picture) are background, the rest subject (a subject may be cut by the bottom). Up to 8 + 8 of those points are decoded together as the proposal, which the user's clicks and strokes then refine.
- Remove's final pass needs no second model: when the subject takes a small part of the picture the crop around it is encoded on its own (more of the model's resolution on the edge), then a colour guided filter refines the edge on the picture, with the guide softened and eps above grain-level variance so film grain does not stick to the edge.
- The wasm is `ort-wasm-simd-threaded.asyncify.wasm` (the JSEP build hangs); bundle vendored, wasm and model downloadable; version pinned because `cutout.rs` downloads that exact wasm.
- WebGPU only when an adapter exists; CPU runs single-threaded: the window is not cross-origin isolated.
- Masks cached by SHA-256 of the picture in `Tools\cache\cutout`: the same picture never runs the model twice.
- A mask is a grey PNG at the original's size, and the dialog returns `edit`: later crops cut the mask too and reopening retouches the same mask.
- Crop parameters are fractions of the original with a −45…45° rotation, stored on the original in every tool: reopening edits the same crop at full quality.
- Crop is mandatory where a place demands a ratio; a picture within 0.5 % skips the dialog; cancelling places nothing.
- Grade's framing sliders became the Crop dialog (GPU `crop` pass); batches take the centred crop.
- Grade Cutout applies the mask at the end of the stack and exports PNG; the mask is not an undo step.
- Visualizer "Cover cutout" is bottom-aligned with "Pop-out" scale: from its base it reads as coming out of the frame.
- Upscale has a queue (upscale, cut out, or both) that Cutout batches use.
- Downloader "Cut out" saves "name (cutout).png" without a dialog: covers are square and plain.
- The Cutout dialog's colour background is remembered only while the app is open: a viewing aid, not part of the result.

## Frame Grab

- Frame Grab is its own tool; one FFmpeg extractor serves every tool that asks for a frame, so frames are the same pixels.
- The round trip between tools is `__hal.frameGrab({ video, from, dest })` (a tool asking for a frame) and "Send to…" with "and come back" (`__hal.sendTo`: the destination shows "Back to <origin>" in the header, Frame Grab keeps its own). A destination is listed only when it is on and has its required components; the item is the path or the bytes as they are, never re-encoded.
- Frame numbers shown start at 1, stored indices at 0.
- Scrubbers are a shared `common.js` component; existing tabs keep sliders with typed values.
- Typed slider values live once in `common.js` on each page's existing `<output>`, going back through the range's own events.
- Bytes from a tool cross to Tauri only in the main window (`writeFile`).
- Library metadata is the app state `library`; linked folders are read in place and polled every 2.5 s while shown; edits of read-only items go to "Edits".
- Packs are drawn locally when installed: no server, no licence.
- Thumbnails was removed (Java, 2026-09-28): the tool, its tests, `THUMBNAILS_SPEC.md` and its folder kinds are gone; what it shared (Crop, Cutout, the extractor, the Library) stays, described in `ARCHITECTURE.md` → Shared services. Files users already have in `Projects\Thumbnails`, `Exports\Thumbnails` or `Presets\Thumbnails` are left where they are.

## Grade looks

- Looks are data (`grade-looks.js`) compiled to one 33³ RGBA16F LUT plus finish passes (Java, 2026-10-13, docs/GRADE_LOOKS_SPEC.md): one engine, the catalogue grows without code.
- A tile click replaces the look, `+` stacks.
- The 38 classic looks of the first Grade are removed (Java, 2026-10-13: badly made). Saved work naming one opens with its closest catalogue look (`CLASSIC` in `grade-looks.js`), so it renders differently from before.
- The 8 look adjustments are shader uniforms, not part of the LUT: dragging builds and uploads nothing.
- Personal looks carry a copy of their definition (v2 file): retouching or removing a catalogue look never changes them.
- A published look never changes how it looks: a retouch raises `rev` and keeps the old one in `LEGACY_REVS`; `grade-looks-baseline.json` holds every LUT hash.
- Catalogue batches are approved by Java on contact sheets (`scripts/look-sheet.js`); every look passes `tests/grade-looks-quality.js`.
- Each category mixes subtle looks with a few creative ones (`intent.creative`, tag `cover`): aggressive design treatments for covers and thumbnails, never a single colour over the picture unless declared a duotone (Java, 2026-10-13).

## Testing

- Debug builds run `HALATION_SELFTEST` after load: `tests/realapp.py` drives the real IPC under Xvfb; release builds ignore it.
- Functional suites run with reduced motion; `motion.js` runs with animations on.
- Refactors are checked with `tests/baseline.js`: screenshots within 0.4 % of pixels over 24 levels, exports with identical frames.
- `verify.js` runs one Node file fewer than there are cores, one browser per slot: 4 at once pushed exports past their limits and a shared GPU process stalled an export.
- `motion.js` and `framegrab-perf.js` run last and alone: their limits are timings.
- Tests wait for conditions, not fixed times, except `motion.js`'s scenario pauses and warm-ups before a measurement.
- Fixtures are made once per run: FFmpeg's unseeded `gradients` picks random colours.
- A passed check is skipped while the hash of what it reads is unchanged; the hash includes `$SHOTS`.
