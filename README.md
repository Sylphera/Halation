<p align="center">
  <img src="docs/brand/halation-logo.svg" alt="HALATION" width="144">
</p>

<h3 align="center">High-quality multimedia tools. One local workspace.</h3>

<p align="center"><a href="https://github.com/Sylphera/Halation/releases/tag/v1.1.0">Halation 1.1.0 · v1.1.0</a></p>

<p align="center">
Create, process, enhance and export images, video and audio with fast, focused tools that work independently or together.
</p>

<p align="center">Local by default. No account, no cloud, no watermark.</p>

<p align="center">
<a href="https://github.com/Sylphera/Halation/releases/latest"><b>Download for Windows</b></a> &nbsp;·&nbsp; Windows 10 and 11 &nbsp;·&nbsp; Freeware &nbsp;·&nbsp; Closed source
</p>

<p align="center"><sub>Halation is proprietary, closed-source freeware. This repository publishes its releases and documentation; it contains no source code.</sub></p>

<p align="center"><img src="docs/screenshots/home.jpg" alt="Halation Home"></p>

## Why Halation

Halation brings focused image, video and audio tools into one desktop workspace. Make a quick edit, prepare an export, or combine tools for a larger project, with your files and results close at hand.

- **Modular by design.** Every tool works fully on its own. There is no required workflow: use Halation as a complete workspace or open just one tool. *Send to…* connects tools when it helps.
- **Local by default.** Processing runs on your PC, without an account, cloud processing or watermarks.
- **Install only what you need.** Heavy processing engines and AI models are optional, independent components, installed separately only when a function needs them.

## The tools

<table>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/downloader.jpg" alt="Downloader"><br><b>Downloader</b><br><sub>Download video, audio or artwork from a link.</sub></td>
<td width="50%" valign="top"><img src="docs/screenshots/convert.jpg" alt="Converter"><br><b>Converter</b><br><sub>Turn images, audio, video, documents and PDF pages into other formats.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/stems.jpg" alt="Vocal Remover"><br><b>Vocal Remover</b><br><sub>Split a song into vocals and instrumental, or four stems.</sub></td>
<td width="50%" valign="top"><img src="docs/screenshots/visualizer.jpg" alt="Audio Visualizer"><br><b>Audio Visualizer</b><br><sub>Turn audio and an image into an audio-reactive video.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/grade.jpg" alt="Grade"><br><b>Grade</b><br><sub>Looks, effects and text layers for images.</sub></td>
<td width="50%" valign="top"><img src="docs/screenshots/covertest.jpg" alt="Cover Test"><br><b>Cover Test</b><br><sub>Preview artwork in YouTube, Spotify and SoundCloud layouts.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/removebg.jpg" alt="Background Remover"><br><b>Background Remover</b><br><sub>Cut out a subject automatically or by hand.</sub></td>
<td width="50%" valign="top"><img src="docs/screenshots/upscale.jpg" alt="Upscale — Video preview"><br><b>Upscale</b><br><sub>AI image and video upscaling at ×2 or ×4.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/interp.jpg" alt="AI Interpolate"><br><b>AI Interpolate</b><br><sub>Smoother motion: ×2, ×4 or up to 144 fps.</sub></td>
<td width="50%" valign="top"><img src="docs/screenshots/framegrab.jpg" alt="Frame Capture"><br><b>Frame Capture</b><br><sub>Exact frames from video, with the best of each scene suggested.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/screenshots/library.jpg" alt="Library"><br><b>Library</b><br><sub>Keep exports, favourites and linked folders together.</sub></td>
<td width="50%"></td>
</tr>
</table>

<sub>Example photos by Alex Shuper, Fukuro, Paweł Czerwiński and Vladimir Fedotov on Unsplash.</sub>

## In detail

### Tools

- **Downloader**: the video, the audio or the largest cover of a link (Spotify song links are matched on YouTube and tagged with Spotify's metadata), whole albums to choose songs from, with a queue.
- **Converter**: images, audio, video, documents, spreadsheets, presentations and PDF pages into the formats each file can become, one file or a whole folder.
- **Vocal Remover**: vocals and instrumental (UVR-MDX-NET Inst HQ4) or four stems (HTDemucs: drums, bass, other, vocals), on the GPU through DirectML or on the CPU, with a mixer per song and export to WAV, FLAC or MP3.
- **Audio Visualizer**: audio and an image become an audio-reactive MP4 (H.264 or VP9, AAC or Opus, on the GPU when available) for YouTube, Shorts, square and more. Waveform with draggable clip markers, export queue.
- **Grade**: 38 filters plus adjustments, optical and texture effects and text layers, in two layer tabs with drag to reorder and multi-select. Exports at the original resolution or preset sizes up to 3000 px, also in batches.
- **Cover Test**: preview release artwork in YouTube, Spotify and SoundCloud layouts, including feeds, artist profiles and release views. Compare with reference artists, edit fictional titles and other metadata to try out a release, and export the preview as PNG at ×1 or ×2. Screenshots here use synthetic artists and fixture data.
- **Background Remover**: Automatic, Magic wand and Background brush on SAM 2.1 (one promptable mask: the subject first, the background only refines it), with soft edge, contract / expand and edge colour cleanup; PNG, WebP or the mask.
- **Upscale**: images at ×2 or ×4 with Photo, Digital art / cover, Sharp or Fast models and a zoomable Before/After view. Video uses SPAN ch52 via ncnn/Vulkan at ×2 or ×4, preserving aspect ratio and source FPS. SDR constant-frame-rate video exports as H.264 MP4 with source audio (copy or AAC). Short temporal Before/After previews; progress and cancellation through Jobs.
- **AI Interpolate**: a video's frame rate ×2, ×4 or up to a target (30 to 144 fps) with RIFE, a before / after preview side by side, and an H.264 MP4 with the original audio.
- **Frame Capture**: exact frames of a video at full resolution, the sharpest frame of each scene suggested, a queue of frames, and a round trip with Grade, the Audio Visualizer and the Library.
- **Library**: your own sections, linked PC folders, favourites and tags, with exports and downloads from the tools collected together. Optional packs add grain, paper, light leaks, shapes and frames; Library items can be opened in other tools.

### Across the workspace

- **Cutout and Crop**: shared editing tools for removing backgrounds and framing images.
- **Send to…**: pass a result to another tool when you want to continue working on it.
- **Home**: open tools from their shortcuts, reopen recent files, or use one drop zone for everything. Keyboard shortcuts are available with `?`.
- **Files and settings**: presets, looks, projects, exports and settings are plain files in `Documents\Halation`. English interface, with Spanish translations where available.

## Install

The current stable release is [Halation 1.1.0](https://github.com/Sylphera/Halation/releases/tag/v1.1.0). Download it from the release page, or get the [latest stable release](https://github.com/Sylphera/Halation/releases/latest):

- `Halation_<version>_x64-setup.exe` installs for the current user, without administrator rights. Running a newer setup over an installed version updates it in place and keeps your presets, settings and shortcuts.
- `Halation_<version>_x64-portable.exe` runs without installing.

Halation 1.1.0 and later check these releases for updates a few seconds after starting and whenever you choose **Check for updates**. A new version is offered with its notes; the installed copy downloads the setup, verifies its updater signature and updates in place, while the portable copy opens the release page. Choose whether it asks, only shows the update in Activity, or never checks by itself in **Settings → About → Updates**. The check reads `latest.json` from this repository's releases, so GitHub receives the request and your IP address ([Privacy](PRIVACY.md)).

Windows 10 or 11 with WebView2. No account or cloud service is required. The updater signature is Halation's own check, not Windows code signing: the builds are currently not Authenticode-signed, so SmartScreen may warn on first launch: **More info → Run anyway**.

Some tools need optional components, downloaded on demand to `Documents\Halation\Tools` or managed from **Settings → Modules**. They are separate from the installer:

- **yt-dlp** for downloads and **FFmpeg** for media conversion and video processing.
- **upscayl-bin and the Upscayl models** for image upscaling; an existing [Upscayl](https://upscayl.org) installation can also be used.
- **SPAN ch52 models and the ncnn/Vulkan runner** for Video Upscale.
- **The Cutout model** (SAM 2.1 Base+) for background removal.
- **ONNX Runtime with DirectML and the HQ4 / HTDemucs models** for Vocal Remover.
- **Pandoc, LibreOffice and PDFium** for Converter's documents and PDF pages.
- **RIFE** for AI Interpolate.

Image and video upscaling require a Vulkan-capable GPU. AI Interpolate uses Vulkan when available and can run on the CPU.

## Legal

[Privacy](PRIVACY.md)

Halation is proprietary freeware, not open-source software. It is free to use for personal and commercial purposes under the [Halation Freeware License](LICENSE). You retain your rights in the work you create or process with Halation, and may use your outputs personally or commercially without royalties to Halation, subject to third-party rights and applicable law. Halation makes no grant or representation concerning rights arising from third-party models, tools, model weights, training data or their applicable terms; any restrictions that apply independently of the license remain in effect, and you are responsible for checking them before using an output (for example, the "Sharp" upscaling model is non-commercial, and the HTDemucs checkpoint was trained on data licensed for non-commercial use). The license governs use of Halation itself, including restrictions on modification and redistribution.

Use the Downloader only for content that is yours or that you have permission to download. yt-dlp, FFmpeg, Upscayl (upscayl-bin and its models), SPAN/ncnn, the Cutout model, RIFE, ONNX Runtime, DirectML, the Vocal Remover models, Pandoc, LibreOffice and PDFium are separate projects, downloaded separately at run time, each under its own license. Bundled fonts and libraries and the example photos are listed in [THIRD_PARTY.md](THIRD_PARTY.md); their own licenses remain unchanged.
