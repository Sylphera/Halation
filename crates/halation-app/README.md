# halation-app

The native app: the executable (`halation-slint.exe`), its lifecycle, the Slint interface and the Rust that drives it. See the [architecture](../../docs/architecture/overview.md), [current design](../../docs/design/design.md) and [user-to-backend guide](../../docs/development/PROJECT_GUIDE.md).

## What goes here

- `src/app.rs`: start-up, window, services and the controller that wires every callback; `navigation.rs` (pages and
  history), `catalog.rs` (the tools and Settings sections the interface lists), `theme.rs` and `motion.rs` (colours and
  durations handed to Slint), `library.rs` (the Library list as a Slint model), `assets.rs` (files beside the
  executable), `backdrop.rs` (Home's recorded Drape and grain), `screenshot.rs` (offscreen captures, `diag-screenshot`
  feature only).
- `ui/`: the `.slint` files, presentation only: `app.slint` (shell), `pages/`, `components/`, `theme.slint`,
  `assets.slint`, `icons.slint`, `models.slint`.
- `build.rs`: compiles `ui/app.slint`, stamps the Git revision and copies the workspace's `assets/` beside the
  development executable.
- `tests/`: `ui_layout.rs` (headless layout bounds) and `services.rs` (state of the app's services). Large controller unit tests are in adjacent `src/<module>/tests.rs` to keep the production modules easier to navigate.

## What does not

Business logic, file formats and anything that can run without a window go to
[halation-core](../halation-core/README.md). This crate may depend on `halation-core`; never the other way round.
Rules for the code here are in [AGENTS.md](../../AGENTS.md).

## Features

`diag-screenshot` (offscreen captures through the software renderer) and the `diag-*` renderer builds used by
`tools/measure-renderers.ps1`. The shipping build has none of them: winit + Skia only.
