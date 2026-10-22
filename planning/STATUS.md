# Status

Updated 2026-10-22. One page at most; if it goes two weeks without an update, delete it rather than trust it.

- **Halation Tauri 1.2.0** is the published app, on `main`.
- **Halation Slint** (`slint/native`): Home and Settings run natively (the Library page is out of the sidebar for now);
  no media tools or engines yet. Home's Drape loop, grain and visual replica are approved by Java (2026-10-21).
- **Approved** (Java, 2026-10-22): everything the native beta built from `42cb9ca` contains: the UI redesign,
  material and type, Silver/Gold themes with the accent hue, motion and the logo.
- **Done** (2026-10-21, pending Java's review): [repository reorganization](active/repo-reorg.md) milestones 0, A1
  (instructions and documents) and B (Cargo workspace `halation-core` + `halation-app`, `assets/`, `tools/`, CI).
- **Done**: the [UI redesign](active/ui-redesign.md), implemented and approved by Java on 2026-10-22 (Home and Settings).
- **Pending merge**: PR #27 (motion), #28 (material and themes) and #29 (logo), stacked, onto `slint/native`.
- **Next**: A2 (architecture documentation), then D (data migration from Tauri) and C (installer and updater), then the
  cut-over of `slint/native` to `main`.
