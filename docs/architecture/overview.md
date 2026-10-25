# Native architecture ? current, source-backed map

Status: current native architecture on `slint/dev-workflow`, checked 2026-10-25. This describes **what exists on this branch**, not the planned final release architecture. The reorganization authority is [repo-reorg.md](../../planning/active/repo-reorg.md); approved product decisions are [decisions.md](../../planning/decisions.md).

## Lines, roles and boundaries

- **Published line**: Tauri 1.x lives on `main`. Its HTML/JS is a *behavior reference*, not a native UI source. No Tauri runtime is linked or copied into this tree.
- **Native line**: Cargo workspace at the root. [`halation-core`](../../crates/halation-core/README.md) has media logic, settings, profiles-independent persistence, jobs, process control, destinations, playback and Library storage. [`halation-app`](../../crates/halation-app/README.md) owns process lifecycle, native Slint UI, navigation, UI models, assets, user profile and controllers.
- Dependency direction is **app ? core**, never core ? app. Core must not depend on Slint, Tauri or a Qt runtime. `Cargo.toml` and CI's `cargo tree` checks are the mechanical proof; this paragraph alone is not.
- `assets/` contains runtime icons, fonts, marks and Drape media. `crates/halation-app/build.rs` compiles Slint and stages assets beside the executable; `src/assets.rs` loads them and resolves unit-test executable paths.
- Source code from the prior Rust backend can be adapted behind native interfaces with provenance recorded in [the import ledger](../SLINT_BACKEND_IMPORT.md). Prior frontend source is not copied.

## Real runtime dependency flow

```text
Windows executable (crates/halation-app/src/main.rs)
  -> app::run() / app.rs: application lifecycle and callback wiring
     -> navigation.rs, settings and Library UI controllers
     -> converter.rs / framegrab.rs controllers (only connected media tools)
       -> halation-core::{convert, framegrab, frame_decoder, playback, components}
       -> halation-core::{destinations, queue, engine, process}
  -> Slint (crates/halation-app/ui/app.slint and ui/pages/*)
  -> assets (files beside executable)

halation-core -> persistence/filesystem/processes; NEVER -> Slint
```

Slint owns presentation and input callbacks. Rust controllers own durable state and connect callbacks to services. Heavy I/O and decoding must stay off the UI thread; workers return data through Slint's event loop and discard stale results. The UI page can be recreated on navigation without losing its Rust-owned processing state. The implementation and concrete tests are mapped in [PROJECT_GUIDE.md](../development/PROJECT_GUIDE.md).

## Current scope, not imagined scope

The navigation enum presently contains Home, Library, Jobs, Settings, Converter and Frame Capture ([`navigation.rs`](../../crates/halation-app/src/navigation.rs)); it currently has a `current` page only, **not a history stack**. Converter and Frame Capture are connected; the catalog also describes unavailable tools without pretending they work. The status and evidence are in [the feature index](../features/README.md) and [TOOLS_STATUS.md](../TOOLS_STATUS.md). Existing tests do not establish human visual approval for Frame Capture.

The latest approved composition comes from [design/design.md](../design/design.md), the live Slint code, and dated visual decisions. Old screenshots, superseded UI proposals and Tauri CSS are not binding native layout instructions.

## Quality and release gates

Use [`tools/dev.py`](../../tools/dev.py) (`doctor`, `map`, `symbols`, `check`, `handoff`) to find the minimum relevant context and checks. CI tests the workspace and the architectural boundaries. Tests and builds do not make a feature fully integrated or visually approved. Release, installer, profile cut-over and data migration are **not implemented or authorized by this document**: see [distribution.md](distribution.md).

## Where to change something

| Change | Owning area | Starting point |
| --- | --- | --- |
| Typed jobs and cancellation | core | [`engine.rs`](../../crates/halation-core/src/engine.rs), [`queue.rs`](../../crates/halation-core/src/queue.rs) |
| Export destination and file safety | core | [`destinations.rs`](../../crates/halation-core/src/destinations.rs), [`atomic_file.rs`](../../crates/halation-core/src/atomic_file.rs) |
| Slint state and navigation | app | [`app.rs`](../../crates/halation-app/src/app.rs), [`navigation.rs`](../../crates/halation-app/src/navigation.rs) |
| Concrete tool controllers | app | [`converter.rs`](../../crates/halation-app/src/converter.rs), [`framegrab.rs`](../../crates/halation-app/src/framegrab.rs) |
| UI presentation | app | [`ui/app.slint`](../../crates/halation-app/ui/app.slint), [`ui/pages/`](../../crates/halation-app/ui/pages/) |
| Data schemas, profile and invariants | core + app | [`settings.rs`](../../crates/halation-core/src/settings.rs), [`profile.rs`](../../crates/halation-app/src/profile.rs) |
| Human/native acceptance | tests + user | [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs), real native-window review |

Do not create new crates, UI frameworks, coordinators or layers just to make the tree symmetrical. Split files when a real ownership boundary, concurrent edit conflict or repetitive reading warrants it; retain stable Rust module paths and tests.
