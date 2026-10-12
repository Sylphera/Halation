<div align="center">

<img src="docs/brand/halation-logo.svg" alt="Halation" width="120">

# Halation

### A local multimedia workspace for images, video and audio.

Create, process, enhance and export without bouncing between a dozen apps.

**No account. No cloud processing. No watermark.**

<p>
  <a href="https://github.com/Sylphera/Halation/releases/latest"><b>Download</b></a>
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

</div>

<div align="center">
  <table>
    <tr>
      <td colspan="2">
        <img src="docs/screenshots/home.jpg" alt="Halation Home">
      </td>
    </tr>
    <tr>
      <td width="50%">
        <img src="docs/screenshots/grade.jpg" alt="Grade">
      </td>
      <td width="50%">
        <img src="docs/screenshots/visualizer.jpg" alt="Audio Visualizer">
      </td>
    </tr>
    <tr>
      <td width="50%">
        <img src="docs/screenshots/removebg.jpg" alt="Background Remover">
      </td>
      <td width="50%">
        <img src="docs/screenshots/upscale.jpg" alt="Upscale">
      </td>
    </tr>
  </table>
  <sub>One workspace, focused tools. Use one or move between them with <i>Send to…</i>.</sub>
</div>

## What Halation is

Halation is a Windows desktop app built around small, focused creative tools that work independently but share the same files, jobs, exports and workspace.

There is no required workflow. Open a tool, do one thing, export — or keep moving through the app when a project needs more.

- **Local by default.** Your media is processed on your PC.
- **Modular.** Heavy engines and AI models are optional and installed only when a feature needs them.
- **Connected when useful.** Send results between tools without forcing everything into one giant editor.
- **Made to stay out of the way.** Recent files, exports, presets and linked folders live together in one workspace.

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

<details>
<summary><b>More about the tools</b></summary>
<br>

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

</details>

## Shared workspace

**Cutout and Crop** are shared editing tools. **Send to…** moves results between compatible tools. Home gives you shortcuts, recent files and one drop zone for media. Presets, looks, projects, exports and settings remain plain files under `Documents\Halation`.

## Install

Halation currently targets **Windows 10 and 11** and requires WebView2.

Download the latest stable build from [Releases](https://github.com/Sylphera/Halation/releases/latest):

- `Halation_<version>_x64-setup.exe` — installs for the current user without administrator rights.
- `Halation_<version>_x64-portable.exe` — runs without installation.

Updating an installed copy keeps your presets, settings and shortcuts. Halation 1.1.0 and later can check this repository for updates from **Settings → About → Updates**.

> [!NOTE]
> Current builds are not Authenticode-signed, so Windows SmartScreen may warn the first time you run Halation. Choose **More info → Run anyway** if you downloaded it from this repository.

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

## Local-first by design

Halation does not require an account or a Halation cloud service. Processing is local except where a feature inherently talks to a third-party service or downloads an optional component.

The updater reads `latest.json` from this repository's releases, so GitHub receives that request and your IP address. See [Privacy](PRIVACY.md) for details.

## License & third-party software

Halation is **proprietary, closed-source freeware**. This repository publishes releases and documentation; it does not contain the application source code.

You may use Halation for personal or commercial work under the [Halation Freeware License](LICENSE), and Halation does not claim ownership of your outputs. Third-party tools, models and model weights retain their own terms, which may impose separate restrictions.

Use Downloader only for content you own or have permission to download. yt-dlp, FFmpeg, Upscayl, SPAN/ncnn, SAM 2.1, RIFE, ONNX Runtime, DirectML, the vocal-removal models, Pandoc, LibreOffice and PDFium are separate projects. Bundled libraries, fonts and example-photo credits are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

<div align="center">
  <sub>Halation is freeware for Windows. Built to make the useful part fast.</sub>
</div>
