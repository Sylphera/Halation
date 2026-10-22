# Global save & export locations

Status: Planned in the native app — the backend has destination rules, not yet used by any export; implemented in the Tauri app on `main`.

This behavior supersedes the older `direct`/`ask` and batch exceptions in settings.md.

- Settings owns `settings.saveMode`: `ask-every-time`, `halation-folder`, or null before a choice.
- `settings.saveLocationChosen` records initialization. Existing `ask` and `direct` preferences migrate to the corresponding new values, preserving the user's workflow.
- No preference: the first action that requests a user output opens the shared choice dialog. Ask every time is preselected and recommended. Cancelling creates no file. Startup never asks.
- Settings can initialize or change the preference at any time. Batch, queue and codec retry flags cannot override it.
- `exportLocation.lastManualDirectory` and `exportLocation.folderExplanationShown` live beside settings in `Settings/app.json`. Separate state prevents a Settings update from overwriting a native directory commit.
- A native dialog receives the actual suggested filename/extension and the shared manual directory, if it still exists. Otherwise the platform chooses its normal initial directory. Selection alone does not update the remembered directory; successful output completion does.

## Managed Halation Folder

Use the existing native Documents directory (including Windows folder redirection), under `Halation`. Preview profiles use their isolated Documents directory. Settings displays and opens this root. Retain the established organization:

| Output | Relative folder |
| --- | --- |
| Visualizer video and layer bundles | Exports/Videos |
| Grade and other image exports | Exports/Covers |
| Converter | Exports/Converted (preserving batch subfolders) |
| Vocal Remover | Exports/Stems/<song> |
| Upscale image/video | Exports/Upscaled |
| Cutout/cropped versions | Exports/Cutouts |
| Frame Capture | Exports/Frames |
| Interpolate | Exports/Interpolated |
| Downloaded video/audio/covers | Downloads/Video, Downloads/Audio, Downloads/Covers |
| Explicit Capture to Library | Library/Frames |
| Halation session documents | Sessions |
| Other output types | Exports |

Managed destinations use unique names rather than replacing an existing file. Native Save dialogs own manual overwrite confirmation. Layer exports choose one bundle destination, then keep their related files together. Downloader stages in its job workspace, resolves the final extension after processing, then copies to the chosen output before releasing the workspace.

## Shared boundary

`export-location.js` handles onboarding, Settings changes, serialized destination requests, and successful-export feedback. Tools supply the filename and output kind. `save_location.rs` resolves native dialogs/folders, grants exact output/bundle access and commits successful completion under the existing state lock. The byte, streaming, process and bundle writers use those destinations.

Completion displays the actual filename with a user-initiated **Show in folder** action. Only the first managed success adds “to Halation Folder.” Nothing automatically launches a file or Explorer. The native `reveal_path` uses Windows `SHOpenFolderAndSelectItems`; if it cannot select, it opens the containing directory. Missing results also fall back to the existing containing directory. This works for manual paths and after restart.

Internal persistence (presets/looks collections, resources, profiles, thumbnails, recovery snapshots, media references, workspace/intermediate files, and automatic updates to an already associated session document) remains internal storage, not an export. Explicit Session Save/Save As uses the central policy. Sending an in-memory result to another tool does not create a user export.

## Validation

`node app/tests/save-location.js` checks onboarding, mode persistence, global manual directory, successful commits, cancel/failure behavior, streaming, managed feedback, Settings changes, reveal actions, restart, and missing-directory fallback. Existing Settings, Jobs, Library, Cover Test, Sessions and Processes runners provide connected regression checks; use `--functional` where supported to avoid visual capture during local review.

Native save-dialog, Explorer selection and first-export/Settings/success UI require the local portable app and manual visual approval. Browser mocks establish functional behavior, not native or visual approval.

Converter keeps its native format plan, .part writes and finalization, resolving its destination through the shared request queue. Vocal Remover keeps its separation/mix/encoding pipeline; each track requests its own destination. Their former tool-specific destination selectors/preferences and Vocal Remover onboarding are superseded by global Settings. Settings mode writes are serialized and pending writes finish before resolving the next export.
