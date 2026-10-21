# Roadmap

Parked ideas only, with a line on how each fits what exists. Work under way is in [STATUS.md](STATUS.md) and
[active/](active/).

## Native app

- Code signing (Authenticode) through SignPath Foundation, once the project has reputation (downloads, stars). Fit:
  the application answers and the CI patch written for the Tauri app are in
  [archive/tauri/signing.md](../archive/tauri/signing.md) and
  [archive/tauri/signing/build-signpath.patch](../archive/tauri/signing/build-signpath.patch); the native CI and
  installer (milestone C) would take them over.

## Ideas from the Tauri app (fit to check when the tool is ported)

- A halation (red film glow) pass for the Visualizer finish: the export spec mentions it, but the Visualizer has no
  such effect today (Grade does).
- Layer export for the export queue (several songs in layers).
- Single-video export through FFmpeg too (one code path, 10-bit/ProRes masters).
- Hardware encoders in FFmpeg (NVENC/QSV/AMF) for the opaque background layer.
