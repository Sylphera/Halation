# Upscale — Specification

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

UI contract: the native page follows the [shared tool-page contract](../TOOLS_STATUS.md#visual-contract-all-ten-tools): the approved Linear/Figma redesign, the same components, tokens, surfaces, typography and native motion, with Converter as the template. No tool-specific visual style.

Upscale enlarges one picture or one video with local engines: Upscayl's Real-ESRGAN models for images, SPAN
(ncnn/Vulkan) for video. It does not interpolate frames, grade, remove backgrounds as a main job or change the
runtime of the media beyond the chosen scale. This spec records the behaviour verified in the Tauri app so the native
app can reproduce it without copying that app's HTML, CSS or JavaScript. Destinations follow
[the global save & export policy](save-location.md).

## 0. Principles

1. **One picture or one video at a time per job.** Several pictures can be queued; each video is a separate job.
2. **Scale, model and format are explicit.** The user chooses ×2 or ×4, a model and PNG/JPG for images; video is ×2
   or ×4 with MP4 output.
3. **Never invent pixels outside the frame.** Odd image dimensions are padded only to satisfy the engine and the
   result is cropped back to exactly `width × scale` by `height × scale`.
4. **Keep the timing and audio of a video.** The output keeps the source's exact rational frame rate and its audio
   when MP4 accepts it; no frame interpolation and no audio resampling.
5. **Local and finite.** Upscayl/SPAN run as child processes on the GPU; workers are finite and cancellable, and the
   UI thread never waits on them.
6. **The engine is not shipped in the installer.** It is detected or downloaded through the component service, like
   FFmpeg. The native page does not present a missing engine as a broken upscale.
7. **Clean-room native UI.** The Tauri page is a behaviour reference only.

## 1. Inputs

### 1.1 Image

Accepted inputs are the image formats the native image pipeline can decode. The Tauri page's picker accepts PNG,
JPEG and WebP; drops and Send to also accept AVIF and BMP names (`main:app/dist/upscale.html:36`,
`main:app/dist/upscale.js:394`). A picture may be cropped non-destructively before upscaling. Batch input is a list of
pictures; each becomes a job.

### 1.2 Video

Accepted containers are the ones the Tauri page names: MP4, M4V, MOV, WebM, MKV and AVI (its file filter also
accepts `video/*`; `upscale.js:583`). The video must:

- contain a real video stream (not an attached picture);
- have a valid positive rational frame rate and a positive time base;
- be SDR: PQ (`smpte2084`) and HLG (`arib-std-b67`) transfers and `bt2020` colour space are rejected;
- have a constant frame rate: the extractor compares every frame's PTS spacing with `1/fps` and rejects a variable
  stream before GPU work (`upscale.js:551-581,607-616`);
- have a duration and frame count that can be read; rotation metadata is applied to width/height and SAR is kept.

The video path has no crop in the Tauri app; the whole frame is upscaled.

## 2. Image pipeline

### 2.1 Options and defaults

`opts = { scale: 4, model: "photo", format: "png", cut: false }` (`upscale.js:57`).

| Option | Values | Default |
| --- | --- | --- |
| Scale | ×2, ×4 | **×4** (`upscale.html:51-52`) |
| Model | Photo, Digital art / cover, Sharp, Fast | **Photo** (`upscale.html:56`) |
| Format | PNG, JPG | **PNG** (`upscale.html:63`) |
| Remove background after upscaling | off/on | **off** (`upscale.html:66`) |

Interface model names map to Upscayl models (`upscale.js:56`, `main:app/src-tauri/src/tools.rs:17`):

| Name | Model | Notes |
| --- | --- | --- |
| Photo | `upscayl-standard-4x` | Real photos and mixed images; default |
| Digital art / cover | `digital-art-4x` | Illustrations, artwork and flat colours |
| Sharp | `ultrasharp-4x` | Crisper detail, slower; **4x-UltraSharp by Kim2091, CC BY-NC-SA 4.0: results are for non-commercial use** |
| Fast | `upscayl-lite-4x` | Quick result on slower GPUs |

A model is only offered/run when its files exist in the detected Upscayl models folder; a missing model produces a
clear error and no output. The native app must preserve the Sharp model's non-commercial notice wherever the model
is chosen and in the third-party notices.

### 2.2 Execution

`upscayl-bin` is invoked as (`upscale.js:246-252`):

```
-i <input> -o <output> -z 4 -s <scale> -m <models folder> -n <model> -f <png|jpg>
```

JPG adds `-c 92`. The engine is first looked for in the user's Upscayl installation (per-user and per-machine),
then in Halation's `Tools\upscayl` (`tools.rs:158-180`). `HALATION_UPSCAYL` can point at a custom installation.

For a picture with an odd width or height, the input is padded to even dimensions, upscaled, then cropped back and
re-encoded to exactly `width × scale` by `height × scale`; the temporary padded files are deleted
(`upscale.js:225-270`). If the result would exceed 250 megapixels, the engine's own size is kept instead of the
crop-back path, to avoid an unmanageable canvas. The result is named `{stem}-x{scale}.{png|jpg}` and saved through
the global save policy under the "upscaled" category (Tauri default `Exports\Upscaled`).

If "Remove the background after upscaling" is on, the upscaled picture is kept and then passed to Cutout; the
transparent PNG is saved under the cutout category (Tauri default `Exports\Cutouts`). Progress reserves 80 % for the
upscale and the rest for Cutout. If Cutout is missing, the option is disabled/explained; the upscale alone still
works.

### 2.3 Jobs and batching

The picture is a job in the GPU lane (Tauri detail: `×N · PNG/JPG`). The tool remains free while the job runs: the
user can open another picture, crop it and start another job, which waits in the queue. Cancelling terminates the
engine process, removes temporary and partial output, and does not leave a finished entry. A failure in one batch
item does not stop the others.

## 3. Video pipeline

### 3.1 Options and defaults

- Scale: **×2 default**, ×4 available (`upscale.html:131`; Tauri initial video scale is 2). This differs from the
  image default of ×4 and is intentional.
- Output: MP4, H.264, original frame rate and audio (`up.v.outputNote`).
- Model: `spanx2_ch52` for ×2, `spanx4_ch52` for ×4 (`tools.rs:18`).

### 3.2 Probe

`ffprobe -v error -show_streams -show_format -of json` supplies the exact rational `avg_frame_rate`, width/height,
SAR, rotation, time base, duration, frame count and the first audio codec (`upscale.js:551-581`). There is no
rounded-FPS reconstruction: the rational rate is passed unchanged to FFmpeg. A stream with no valid rate, no video
stream or a variable rate is rejected before any GPU work.

### 3.3 Stages

1. **Extract:** FFmpeg writes every frame as an 8-digit PNG at the source resolution, preserving timestamps:

```
-map 0:v:0 -an -sn
-vf "showinfo,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0"
-fps_mode passthrough -pix_fmt rgb24  in/%08d.png
```

`showinfo` is parsed for PTS and time base; a gap that differs from `1/fps` marks the video variable-rate and aborts
(`upscale.js:607-616`). The frame count must match the extraction.

2. **Upscale:** SPAN, on the GPU:

```
-i in -o out -m <models> -n spanx{N}_ch52 -s N -g 0 -j 1:1:1 -v
```

Progress comes from SPAN's `done` lines; the output count must equal the input count. A Vulkan/model failure or a
missing output is an error, not a partial success (`upscale.js:620-631`).

3. **Encode:** FFmpeg rebuilds the MP4 from the upscaled PNG sequence and the original audio:

```
-framerate <exact rational rate> -i out/%08d.png -i <source>
-map 0:v:0 -map 1:a:0? -map_metadata -1
-vf "crop=W*N:H*N:0:0,setsar=<SAR>"
-c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p
-fps_mode passthrough -movflags +faststart
-c:a copy
```

If the source audio cannot be copied into MP4, the encode is retried with AAC 320 kbps; if the source has no audio,
the audio map is optional. The output is `{stem}-x{N}.mp4` through the save policy under "upscaled"
(`upscale.js:633-648`).

### 3.4 Preview

A short preview (up to **2 seconds** from the current playhead) runs the same extract → SPAN → encode path and shows
the original and upscaled clips side by side, without audio. A new preview cancels the previous one; the preview
uses temporary files that are removed afterwards (`upscale.js:702-733`). The full job is separate and does not
freeze the viewer.

### 3.5 Jobs

A video job is CPU (extract/encode) then GPU (SPAN), with progress stages "Extracting frames", "Upscaling frames",
"Encoding MP4", an FPS/ETA reading from the engine, and cancellation at every stage. The tool stays free while it
runs. Temporary frame folders and a failed output are removed; a cancelled job leaves no `.mp4`.

## 4. Components

| Component | Approx. download | Role |
| --- | --- | --- |
| Upscayl engine (`upscayl-bin`) | 10 MB | Image upscaler |
| Upscale models | 70 MB | The four models above |
| Video Upscale / SPAN | 14 MB | `span-ncnn-vulkan` plus `spanx2_ch52` and `spanx4_ch52` |
| FFmpeg | 140 MB | Video probe, frame extraction, MP4 encode |
| Cutout | 445 MB | Optional background removal after upscaling |

Detection order for Upscayl is the user's installed copy, then Halation's download; SPAN is Halation's copy (with
`HALATION_SPAN` as a custom override) (`tools.rs:158-194`). The native beta has no installation flow yet; the
component service must add it before the tool can run.

Licences (see [THIRD_PARTY.md](../../THIRD_PARTY.md)): upscayl-ncnn and the Upscayl-published models are AGPL-3.0;
SPAN's runner is AGPL-3.0 (its models keep the upstream licences); the Sharp model is CC BY-NC-SA 4.0 (non-commercial
results); FFmpeg is GPL-3.0. Downloading them from upstream keeps Halation as an aggregator; mirroring a build would
require publishing the corresponding source.

## 5. Native distribution (clean-room)

- **Slint:** Image/Video modes, drop area, scale/model/format controls, optional background removal, before/after
  comparison, video transport and preview, job queue, progress and cancel. New layout; not a translation of the
  Tauri page.
- **Rust / core:** image decode/crop/pad, engine discovery and invocation, model validation, FFmpeg probe and
  pipeline, temporary workspace, progress parsing, cancellation, output naming and save policy, session state.
  Image and video work runs off the UI thread; the GPU engine is a child process; no unbounded worker or join at
  shutdown.
- **Jobs:** image jobs in the GPU lane; video jobs CPU→GPU; the preview is a separate lower-priority job that is
  cancelled when superseded. Generation checks drop stale progress from an earlier input.
- **Persistence:** options (`scale`, `model`, `format`, `cut`) and the last video scale are Rust-owned settings; no
  state in a page instance. The Tauri tool has no named presets, so none are required for parity.

## 6. Acceptance criteria

1. Defaults on an even-sized photo: ×4, Photo, PNG; output is exactly `4w × 4h` and opens correctly.
2. ×2 and JPG q92 produce the expected size and format; the four model names map to the four engine model files.
3. An odd-sized image is padded, upscaled and cropped back to exactly `w × N` by `h × N`, with no border or shifted
   content.
4. A missing engine/model shows a clear component message; the tool never runs a different model silently.
5. The Sharp model's non-commercial licence notice is visible before use and in the notices.
6. Defaults on a 29.97 or 23.976 fps SDR video: ×2 MP4, exact rational frame rate, same duration/frame count, audio
   present and in sync.
7. A VFR video, HDR/bt2020 video or a file with no video stream is rejected with the documented reason before any
   GPU work.
8. Audio that MP4 cannot carry falls back to AAC 320 kbps; audio that can is copied without re-encoding.
9. The 2-second preview compares the original and the upscaled clip and cancelling it leaves no temporary files or
   output.
10. Cancelling a full image or video job kills the child process, removes temporary files and leaves no partial
    output; other batch items continue.
11. The UI stays responsive during all stages and no full-resolution work runs on the UI thread.

## 7. Out of scope

- Scales other than ×2/×4, other Upscayl/SPAN models, model training or download from arbitrary URLs.
- HDR/bt2020 video, variable-frame-rate video, frame interpolation (AI Interpolate owns that), colour grading,
  denoising as a separate stage, audio processing.
- Cropping or editing the video; image cropping exists only as the pre-upscale input crop.
- Parallel full video exports beyond what the queue permits; cloud or remote upscaling.
- Copying the Tauri Upscale page's layout, styling or interaction.

## 8. Open questions

1. Whether the native video path should support ×4 on GPUs where SPAN's model does not fit; the Tauri app offers it
   and lets the engine fail. The native app may keep that behaviour or disable it with an explanation.
2. Whether the 250-megapixel image guard is kept exactly; it protects memory but produces a different size for very
   large inputs.
3. Whether "Remove the background after upscaling" belongs in the first native version or waits for Cutout parity.

## Sources

- Tauri: `main:app/dist/upscale.js`, `upscale.html`, `upscale.css`; `main:app/src-tauri/src/tools.rs`
  (Upscayl/SPAN discovery and models), `interp.rs` (shared work folder/count/clean).
- Verified lines: `upscale.js:56-57,219-270,394,551-581,593-648,702-733`; `upscale.html:36,51-66,131`;
  `tools.rs:17-18,158-194`.
- Shared rules: [save-location.md](save-location.md), [converter.md](converter.md) (FFmpeg licence reasoning),
  [THIRD_PARTY.md](../../THIRD_PARTY.md).
