<div align="center">

<img src="docs/brand/halation-logo.svg" alt="Halation" width="120">

# Halation

### Focused creative tools. One local workspace.

Edit, convert, separate, enhance and export images, video and audio without bouncing between separate apps.

**Windows 10/11 · Freeware · Local-first · Proprietary**

<p>
  <a href="https://github.com/Sylphera/Halation/releases/latest"><b>Download for Windows</b></a>
  ·
  <a href="https://github.com/Sylphera/Halation/releases">Releases</a>
  ·
  <a href="PRIVACY.md">Privacy</a>
  ·
  <a href="LICENSE">License</a>
</p>

![Latest release](https://img.shields.io/github/v/release/Sylphera/Halation?style=flat-square&label=release)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white)
![Freeware](https://img.shields.io/badge/license-freeware-8A8A8A?style=flat-square)

<img src="docs/screenshots/home.jpg" alt="Halation Home workspace with creative tools, recent files and shared media access">

<sub>One workspace for focused tools, recent files, exports and handoffs between compatible workflows.</sub>

</div>

## Why Halation

Halation is a Windows desktop app built around small creative tools that work independently but share the same files, jobs, exports and workspace.

There is no required workflow. Open a tool, do one thing and export — or keep moving when a project needs more.

| | |
| --- | --- |
| **Focused tools** | Use the tool you need without opening a giant editor. |
| **One workspace** | Recent files, exports, presets, projects and linked folders stay together. |
| **Local-first** | Media processing runs on your PC by default, with no Halation account or cloud service. |
| **Connected when useful** | Move results between compatible tools with **Send to…** instead of exporting and reopening manually. |

## Download

Halation targets **Windows 10 and 11** and requires WebView2.

Download the latest stable build from [Releases](https://github.com/Sylphera/Halation/releases/latest):

- `Halation_<version>_x64-setup.exe` — installs for the current user without administrator rights.
- `Halation_<version>_x64-portable.exe` — runs without installation.

### Quick start

1. Download the setup or portable build.
2. Open Halation and drop in a file, or choose a tool from Home.
3. Export the result, or use **Send to…** to continue in another compatible tool.

Updating an installed copy keeps your presets, settings and shortcuts. Halation 1.1.0 and later can check this repository for updates from **Settings → About → Updates**.

> [!NOTE]
> Current builds are not Authenticode-signed, so Windows SmartScreen may warn the first time you run Halation. Choose **More info → Run anyway** if you downloaded it from this repository.

## A glimpse of the tools

<p align="center">
  <img src="docs/screenshots/grade.jpg" alt="Halation Grade workspace with image adjustments, effects and text layers" width="49%">
  <img src="docs/screenshots/visualizer.jpg" alt="Halation Audio Visualizer workspace creating an audio-reactive video" width="49%">
</p>

<p align="center">
  <sub><b>Grade</b> for image finishing · <b>Audio Visualizer</b> for turning audio and artwork into video</sub>
</p>

Halation is intentionally broader than any single workflow. The screenshots above are examples, not a tour of every screen.

## Tools

| | Tool | What it does |
| --- | --- | --- |
| ↓ | **Downloader** | Download video, audio or artwork from a link, with queue support. |
| ⇄ | **Converter** | Convert images, audio, video, documents, spreadsheets, presentations and PDF pages. |
| ♫ | **Vocal Remover** | Split a song into vocals/instrumental or four stems, on GPU or CPU. |
| ◫ | **Audio Visualizer** | Turn audio and artwork into an audio-reactive video for widescreen, square, Shorts and more. |
| ◉ | **Grade** | Apply looks, adjustments, effects and text layers to images, then export at full or preset sizes. |
| ◩ | **Cover Test** | Preview artwork in YouTube, Spotify and SoundCloud-style layouts before release. |
| ✦ | **Background Remover** | Cut out a subject automatically or refine the mask by hand. |
| ⤢ | **Upscale** | AI image and video upscaling at ×2 or ×4, with before/after previews. |
| ◴ | **AI Interpolate** | Increase video frame rate with RIFE, up to 144 fps. |
| ▣ | **Frame Capture** | Extract exact full-resolution frames and surface strong frames from each scene. |
| ≡ | **Library** | Keep exports, favourites, tags and linked folders together. |

## Shared workspace

**Cutout** and **Crop** are shared editing tools. **Send to…** moves results between compatible tools. Home gives you shortcuts, recent files and one drop zone for media.

Presets, looks, projects, exports and settings remain plain files under `Documents\Halation`.

<details>
<summary><b>Tool and module details</b></summary>
<br>

### More about the tools

- **Downloader** can save video, audio or the largest available artwork from supported links. Spotify song links are matched to YouTube and tagged with Spotify metadata.
- **Converter** handles single files or folders and exposes the formats each input can become.
- **Vocal Remover** supports UVR-MDX-NET Inst HQ4 for vocals/instrumental and HTDemucs for drums, bass, other and vocals, with WAV, FLAC and MP3 export.
- **Audio Visualizer** exports H.264 or VP9 video with AAC or Opus audio, includes clip markers and uses GPU encoding when available.
- **Grade** includes 38 filters plus adjustments, optical/texture effects, text layers, reordering and batch export.
- **Cover Test** includes feed, profile and release-style previews with editable fictional metadata and reference artists.
- **Background Remover** uses SAM 2.1 with automatic and manual refinement tools, edge cleanup and PNG/WebP/mask export.
- **Upscale** offers multiple image models and SPAN ch52 video upscaling through ncnn/Vulkan.
- **AI Interpolate** uses RIFE for ×2, ×4 or target frame-rate interpolation with side-by-side preview.
- **Frame Capture** extracts exact frames, suggests sharp frames by scene and can send results into Grade, Visualizer or Library.
- **Library** collects exports and downloads, supports custom sections, linked folders, favourites, tags and optional creative packs.

### Optional modules

Most of Halation works without downloading every processing engine up front. Features install their dependencies on demand to `Documents\Halation\Tools`, or you can manage them from **Settings → Modules**.

| Module | Used for |
| --- | --- |
| yt-dlp + FFmpeg | Downloads, conversion and media processing |
| Upscayl + models | Image upscaling |
| SPAN + ncnn/Vulkan | Video upscaling |
| SAM 2.1 Base+ | Background removal |
| ONNX Runtime + DirectML + HQ4/HTDemucs | Vocal separation |
| Pandoc + LibreOffice + PDFium | Documents and PDF conversion |
| RIFE | Video interpolation |

Image and video upscaling require a Vulkan-capable GPU. AI Interpolate uses Vulkan when available and can also run on CPU.

</details>

## Local-first by design

Halation does not require an account or a Halation cloud service. **Media processing is local by default.** Features that inherently use an online service, check for updates or download an optional component connect to the network only when needed for that action.

The updater reads `latest.json` from this repository's releases, so GitHub receives that request and your IP address. See [Privacy](PRIVACY.md) for the full network and data-handling details.

## License & third-party software

Halation is **proprietary, closed-source freeware**. This public repository distributes releases and documentation; it does not contain the application source code.

You may use Halation for personal or commercial work under the [Halation Freeware License](LICENSE), and Halation does not claim ownership of your outputs. Third-party tools, models and model weights retain their own terms, which may impose separate restrictions.

Use Downloader only for content you own or have permission to download. yt-dlp, FFmpeg, Upscayl, SPAN/ncnn, SAM 2.1, RIFE, ONNX Runtime, DirectML, the vocal-removal models, Pandoc, LibreOffice and PDFium are separate projects. Bundled libraries, fonts and example-photo credits are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

<div align="center">
  <sub>Halation is freeware for Windows. Built to make the useful part fast.</sub>
</div>
