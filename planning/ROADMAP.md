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

## Native distribution and compatibility milestones (not shipped)

These gates come from [repo-reorg v2](active/repo-reorg.md), not a new design approval:

- **C: Distribution.** Create a Windows NSIS installer and separate `halation-updater` **when implementable and testable**; preserve `latest.json`/minisign compatibility, cryptographic update verification, rollback, user data and explicit release approval. No empty `installer/` or `licenses/` scaffolding. [Target distribution contract](../docs/architecture/distribution.md).
- **D: Tauri to native profile migration.** Inventory persisted Tauri formats; implement opt-in, reversible, idempotent, fail-closed transformations on synthetic fixtures. The beta profile stays isolated until a tested cut-over. [Persistence and data ownership](../docs/architecture/persistence.md).
- **Cut-over gate.** Tauri `main` remains the published app until explicit authorization. Preserve its last release/update compatibility and prove real updates. CI green is not release approval.

The architecture documentation milestone A2 can be reviewed independently of C/D and completion of the ten media tools.
