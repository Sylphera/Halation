# Tool pages in the tool frame

Status: Draft for Java's review (2026-10-23). Light spec: one section per dock tool, mapped onto the tool frame of
[ui-redesign.md §9](ui-redesign.md#9-screens) (left panel, canvas, docked bar, inspector, top-bar page actions). Each
tool is detailed further in its own thread when it gets its engine; this file fixes the layout and the defaults so
those threads start from the same frame.

Sources: the Tauri interface on `main` (`app/dist/<tool>.html`, `<tool>.js`, `locales/en.json`) and the feature docs
in `docs/features/`. Defaults marked *(proposed)* are not in the Tauri version and need Java's call.

Common to every tool (not repeated below):

- One primary action in the top bar (white fill); Cancel sits next to it while a job runs.
- Empty state: the canvas shows the drop line (Home's style) with Browse; the left panel is empty.
- Engines missing: the inspector's first section is the component card (name, size, Install with progress); the
  primary action stays disabled until it is installed.
- Running work: progress strip above the docked bar and an entry in Activity. Results: Reveal and Send to… in the
  inspector's Output tab once done.
- Save location follows the global policy (`docs/features/save-location.md`); tools only show it, never override it.

## Converter

Done: [converter-native.md](converter-native.md).

## Downloader

| Frame | Content |
|---|---|
| Top bar | Download (primary) |
| Left panel | Tab Queue: rows of links added (thumbnail, title, kind, status ✓ / % / ○); open downloads folder at its foot |
| Canvas | Link field (paste button, Enter adds) on top; below it the preview of the resolved link: thumbnail, title, author, chips (duration, source). A playlist or album shows its track list with checkboxes and Select all |
| Docked bar | None (no transport); the selection count for albums |
| Inspector | Tab Get: Kind (segmented Audio / Video / Cover), Audio format (Original / MP3), Video quality; tab Sources (Spotify only: which YouTube match is used, with a note) |

Defaults: Kind Audio, Audio format Original, Video quality 1080p (options Best, 2160, 1440, 1080, 720, 480, 360), whole
album selected. First use shows the terms notice once.

Acceptance:
- A pasted single link resolves to a preview and downloads with one press of Download; an album downloads only the
  checked tracks.
- Spotify links use public metadata only and fetch the audio from YouTube; the chosen source is visible in Sources.
- A failed track marks its row and does not stop the rest of the queue.

## Vocal Remover

Reference tool already mapped in [ui-redesign.md §9](ui-redesign.md#9-screens) ("Reference tool: Vocal Remover");
behaviour in [docs/features/vocal-remover.md](../../docs/features/vocal-remover.md).

## Audio Visualizer

| Frame | Content |
|---|---|
| Top bar | Export (primary) |
| Left panel | Tabs Inputs (Audio, Cover with From Library / Crop / Cut) and Queue (audio + cover pairs, Run queue, Clear) |
| Canvas | Live preview at the output aspect, format badge; empty state asks for an audio file |
| Docked bar | Play, seek with in/out marks, time, volume, fullscreen; bass meter at the right |
| Inspector | Tab Look: sections Presets (thumbnail grid), Background, Cover, Spinning icon, Text, Bass reaction, Finish; tab Output: format, resolution, frame rate, Use default, spec line |

Defaults: 1920 × 1080, 30 fps *(proposed: keep whatever `vis.js` uses as `useDefault`)*, volume 0.8, first preset
selected, export range = whole song unless in/out are set.

Acceptance:
- Changing any Look control updates the playing preview without restarting playback.
- Export renders exactly the in/out range at the Output settings, and the result matches the preview frame for frame.
- A queue of N audio + cover pairs exports N files with the current Look, one after another.

## Grade

Spec: [docs/features/grade-looks.md](../../docs/features/grade-looks.md). Frame mapping: left panel Layers / Looks,
canvas with before/after, docked bar transport and zoom, inspector Adjust / Output, Export in the top bar (this is the
§9 diagram itself).

## Cover Test

Spec: [docs/features/cover-test.md](../../docs/features/cover-test.md). Frame mapping: left panel the covers being
compared, canvas the mock placements, inspector the placement and background options; no primary export beyond
Save image.

## Background Remover

Behaviour: [docs/features/remove-background.md](../../docs/features/remove-background.md).

| Frame | Content |
|---|---|
| Top bar | Save (primary); Undo / Redo |
| Left panel | Optional: Queue of images (collapsed by default with one image) |
| Canvas | The image with the matte over a checkerboard; hold to see before, Mask view toggle; brush ring follows the pointer |
| Docked bar | Mode (segmented Auto / Wand / Brush), Hold to compare, Mask, zoom and Fit |
| Inspector | Tab Cut: tool section for the mode (Auto: Detect; Brush: Foreground / Background, Size), Refine (Intensity, Threshold, Feather, Shift, Clean, Islands), Remove and Clear selection; tab Output: background (transparent, swatches, colour), format, mask only, Crop, Send to… |

Defaults: mode Auto, brush size 60, intensity 50, threshold 50, feather 1, shift 0, clean 50, islands 0.2, background
transparent, format PNG.

Acceptance:
- Auto produces a matte on load without any click; Brush corrections are undoable step by step.
- Refine sliders update the matte live; Save writes exactly what the canvas shows (or the mask alone when chosen).
- Large images keep the Cutout model's limits and say so instead of failing silently.

## Upscale

| Frame | Content |
|---|---|
| Top bar | Upscale (primary) |
| Left panel | Tab Queue: inputs with status; segmented Image / Video at the top of the panel |
| Canvas | Before/after split with draggable divider and zoom (after the run); before that the input alone |
| Docked bar | Zoom, Fit, fullscreen; for video, transport and time |
| Inspector | Tab Upscale: Engine card, Scale (2× / 4×), Type (Photo, Art, Sharp, Fast as selectable cards with their note and licence line), input info with Crop / Uncrop / Change; tab Output: format, Cut background after (chain), Send to… |

Defaults: image scale 4×, video scale 2×, type Photo, format PNG, chain cut off.

Acceptance:
- The compare divider works at any zoom and shows the same region in before and after.
- Scale and type are remembered per media kind; an invalid stored scale falls back to the default.
- Cancel stops the engine and leaves no partial output file.

## AI Interpolate

Behaviour: [docs/features/framerate.md](../../docs/features/framerate.md).

| Frame | Content |
|---|---|
| Top bar | Run (primary); Preview as a secondary button next to it |
| Left panel | None in v1 (single input); collapsed |
| Canvas | Input video; after Preview, before/after pair side by side; Keep mask painted over the still |
| Docked bar | Play, scrub, time, playback speeds, fullscreen |
| Inspector | Tab Interpolate: Engine card, Frame rate (target fps), Quality (Standard / High) with its note, plan line (frames to generate, estimate); section Keep (brush size, Paint, Clear mask); tab Output: result fps, name, Send to… |

Defaults: target 60 fps (options 30, 48, 50, 60, 90, 120, 144), quality Standard, brush 8, no keep mask.

Acceptance:
- Preview renders a short segment and plays it against the original at the same position.
- The plan line updates with fps and quality before running.
- Areas painted in Keep are copied from the source frames, not interpolated.

## Frame Capture

| Frame | Content |
|---|---|
| Top bar | Capture (primary, label shows the count: "Capture 3") |
| Left panel | Tab Queue: added frames as thumbnails with time, Select all / none |
| Canvas | The video frame with the crop frame for the chosen layout; frame badge; empty state with Open |
| Docked bar | Previous / Play / Next frame, time and frame number, mute and volume, Sharp, Add frame; timeline strip with ticks for queued frames above it |
| Inspector | Tab Capture: Layout (16:9, 9:16, 1:1, 4:5, Original), crop per layout; Where the frame goes (Back to the tool that opened it, Send to…, Library, Image) |

Defaults: layout 16:9, destination Image when opened directly and Back to {tool} when opened from another tool,
volume 0.8, Sharp off.

Acceptance:
- Frame-step keys move exactly one frame and Add frame queues the current one with its time.
- Capture exports every selected frame with the layout's crop at full source resolution.
- Opened from another tool, Capture returns the frame there and closes back to that tool.

## Out of scope

Engines, job plumbing and per-tool behaviour beyond the defaults above (each tool's own thread), drag-resize of
panels, new presets or looks.
