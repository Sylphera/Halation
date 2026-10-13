# Changelog

## Unreleased

- Halation is open source: GPL-3.0-or-later, with the source, issues and releases in one public repository. The
  name and logo stay reserved (TRADEMARKS.md). Settings → About shows the new license.
- Auralis rewritten as Halation's own code, with the same look and without React.
- Welcome has a new background, Caustics: silver light rippling as water throws it on a ceiling.

## 1.1.1

- Updated Halation branding and application icons.
- Unified save and export destinations, remembered manual folders, and added Show in folder.

## 1.1.0

### Added
- Converter: images, audio, video, documents, spreadsheets, presentations and PDF pages into the formats each file can become, one file or a whole folder, with a preview and per-group choices in batches.
- Vocal Remover: vocals and instrumental with UVR-MDX-NET Inst HQ4, or four stems (drums, bass, other, vocals) with HTDemucs, on the GPU (DirectML) or the CPU, with a mixer per song (mute, solo, volume) and export to WAV, FLAC or MP3.
- Downloader: whole albums and Open Folder.
- Updates: Halation checks the public releases, downloads the signed setup in Activity, and installs it after saving the session and restarting, or when it closes. Settings → About → Updates sets how it asks; What's new shows the notes after an update. The portable copy opens the release page.

### Changed
- Background Remover and Cutout now run on SAM 2.1 Base+: Automatic, the wand and the brush share one promptable mask, the subject first and the background only refining it.
- Tools open Library files that live outside the Halation folder.
- License 1.1: no commercial promise for outputs of third-party models, a third-party services clause for Downloader, and the licences of Converter's and Vocal Remover's components in THIRD_PARTY.md.
- Auralis on Home shows a wider, zoomed-out field.
- Tools in a new order, by what they start from; the Home toolbar and the activity island simplified.
- Vocal Remover: the 4-stem model rebuilt for DirectML (stems-v4), so 4 stems on the GPU match the CPU; the first export asks about the folder.
- Converter: each format says its quality, settings and what it is for.
- Background Remover: Automatic proposes one subject and does not read the same picture again.

### Fixed
- Black edges during the Home entrance wave.

## 1.0.3

- Corrected Grade upload-control alignment in smaller windows and Cover Test Profiles scrolling.
- Removed Title Intro and decorative interface shadows.
- Prevented exposed edges during tool transitions while preserving their timing.
- Made SoundCloud previews dark by default and centered Spotify and SoundCloud controls.

## 1.0.2

- Fixed a Sessions and recovery performance regression, restoring responsive tools and smooth navigation during processing.
- Made Background Remover detection and mask editing more responsive.
- Improved Grade image loading and Upscale media loading and preparation.
- Smoothed tool transitions through shadow reuse and composition, with better sequencing of Home and interface reveals.
- Fixed temporary media URL cleanup and reduced retained image memory.

## 1.0.1

### Added
- Full Spanish interface localization.
- Language selection before the first-run Welcome flow.
- Manual Sessions with Save, Save As and Open Session.
- Crash recovery with Recover / Discard on the next launch.
- Automatic saving every 3 minutes for saved Sessions when changes are pending.
- Persistent Profiles section in Cover Test.

### Changed
- Tools now start clean after a normal restart instead of restoring temporary work automatically.
- Explicitly saved presets, defaults, Settings, Library data and Profiles remain persistent.
- Session and recovery state are now separated from permanent preferences.

### Fixed
- Corrected Halation's license label from MIT to Proprietary Freeware.
- Fixed Session restoration consistency in Title Intro.
- Fixed alignment of the global top-right control island after adding Session controls.

## 1.0.0

- First stable release of Halation, incorporating the visually approved final beta polish.
- Added the Welcome onboarding flow with identity and profile setup, the Aurora Veil background, and a final ready state with a continuous transition into Home.
- Improved Cover Test previews and native preview fullscreen controls, including Grade and Upscale.
- Added SPAN image and video upscaling with a short video preview.
- Refined UI shadows and background composition continuity while preserving Home's Auralis background.

## 0.10.0-beta.4

- Integrated the approved toolbox, activity island, Home and dock interactions, and background navigation refinements.
- Updated the approved YouTube, Spotify and SoundCloud previews in Cover Test, including preview maximization.
- File picker selections now reuse the existing drag-and-drop reception animation, including Frame Capture and Library imports.
- SoundCloud previews share deterministic, cached waveforms with sustained energy sections and bar density matched to each view's width. At-a-distance previews retain the base view's waveform resolution.
- Preserved the manual Chromium review workflow and excluded temporary review artifacts from the release tree.

## 0.10.0-beta.3

- Made the toolbox, activity island and Process Manager transform continuously in both directions, including interrupted transitions. Activity is centered in the window; all four idle toolbar icons now have equal spacing.
- Expanded Cover Test to eight external artists with one or two complete reference releases each, and added full mobile scrolling through feed, profile and search views. Reduced profile image preparation and restore delays.
- Reworked SoundCloud profile, track and feed simulations, with structured synthetic waveforms and a desktop composition for at-a-distance comparison.
- Integrated the recovered calm film grain and centered 300 ms page transitions, with a subtle background deformation on navigation. Added deterministic visual capture and continuity checks.

## 0.10.0-beta.2

- Fixed Halation not starting on Windows (0.10.0-beta.1): the exe's manifest carried a package identity element that Windows rejected ("the MSIX publisher must be valid"). The element is removed; the app no longer groups WebView2's processes under Halation in Task Manager.

## 0.10.0-beta.1

- Integrated the Home, Library v2 and Settings v2 workflows, Cover Test, background transitions and session recovery from the advanced development branch.
- Added scheduled Jobs and the Process Manager with queues, resource status, cancellation and result actions. Export jobs preserve their queued settings and release resources before reuse.
- Unified the four header controls into a flat toolbox. Processes detaches into the activity island, expands into the Process Manager and returns to the toolbox; its visibility is configurable in Settings.
- Fixed visual continuity during expansion and folding, repeated updates interrupting surface transitions, and connected export and Library Cutout flows.

## 0.9.0-beta.1

- New look: pure black window, floating panels, a static dock with a soft light that follows the pointer, a new Home with a moving atmosphere, muted accents and a fine grain. Each page title shows its tool's icon.
- New logo: the mark on Home (with a faint glow and a slow float), the dock, the app icon, the installer and the favicon; the taskbar and the Start menu show the bare mark. The name HALATION is set in a widened Bricolage Grotesque.
- New tool names: Audio Visualizer, Grade, Downloader, Image Upscale, Title Intro, Frame Capture, AI Interpolate, Background Remover.
- Motion: everything moves on one spring and can be interrupted mid-move. Tools grow out of their dock icon, menus and dialogs open from their button, lists slide into place. Loading screens are replaced by the shape of what is coming (skeletons). "Reduce animations" turns it all into short fades.
- New tool: Background Remover. Automatic (the Cutout model), Magic wand and Background brush, with intensity, threshold, soft edge, contract / expand, edge colour cleanup and small islands; undo / redo, before / after, mask view; export PNG, WebP or the mask, Crop and Send to….

## 0.8.0-beta.1

- New tool: Frame rate (rail and Home). Multiplies a video's frame rate with RIFE: ×2, ×4 or a target rate (30 to 144 fps). A 3 s before / after preview side by side (play, pause, 1× / 0.5× / 0.25×, the scrubber picks where it starts), progress with the time left and Cancel. The result is an H.264 MP4 in Exports\Interpolated with the original audio, and goes on with Send to… and the Library. RIFE (rife-ncnn-vulkan) is a downloadable component in Settings → Modules; without a Vulkan GPU it runs on the CPU.
- Frame Grab: a queue of up to 8 frames (M or Add) with Select all / none replaces suggestions and marks; Capture has Send to…. The decoding path shows in a performance overlay (off by default), loading shows a blurred screen until the video is usable, and switching videos no longer hangs the viewer or flickers.
- Home: the symbol over the wordmark, a search of tools, Grade's effects and looks, and a staged entrance.
- Upscale: the viewer shows the picture or crop at its own aspect ratio; small ones are scaled up.
- Thumbnails is removed (the tool, its Home card and its Send to… targets).

## 0.7.0-beta.1

- Send to…: one menu for every output (image, video, layer), listing only the tools that are turned on, with "and come back" to return to where you were.
- Frame Grab: the video opens at once from its keyframe index, scrubbing always shows the latest position, and captures can be cropped to 16:9 or 1:1.
- Intro: the intro and outro bars turn off in one click and are replaced from a menu or by dropping a preset on them. The preview with a video background no longer decodes frame by frame.
- Upscale: a picture of any ratio from Crop keeps its exact size.
- README: screenshots of every tool, English only.

## 0.6.0-beta.1

- New tool: Thumbnails (rail and Home). Thumbnails, covers and release graphics in 8 formats (YouTube thumbnail, cover, SoundCloud, vertical 9:16, Instagram post, YouTube banner, X header, custom). A first screen with the formats drawn at their shape, the templates, a blank canvas, "Start from video", recent projects and a drop zone that offers "Crop to {format}", "Change canvas to…" or the picture's exact ratio.
- The editor: tools (select, text, image, shape, Cutout, Crop), a floating bar over the selected layer, a contextual inspector with quick styles on top, picture, video, shape and text layers, handles with Shift and Alt, magnetic guides and your own guides from the rulers, 10 blend modes, masks, align and distribute, 200 steps of undo. Every number can be dragged on its label. Panels move between sides, float, resize and collapse; Default and Compact workspaces; the layout is remembered.
- Text layers use the Intro's engine (the 8 materials and finishes, {title} and {artist}); effects per layer (Grade look, adjust, outline, shadow, glow, blur, chromatic aberration, grain, halation, pixelate / dither) and quick styles dragged onto any layer; the cover's palette (5 colours, Apply palette).
- 8 templates (Cover Center, Type Beat, Split, Night Drive, Glass Card, VHS, Minimal, Inverse Title) with slots for the cover, the artist and the background, filled from the Visualizer or the Downloader with "Make thumbnail". Save your own design as a template.
- Variants: "+ Variant" adds the same design in another format, or an A/B test with its own title and colours. Texts, pictures and effects changed in one reach every variant; position, size, visibility and crop stay in the variant (a link icon shows which). Export all saves every picture at once.
- Mini preview: the thumbnail as a video page shows it, at 360 and 168 px, dark or light, with a timestamp; it warns when something sits under the timestamp or a text is too small to read. "Open in Preview" says what the coming Preview tool will do.
- Projects (.halthumb in Projects\Thumbnails) saved by themselves, listed on Home; "Collect assets". Export to PNG (transparent), JPG kept under 2 MB for YouTube, or WebP, at 1× or 2×; Send to Grade, Use as Visualizer cover. Three short tips the first time the editor opens.
- New tool: Frame Grab (rail and Home). Exact frames of a video through FFmpeg, a strip with the sharpest frame of each scene, several frames at once, and a round trip: Grade, Library, Downloader, Visualizer and Thumbnails open it with the video and get the frame back.
- Cutout (remove background) for the whole app: a downloadable component (205 MB) that runs on your PC, a dialog with before / after, a brush to fix the edge, and batches in Upscale's new queue. In Grade, Visualizer (cover cutout), Intro, Upscale, Downloader and the Library.
- Crop for the whole app: one dialog with fixed or free ratios, thirds and rotation, required when a picture must have a shape, and always from the original picture.
- Library: your own sections, folders of your PC linked and followed live, favourites, tags, search, cutout and crop versions, and 5 optional packs (grain, paper, light leaks, shapes, frames) in Settings → Modules. The same panel opens from Thumbnails, Intro and Visualizer.
- Downloader: Spotify song links. The song is found on YouTube Music or YouTube (3 candidates to choose from) and tagged with Spotify's title, artists, album, date, track and cover; a notice says the audio is YouTube's.
- Intro editor: preview quality Low / Mid / High, the element's place on the frame separate from the alignment of its lines, snapping guides and a thirds / safe-area grid while dragging. Every slider of the app shows its value, which can be typed.

## 0.5.0-beta.1

- New tool: Intro (Ctrl+6). Animated titles and logos, exported with transparency to place over a video in CapCut, DaVinci Resolve or Premiere. Text and images as elements, each with a material (Flat, Gradient, Chrome, Glass, Inverse, ASCII, Halation glow, Dither), a finish (outline, glow, shadow, depth), an entrance, a hold and an exit animation, placed by dragging on the preview. A timeline with one track per element shows the in / hold / out parts; their edges are dragged to change the timing.
- Intro backgrounds (transparent, solid, animated gradient, image, looping video) and a finish over the whole frame (grain, halation, vignette, a Grade look, chromatic aberration). A song can drive the "bass" settings, as in the Visualizer.
- Intro exports to Documents\Halation\Exports\Intros: MOV ProRes 4444 and WebM VP9 with alpha, PNG sequence, or MP4 with the background; the full clip, the entrance, a seamless hold loop (for watermarks) or the exit; motion blur; the song under the range as a WAV beside it; a still PNG with alpha (current frame, end of the entrance or a given time, up to 4K, cropped to the content). Size estimate and free space before exporting.
- 10 included Intro presets (Chrome Sweep, Cold Chrome Drift, Frosted Glass, Inverse Window, ASCII Resolve, Halation Night, Phonk Glitch, Ember Burn, Dither Mono, Minimal Watermark) with animated thumbnails; your own Project presets (the whole clip) and Style presets (an element's look and animation) are saved as files in Presets\Intro.
- Settings → Modules: turn each tool on or off, and install or remove the components they download (FFmpeg, yt-dlp, the Upscayl engine and its models) with their size. A tool that needs a missing component says so and offers to install it.
- Settings → Storage: how much space Halation takes (the app, its components, temporary files and caches) with a total, your own files listed apart, and a button to clear the caches.
- Tool downloads that stop receiving data fail after 30 s with a clear message and Retry, instead of waiting forever.
- Segmented selectors (tabs, format and mode choices) keep their highlight on the selected option when the window is resized, and long labels wrap instead of being cut. Panels, notices and empty states in the Visualizer and Grade appear with a short fade.

## 0.4.1-beta.1

- Maintenance release, no new features.
- Grade: the export row no longer cuts its choices ("Formato original", "3000 px (portada)" in Spanish); each field is as wide as its longest option and the row wraps when the column is narrow.
- Single-video export now writes the MP4 with Mediabunny instead of the deprecated mp4-muxer; the video and audio are the same.
- Tauri on 2.11.6; updated ureq (3), zip (8), windows-sys (0.61), winreg (0.56) and tauri-winrt-notification (0.8). Tool downloads (FFmpeg, yt-dlp, upscayl-bin) keep using Windows' own certificate store.
- The code is split into small modules (Visualizer and Grade pages, the Rust backend); behaviour is unchanged and was checked against screenshots and exports of 0.4.0.

## 0.4.0-beta.1

- Visualizer: export in layers. "Export…" opens a dialog with two modes: Single video (the MP4 as before) or Layers, which writes each part of the video to its own file in Exports\Videos\<title> - layers: 01 Background (MP4), 02 Cover and 03 Text and icon (transparent), 04 Finish (grain for the Overlay blend mode), plus optional 05 Audio (WAV of the clip) and 06 Bass envelope (grayscale video and CSV, one value per frame), and IMPORT NOTES.txt with the order and blend modes. Every file has the same length, frame rate and size and starts at 0; stacked in an editor they reproduce the full video.
- Transparent layers in ProRes 4444 (default), WebM VP9 with alpha, or a PNG sequence as a last resort, with straight alpha and BT.709 colours, so there are no halos on soft edges. The finish can be baked into the layers or exported as a separate Overlay layer.
- The dialog shows the estimated size of each file and in total, and warns when the drive does not have enough free space. Settings are frozen when the export starts; progress is real (frames written by FFmpeg) and Cancel removes the folder.
- Exports stream frames straight to FFmpeg, one process per file running in parallel, without piling up in memory or opening a console window. If FFmpeg is missing, the dialog downloads it as the Downloader does.
- Motion across the app: tabs cross-fade, the sidebar pill slides to the selected tab, menus, popovers and dialogs grow from where they were opened, toasts slide in, accordions open smoothly, Grade layers slide when added, removed or reordered, queues in the Downloader, Visualizer and Upscale animate, thumbnails shimmer while loading, and progress bars move smoothly. Animations never block clicks and can be interrupted at any time.
- Settings → Interface → "Reduce animations" turns every animation off; the Windows "Animation effects" setting is respected too.

## 0.3.0-beta.1

- Home screen: the app opens on Home, with a card for each tool, recent files (with a thumbnail and the tab they open in) and a drop zone. A song goes to the Visualizer; for an image a small menu asks: Grade, Upscale or Visualizer cover. The logo in the sidebar goes to Home.
- Visualizer: Output (format, frame rate, quality, start, duration) and Export moved to the main column under the cover and audio; the side panel keeps only the look, with nothing sticky over the sliders. The timeline shows the whole song's waveform with the bass over it in lavender, the played part lit, and two markers to drag the clip start and end (synced with Start and Duration).
- Grade: three columns that scroll on their own, so the image is always in view: library on the left, image with Undo / Redo / Original and the export block (crop, size, format, Export, Use in Visualizer, Upscale) in the centre, layers on the right. Layers have two tabs, Filters and Effects, with compact rows: drag to reorder, eye, name, intensity on the row, and a ⋯ menu to duplicate, move or delete. Clicking a row opens its settings (one at a time); Ctrl+click and Shift+click select several to hide, show or delete them.
- Upscale: before / after comparator with a draggable divider, zoom with the wheel, drag to move and double-click to fit, the same on both halves. Finished jobs of the session can be compared again.
- Downloader: the preview keeps the real proportions of the cover or thumbnail.
- Keyboard: Ctrl+1…5 opens Home, Visualizer, Grade, Downloader and Upscale, also from inside a tool. "?" or the keyboard icon in the header shows every shortcut; the long help lines are gone.
- Installer: running the setup over an older version updates it in place (one "Update Halation 0.2.0 → 0.3.0" page, no uninstall), keeping Documents\Halation, the settings and the shortcuts. The same or an older version asks to Reinstall or Downgrade. An open Halation is closed after asking.
- The release workflow checks that the portable executable carries the current icon.
- README screenshots made from the example photos in docs/examples and a synthetic song.

## 0.2.0-beta.1

- New look: warm dark theme with one set of colour tokens, a sidebar with a tab for each tool, content in a floating panel, Inter for the interface and Lucide icons. All text passes WCAG AA contrast.
- New icon and logo, generated for every size Tauri and the installer need.
- The title bar follows the dark theme (native bar, so snap layouts keep working).
- Visualizer and Grade start empty: drop zones instead of the sample song and image, and the controls that need content stay disabled until something is loaded.
- Upscale tab: 2× or 4× upscaling with upscayl-bin and four models (Photo, Digital art / cover, Sharp, Fast), with real progress and cancel. It uses an existing Upscayl install or downloads the engine to Documents\Halation\Tools. Results go to Exports\Upscaled and can be opened in Grade or used as the Visualizer cover.
- Downloader tab: paste a link to get a video (MP4, H.264 + AAC preferred), the audio (original or MP3) or the cover (largest version as PNG, including SoundCloud, Bandcamp, Spotify and Apple Music artwork). Queue with progress, cancel and retry; files go to Documents\Halation\Downloads. yt-dlp and FFmpeg are downloaded on first use and yt-dlp updates itself once a day.
- Settings: status of the external tools and an "Update engine" button.
- Releases include a portable executable next to the installer.

## 0.1.0-beta.1

First public beta.

- Visualizer: audio-reactive videos from a song and a cover, exported as MP4 (H.264 or VP9 with AAC or Opus), written to disk in pieces, with an export queue.
- Grade: 38 looks plus adjustments, effects and text layers for cover art, exported up to 3000 px, with batch processing.
- Library of presets and looks stored as plain `.json` files; export history.
- Settings: file name templates (`{title}`, `{artist}`, `{date}`), artist name, video and audio codec, encoder, image defaults, test notification.
- English and Spanish interface, switchable from the globe menu.
- Windows notifications, taskbar progress, "Open with" for images and audio.
- Data from earlier versions in Documents is imported once, leaving the originals untouched.
