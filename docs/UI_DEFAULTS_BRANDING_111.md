# Slider reset and branding — Halation 1.1.1

## Slider behavior

`app/dist/common.js` owns `rangeDefault` and `resetRange`. A native range declares
its existing product default with `data-def`, independently of its current or
saved value. Double-clicking the range or thumb restores that default through the
existing min/max/step normalization and emits one bubbling `input`/`change` pair.
Disabled controls, including disabled fieldsets, cannot reset.

There is no default marker, pointer detent, hysteresis or initialization observer.
Native dragging and keyboard adjustment remain unchanged. Numeric entry and
label scrubbing keep their existing precision. The shared comparison component
also restores its divider to the center on double-click.

Grade and Visualizer declare defaults from their existing schemas. Static ranges
declare their existing initial defaults. The Cutout brush declares its default
when opening an image because it depends on source dimensions. Vocal Remover
lanes declare the existing 0 dB default in both separation modes. Seekers and
timelines represent transport positions and have no reset default.

Pointer focus does not paint a rectangle around the slider. Keyboard focus uses
a neutral thumb indicator; other controls retain neutral `:focus-visible` styling.
The input modality is shared between the shell and tool frames.

## Visualizer empty state

The empty state uses `audio-lines` from the shared `icons.js` catalog, exactly as
the navigation does, inside the same `.big` wrapper used by other tool empty
states. It does not contain Halation branding or a separate hand-drawn icon.

## Logo source and icon pipeline

Since 2026-10-22 (Java) the logo is a hand-drawn vector stroke:
`docs/brand/source/halation-mark.svg`, one continuous white line with round
caps (a rise, a crest, a dip and a rise) turned −18°, in a square 66-unit
viewBox. It replaces the raster mark extracted from `halation.logo.png`, which
was retired. It was drawn in code, not generated, so the artwork is the
project's own.

`app/scripts/icons.js` copies the source as `halation-mark.svg` (the transparent
UI mark used by Home, Welcome, About, the Home tab and module fallbacks) and
rasterises it to the 512 × 512 `halation-mark-source.png` for the README
scripts. The UI wordmark remains separate.

`halation-app-icon.svg` puts the mark on a flat `#111111` rounded square
(rx 228 of 1024, the surface grey of the interface) with the earlier 8% white
hairline, centred and spanning 62% of the square. Every raster size renders
directly from this master rather than from an already resized icon.

The pipeline generates the application PNG sizes, the multi-size ICO files,
favicon and Windows identity assets. `halation-mark.png` and `.ico` in the Tauri
icons folder retain their compatibility filenames for the native window and
installer; their artwork is the square app icon, not the transparent UI mark.

Regeneration uses `npm run icons` from `app`, with Playwright available in the
global Node module directory and `CHROME` pointing to Chromium where needed.

## Validation already performed

- `slider-defaults.js`: default normalization, exact reset events, disabled
  controls, real mouse dragging without snap, keyboard and number entry at DPR
  1/2; 117 default-bearing native instances across tools/shared dialogs; saved
  values, reload and session capture/restore; comparison-divider reset.
- `slider-stems.js`: reset and precision in Vocal Remover's two/four lane modes.
- `focus-defaults.js`: real mouse and keyboard behavior in Home, Visualizer,
  Grade and RemoveBG. Native thumb paint is reviewed visually in Preview because
  Chromium does not expose it through computed-style inspection.
- `brand-assets.js`: PNG/ICO formats, transparent mark versus square icon,
  proportions/centering, Home/Welcome image loading and exact shared Visualizer
  icon paths.
- `editor.js --functional` and `sessions-runtime.js`: numeric editing and
  persistence/coordinator regressions.
- Preview 1.1.1: native double-click reset in Visualizer, Grade and RemoveBG;
  marker and snap infrastructure absent; 22 embedded performance JS/CSS assets
  verified against the worktree. Rust source and the final performance commits
  remain intact.

These checks and the Preview build preceded repository integration. Saving and
integrating this state does not require another build or installer generation.

## README hero

`docs/brand/readme-hero.jpg` (1600 × 640 at 2×) is the README header in both repositories: the transparent mark
and the UI wordmark, with a warm halation fringe, over a tilted and darkened mosaic of the README screenshots
(Home is left out because it repeats the mark). `node app/scripts/readme-hero.js` regenerates it from
`docs/screenshots`, so it runs after `npm run shots`. The public repository receives the same JPEG and screenshots.

The README header continues with the tagline, one primary button (Download for Windows) and three secondary pills
(Changelog, Privacy, License) rendered by `node app/scripts/readme-buttons.js` into `docs/brand/readme/`, then one row
of shields.io badges in the app's colours. The release and downloads badges read GitHub live, so a new release needs
no README edit. `node app/scripts/readme-showcase.js` renders two images after `npm run shots`: `promo.jpg`, the top
of the screenshot table, with four tool windows stacked in perspective under a light beam beside a numbered list of what
the workspace shares (Home, Send to…, Cutout and Crop, Library, presets, GPU or CPU, engines on demand, updates,
local), and `showcase.jpg`, every tool as a card, at the top of Features. Each showcase card is a crop of the tool's screenshot: `shots.js` records the main panel of every tool in
`docs/screenshots/panels.json` (CSS pixels of the 1600 × 1000 capture), and a tool whose panel is too large or too
empty for a card sets its own `box` in the script's `TOOLS` table (the media plus the controls that act on it).

The video tools are captured with real night footage from Coverr (free licence) kept in `docs/examples/clip-*.mp4`:
Frame Capture and AI Interpolate. The other tools use one Unsplash photo each (`docs/examples/<tool>.jpg`); Upscale is
captured in image mode. `docs/examples/CREDITS.md` lists the sources.
Grade applies `docs/examples/grade-look.json`, whose filters (Pop Art, Instant Warm) come from the looks catalogue of
`claude/grade-looks-spec-6vejsj`; the current `grade.jpg` screenshot was captured from that branch, and on a branch
without the catalogue the two filters are dropped.
