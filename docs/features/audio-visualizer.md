# Audio Visualizer — Specification

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

The Audio Visualizer renders a square cover and an audio track into a video: a background built from the cover, the
cover itself, optional text and logo, bass-reactive motion, vignette/grain/fades, and an export as one MP4 or as
separate layers for editing. This spec records the verified Tauri schema, defaults, presets and export rules so the
native app can reproduce them with a new Rust/Slint implementation; the Tauri page, CSS and canvas code are not a
template. Destinations follow [the global save & export policy](save-location.md).

## 0. Principles

1. **Audio and cover are the input.** Nothing renders until both exist; a non-square cover is cropped to a centred
   1:1 frame before use, and that crop can be edited.
2. **Preview is cheap.** The preview is a reduced copy; export renders at the chosen output size. No render timer at
   rest and no work while the page is hidden.
3. **Settings are data, not UI state.** The schema below is the contract; Slint edits values owned by Rust.
4. **One renderer, several outputs.** The single video and the layer export use the same frame composition, so the
   composite of the layers matches the single render.
5. **Presets are portable.** A named preset is the same key/value object as the current settings; JSON export/import
   uses a versioned document with fixed defaults as the base.
6. **Native work stays native.** Audio decode, FFT/bass envelope, frame composition, encoding and file output are
   Rust; Slint presents the preview and controls. The browser canvas, WebCodecs and MediaRecorder are not available.
7. **The user's original files are untouched.** Exports go to the destination chosen by the save policy.

## 1. Inputs and model

- **Audio:** a decoded audio file (formats the native decoder supports; the Tauri page accepts common audio files and
  decodes them in the page). Duration, sample rate and channels come from the decoded buffer. The audio is used for
  preview playback and for the bass envelope.
- **Cover:** an image from a file, the Library or another tool. It is cropped to 1:1 (centred initially; the crop can
  be edited) before use. A Cutout mask is optional and only when the Cutout component is installed.
- **Clip:** the session holds `clipStart` (seconds) and `clipLen` (seconds). `clipStart` defaults to 0;
  `clipLen` 0 or less means "to the end" (`main:app/dist/visualizer.js:226-232`). "Clip here" sets the start at the
  playhead. Trimming applies to preview and export.
- **Title and artist:** session text used by the optional text layer and by the output file-name template. The
  default artist text is the localized "Artist" (`main:app/dist/visualizer.js:147-160`).

The output size is exactly the selected format: `W×H` from the format key; no scaling of the composition.

## 2. Settings schema and verified defaults

Groups, in the order the Tauri page presents them (`visualizer.js:22-146`):

- **Output:** format, fps, quality, clip start/length (session-only).
- **Cover:** size, corner radius, smoothness/shape, position, shadow, glow, cutout, pop-out, border.
- **Background:** blur, zoom, brightness, saturation, darken, tint colour and amount.
- **Bass:** on/off, cutoff, sensitivity, threshold, attack, release, background pulse/flash, cover pulse, glow pulse,
  shake.
- **Text:** on/off, title, artist, position, title/artist font, weight, size, spacing, line gap, uppercase, colour,
  opacity, font library.
- **Logo:** on/off, note/custom, custom asset, side, direction, size, gap, rpm, pulse.
- **Finish:** vignette, grain, fade in/out, audio fades.

Defaults (`visualizer.js:147-160`), with format, fps and quality first:

```json
{
  "format": "1920x1080", "fps": "30", "quality": "std",
  "coverSize": 52, "radius": 10, "smooth": 60, "coverX": 0, "coverY": 0,
  "shadowOpacity": 55, "shadowBlur": 70, "shadowY": 24, "glow": 0, "coverCut": false,
  "popOut": 8, "borderWidth": 0, "borderOpacity": 25,
  "bgBlur": 55, "bgZoom": 130, "bgBrightness": 95, "bgSaturation": 125, "bgDarken": 25,
  "tintColor": "#1d3f8f", "tintAmount": 0,
  "bassOn": true, "bassCutoff": 110, "sensitivity": 100, "threshold": 30,
  "attack": 8, "release": 220, "bgPulse": 6, "bgFlash": 30, "coverPulse": 1.5,
  "glowPulse": 0, "shake": 0,
  "textOn": false, "artist": "Artist", "textPos": "below",
  "titleFont": "g:Unbounded", "titleSys": "", "titleWeight": "600", "titleSize": 34,
  "artistFont": "g:Hanken Grotesk", "artistSys": "", "artistWeight": "400", "artistSize": 22,
  "artistSpacing": 8, "lineGap": 10, "artistUpper": false,
  "textColor": "#ffffff", "textOpacity": 92,
  "logoOn": false, "logoStyle": "note", "logoAsset": "", "logoSide": "left", "logoDir": "cw",
  "logoSize": 130, "logoGap": 22, "logoRpm": 12, "logoPulse": 0,
  "vignette": 40, "grain": 6, "fadeIn": 0.8, "fadeOut": 1.5, "audioFades": false
}
```

Formats (`visualizer.js:22-30`):

| Key | Label | Size |
| --- | --- | --- |
| `1920x1080` | YouTube 16:9 | 1920×1080, default |
| `3840x2160` | 4K 16:9 | 3840×2160 |
| `2560x1440` | 1440p 16:9 | 2560×1440 |
| `1280x720` | 720p 16:9 | 1280×720 |
| `1080x1920` | Vertical 9:16 | 1080×1920 |
| `1080x1350` | Portrait 4:5 | 1080×1350 |
| `1080x1080` | Square 1:1 | 1080×1080 |

Frame rate: **24, 30 (default), 60** fps. Quality: **Light, Standard (default), High**.

`titleWeight`/`artistWeight` are one of 300, 400, 500, 600, 700, 800. `textPos` is one of `below` (default),
`above`, `bottomleft`, `bottomcenter`. `logoStyle` is `note` (default) or `custom`; `logoSide` is `left` (default)
or `right`; `logoDir` is `cw` (default) or `ccw`.

The font values beginning with `g:` name bundled fonts; the user may choose a system font instead. The native app
uses its shipped fonts (see `assets/`), and a missing family falls back to the closest available family rather than
failing the export. Any visible difference needs Java's visual review.

## 3. Presets

- A preset is a named object with the same keys as the settings above, merged over `DEFAULTS` when applied or
  imported. Applying a preset replaces the current settings; deleting one removes only the stored preset.
- **Save preset** stores the whole current settings object under the typed name. **Reset all** restores `DEFAULTS`.
- **Export JSON** writes `halation-visualizer-settings.json` with:
  `{ "app": "halation-visualizer", "version": 2, "current": {…}, "presets": { "Name": {…} } }`
  (`visualizer.js:1296`).
- **Import JSON** accepts the same document, merges each value over `DEFAULTS`, ignores unknown keys and reports a
  bad file without changing the current state. The native format must remain compatible with this version-2 shape.
- Presets persist with the visualizer session; export-dialog choices are a separate persisted object, `X`
  (`visualizer.js:1789`), not a preset.

## 4. Export

### 4.1 One video

- Output is an MP4 with the selected size, fps and clip. Video codec preference: **H.264** (hardware first when the
  setting allows it), then **VP9**; audio **AAC 256 kbps/48 kHz stereo**, then **Opus 192 kbps**. The Tauri page can
  fall back to MediaRecorder/WebM when WebCodecs is unavailable; the native app does not have that fallback and must
  report an unavailable encoder instead of silently changing the container.
- Video bitrate (`visualizer.js:255-263`):

```
8e6 × (W×H / (1920×1080))^0.9 × (fps > 30 ? 1.5 : 1) × quality
quality = { low: 0.55, std: 1, high: 1.8 }
```

The estimate adds 256 kbps for audio. The file name comes from the save policy's video template (default title-based,
`.mp4`).
- Progress is computed from rendered frames; cancel stops the render/encoder and removes the partial file. The UI
  stays responsive and can report estimated size and remaining time.
- A failed or unavailable encoder is surfaced as an error; no zero-byte or silent file is left.

### 4.2 Layers

The layer export writes a new folder named after the video (`"<title> - layers"`) with the same composition split
into passes. File names are fixed (`visualizer.js:1593`):

| Layer | File | Format |
| --- | --- | --- |
| Background | `01 Background.mp4` | H.264, opaque (`-crf 16`), normal blend |
| Cover | `02 Cover.*` | ProRes 4444 (`.mov`), WebM VP9, or PNG sequence; alpha |
| Text | `03 Text.*` | same format as the cover; alpha |
| Finish | `04 Finish.mp4` | H.264 over 50 % grey when grain is a separate layer; overlay blend |
| Audio | `05 Audio.wav` | WAV, 48 kHz stereo |
| Bass envelope | `06 Bass envelope.*` | grayscale video plus `.csv` (`frame,time_s,bass`) |
| Notes | `IMPORT NOTES.txt` | layer order, blend modes, alpha format, grain and envelope notes |

- Layer format choice: **ProRes 4444** (default), **WebM VP9** or **PNG** sequence. The notes state the alpha format
  so an editor knows how to composite.
- Finish handling: **baked** grain in each layer (default) or a separate **overlay** finish layer over grey. The
  composite of the layers must match the single render within the quantization of the chosen codecs.
- Each export uses its own canvases/encoder and can be cancelled; a failure removes the partial folder. The layer
  export requires FFmpeg; the single video does not in the Tauri implementation.

### 4.3 Batch

Audio files can be queued with the current settings or a named preset and an optional cover per item. Each queue item
is an independent export with its own progress/state; one failure does not stop the others, and cancel-all stops the
running item and clears the pending queue. The tool stays usable while exports run.

## 5. Native distribution (clean-room)

- **Slint:** audio/cover drop areas, preview surface, transport (play/pause/seek), output/cover/background/bass/text/
  logo/finish controls, preset list and export dialog, batch queue. Layout and styling are new, not a translation of
  the Tauri page.
- **Rust / core:** audio decoding and analysis, cover crop/mask, frame composition at preview and export resolution,
  bass envelope, preset store and JSON import/export, output path and session, encoder invocation, progress and
  cancellation. The renderer must not allocate per frame more than necessary and must not run when the page is
  hidden or idle.
- **Preview:** render reduced frames on a worker/GPU path and publish them to Slint; never block the UI thread with a
  full-resolution export. Preview playback uses the audio clock; no timer runs at rest.
- **Jobs:** exports submit to the CPU lane as finite jobs with a cancellation token and generation guard. A layer
  export additionally uses the FFmpeg component; the tool reports the missing component before starting.
- **Persistence:** settings, presets and export-dialog choices live in Rust services and survive page recreation;
  no state lives in a Slint page instance.

## 6. Acceptance criteria

1. With defaults and no changes, a 1920×1080, 30 fps, Standard MP4 is produced for an audio file and square cover;
   duration matches the clip and audio remains in sync.
2. All seven formats, 24/30/60 fps and Light/Standard/High produce the expected dimensions and the bitrate from
   §4.1 within rounding.
3. The default settings object equals the block in §2; changing any field survives a page switch and a preset
   save/apply round trip.
4. Export JSON has `app`, `version: 2`, `current` and `presets`; importing it restores values over defaults; a
   malformed file changes nothing and reports an error.
5. The single render is reproducible: two exports of the same frozen settings produce the same frame count and
   perceptually identical frames (codec noise excepted).
6. Layer export produces every file in §4.2, the notes match the chosen format/blend, and compositing the layers
   reproduces the single render within the documented tolerance.
7. Batch of three with one bad item: the other two finish, the bad one reports its error, and no partial output
   remains after cancel.
8. The preview stays interactive while an export runs; no full-resolution frame is composed on the UI thread; no
   timer runs when idle.
9. Missing FFmpeg for layers or a missing encoder for the single video is reported before work starts.
10. The cover-cutout option works only when Cutout is installed; the tool does not silently export an unmasked
    cover.

## 7. Out of scope

- A timeline editor, multiple video tracks, transitions, keyframed automation, 3D scenes or live streaming.
- Arbitrary codecs/containers beyond the single-video and layer choices above; hardware encoder support beyond the
  H.264-first preference.
- Audio mixing, mastering, lyric timing or vocal removal (Vocal Remover owns that).
- Automatic cover extraction from audio tags, online cover search, or cloud rendering.
- Copying the Tauri visualizer's canvas code, HTML structure, CSS or interaction details.

## 8. Open questions

1. Whether the native single-video path requires FFmpeg (no in-process H.264 encoder exists yet) or adds an encoder
   crate; if it requires FFmpeg, the spec and component requirements must say so before implementation.
2. Whether the native app keeps the Tauri fallback to WebM when H.264 is unavailable, or only reports an error.
3. Which bundled fonts reproduce the `g:Unbounded` and `g:Hanken Grotesk` defaults; a visual comparison is needed
   before calling the defaults equivalent.

## Sources

- Tauri: `main:app/dist/visualizer.js`, `visualizer.html`, `visualizer.css`; `main:app/src-tauri/src/encode.rs`
  (shared encoder), `cutout.rs`, `tools.rs`.
- Verified lines: `visualizer.js:22-30` (formats), `:33-146` (groups), `:147-160` (defaults), `:226-263`
  (clip/bitrate), `:1268-1303` (presets/JSON), `:1593-1660` (layers), `:1789` (export choices).
- Shared rules: [save-location.md](save-location.md), [AGENTS.md](../../AGENTS.md) (Rust/Slint split, no UI copying).
