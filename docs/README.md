# Documentation

How Halation (the native app on this branch) works. Rules for contributors are in [AGENTS.md](../AGENTS.md); what is
being changed and why is in [planning/](../planning/STATUS.md); measurements are in [research/](../research/performance/README.md);
[archive/](../archive/) holds documents that no longer apply and are never a source of rules.

## If you are going to touch…

| Area | Read first | Code |
| --- | --- | --- |
| Anything | [SLINT_SPEC.md](SLINT_SPEC.md) (scope, stack, gates), [planning/decisions.md](../planning/decisions.md) | |
| Look and feel: colours, type, layout, Home, rail, backdrop | [SLINT_VISUAL_SYSTEM.md](SLINT_VISUAL_SYSTEM.md); the approved redesign in [planning/active/ui-redesign.md](../planning/active/ui-redesign.md); colour background in [COLOR_REWORK_SPEC.md](COLOR_REWORK_SPEC.md) | `crates/halation-app/ui/`, `crates/halation-app/src/theme.rs`, `backdrop.rs` |
| Animation | [MOTION.md](MOTION.md) for the principles (its web mechanics apply to the Tauri app only); the native plan in [features/motion.md](features/motion.md); native rules in [AGENTS.md](../AGENTS.md) | `crates/halation-app/src/motion.rs`, `ui/` |
| Backend code taken from the Tauri app | [SLINT_BACKEND_IMPORT.md](SLINT_BACKEND_IMPORT.md) | `crates/halation-core/` |
| Jobs, processes, engines | [features/jobs.md](features/jobs.md) | `crates/halation-core/src/` (`queue`, `process`, `engine`) |
| Library and sections | [features/library.md](features/library.md) | `crates/halation-app/src/library.rs`, `halation-core` `sections` |
| Settings | [features/settings.md](features/settings.md), [features/save-location.md](features/save-location.md) | `crates/halation-app/src/settings.rs`, `ui/pages/settings.slint` |
| A media tool (not ported yet) | its spec in [features/](features/), and the Tauri app on `main` as the behaviour reference | |
| Assets beside the executable | [SLINT_VISUAL_SYSTEM.md](SLINT_VISUAL_SYSTEM.md#assets-beside-the-executable) | `assets/`, `crates/halation-app/src/assets.rs` |

## Specs by feature

Each spec in [features/](features/) opens with a `Status:` line: Planned, Partial or Implemented. A status says what
exists, not that it was verified; verification is a test, a measurement or Java's visual OK, named where it exists.

| Spec | Status |
| --- | --- |
| [jobs.md](features/jobs.md) | Partial |
| [library.md](features/library.md) | Partial |
| [settings.md](features/settings.md) | Partial |
| [save-location.md](features/save-location.md) | Planned |
| [backgrounds.md](features/backgrounds.md) | Partial (Drape) |
| [process-menu.md](features/process-menu.md) | Planned |
| [motion.md](features/motion.md) | Implemented, approved (2026-10-22) |
| [material.md](features/material.md) | Implemented, approved (2026-10-22) |
| [themes.md](features/themes.md) | Implemented, approved (2026-10-22) |
| [converter.md](features/converter.md), [cover-test.md](features/cover-test.md), [framerate.md](features/framerate.md), [grade-looks.md](features/grade-looks.md), [remove-background.md](features/remove-background.md), [vocal-remover.md](features/vocal-remover.md) | Planned (Tauri only) |

`python tools/check-docs.py` checks that every link here resolves and every spec has its `Status:` line.
