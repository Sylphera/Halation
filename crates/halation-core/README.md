# halation-core

Halation's logic without a user interface. Everything here can run and be tested without a window. The [source-backed architecture](../../docs/architecture/overview.md) and [persistence invariants](../../docs/architecture/persistence.md) define its direction of dependencies.

## What goes here

| Module | What |
| --- | --- |
| `queue`, `engine`, `process`, `jobs` | The job scheduler (lanes, costs, priorities), the engine that runs admitted jobs as external processes (one process tree per job, Windows job objects), and the Jobs service the app shows |
| `library`, `sections`, `folders` | The Library's reference index (files the user added, never copied), its sections on disk (own sections, linked PC folders, optional packs) and the linked-folder list |
| `settings` | The settings file: schema, validation, atomic saves, reset |
| `presets`, `artist_profile`, `destinations`, `names` | Presets, the artist profile, where exports are saved, safe file names |
| `atomic_file` | Atomic writes shared by everything that saves |

Much of it is imported from the Tauri app's Rust backend and adapted; provenance remains in [docs/SLINT_BACKEND_IMPORT.md](../../docs/SLINT_BACKEND_IMPORT.md)
lists each module and its source. Specs: [docs/features/](../../docs/features/).

## What does not

Slint page models, window lifecycle and UI timers belong in
[halation-app](../halation-app/README.md). This crate must not depend on Slint, Tauri or Qt.
Its real dependencies are defined by [Cargo.toml](Cargo.toml): `serde`/`serde_json` for data,
`image`/`webp`/`tiff` for media, `ureq` for network operations, `zip` for archives, and
Windows-only `windows`/`windows-sys` for system integration (including audio and process control).
The platform bindings do not grant ownership of app windows or UI event loops.

## Tests

`cargo test -p halation-core`: unit tests in each module (large suites may be in adjacent `src/<module>/tests.rs`) plus `tests/` (engine, process, sections, folders), all on
temporary folders with made-up names.
