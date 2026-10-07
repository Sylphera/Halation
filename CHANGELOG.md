# Changelog

## 1.1.0

### Added
- Converter: images, audio, video, documents, spreadsheets, presentations and PDF pages into the formats each file can become, one file or a whole folder, with a preview and per-group choices in batches.
- Vocal Remover: vocals and instrumental with UVR-MDX-NET Inst HQ4, or four stems (drums, bass, other, vocals) with HTDemucs, on the GPU (DirectML) or the CPU, with a mixer per song (mute, solo, volume) and export to WAV, FLAC or MP3.
- Downloader: whole albums and Open Folder.

### Changed
- Background Remover and Cutout now run on SAM 2.1 Base+: Automatic, the wand and the brush share one promptable mask, the subject first and the background only refining it.
- Tools open Library files that live outside the Halation folder.
- License 1.1: no commercial promise for outputs of third-party models, a third-party services clause for Downloader, and the licences of Converter's and Vocal Remover's components in THIRD_PARTY.md.
- Auralis on Home shows a wider, zoomed-out field.

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
