# Documentation

**New contributor or agent?** Start with `python tools/dev.py onboard` (read-only overview) or [DEVELOPMENT.md](DEVELOPMENT.md). No special prompt is needed when your coding assistant automatically reads the root `AGENTS.md`. `python tools/dev.py map <feature>` finds relevant source and tests; it does not replace product specifications.

How Halation (the native app on this branch) works. Rules for contributors are in [AGENTS.md](../AGENTS.md); what is
being changed and why is in [planning/](../planning/STATUS.md); measurements are in [research/](../research/performance/README.md);
[archive/](../archive/) holds documents that no longer apply and are never a source of rules.

## Architecture, design and development

| Question | Source | Scope |
| --- | --- | --- |
| Which line and module owns this code? | [architecture/overview.md](architecture/overview.md) | Actual native workspace and boundaries |
| Where is user data stored? | [architecture/persistence.md](architecture/persistence.md) | Current beta vs approved future profile |
| How is it distributed and updated? | [architecture/distribution.md](architecture/distribution.md) | Milestone C/D target, **not shipped** |
| What look and motion decisions apply? | [design/design.md](design/design.md) | Current native visual authority |
| How does a click reach the backend? | [development/PROJECT_GUIDE.md](development/PROJECT_GUIDE.md) | Real paths, callbacks and tests |
| How to navigate and check changes? | [DEVELOPMENT.md](DEVELOPMENT.md) | Human/agent commands, CI |
| Which features actually work? | [features/README.md](features/README.md), [TOOLS_STATUS.md](TOOLS_STATUS.md) | Evidence-based native traceability |
| Approved decisions vs planned work? | [planning/decisions.md](../planning/decisions.md), [planning/STATUS.md](../planning/STATUS.md), [reorganization plan](../planning/active/repo-reorg.md) | Approval, current state and milestone gates |

**Read the narrowest source that answers the task.** `SLINT_SPEC.md` and `SLINT_BACKEND_IMPORT.md` remain as historical/beta contracts and import provenance, not competing global instructions. [Tauri motion archive](../archive/tauri/motion.md) documents Tauri/GSAP, not native Slint motion rules.

## If you are going to touch

| Area | Read first | Implementation |
| --- | --- | --- |
| Rust services and boundaries | [architecture/overview.md](architecture/overview.md), [feature spec](features/README.md) | `crates/halation-core/` |
| Native presentation and composition | [design/design.md](design/design.md), [feature spec](features/README.md) | `crates/halation-app/ui/` and `src/app.rs` |
| Motion, themes, material | [features/motion.md](features/motion.md), [features/themes.md](features/themes.md), [features/material.md](features/material.md) | `ui/theme.slint`, `src/theme.rs`, `src/motion.rs` |
| Jobs and media tools | [development/PROJECT_GUIDE.md](development/PROJECT_GUIDE.md), relevant spec | core queue/engine, app controllers |
| Settings, navigation and Library | [features/settings.md](features/settings.md), [features/library.md](features/library.md), [architecture/persistence.md](architecture/persistence.md) | app controllers, core schema |
| Updating/distribution | [architecture/distribution.md](architecture/distribution.md), [reorganization milestone C/D](../planning/active/repo-reorg.md) | Planned; no native updater yet |
| Earlier Tauri behavior | [SLINT_BACKEND_IMPORT.md](SLINT_BACKEND_IMPORT.md) and `main` via Git | Adapt backend only; never copy old visual source |

## Feature specs and evidence

The **single** 19-spec status/evidence index is [features/README.md](features/README.md). Do not duplicate statuses in several summary tables: they become stale. Tests or an existing catalog name do not establish visual approval.

`python tools/check-docs.py` checks links and feature `Status:` lines. `python tools/check-structure.py` checks required architecture contracts, spec-index coverage and agent instructions.
