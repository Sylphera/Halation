# Native Halation design system ? current authority map

Status: consolidation of implemented, dated decisions on `slint/dev-workflow` (2026-10-25); **not a redesign proposal**. The native UI's actual tokens and rendered behavior are in [`ui/theme.slint`](../../crates/halation-app/ui/theme.slint), [`ui/app.slint`](../../crates/halation-app/ui/app.slint), [`ui/pages/`](../../crates/halation-app/ui/pages/) and the corresponding tests. Human visual approval is independent from tests.

## Source-of-truth order (when documents disagree)

1. Maintainer's most recent **approved** specific decision in [planning/decisions.md](../../planning/decisions.md) and the dated, implemented sections of [ui-redesign.md](../../planning/active/ui-redesign.md).
2. The **current** native layout/tokens and approved behavior recorded in [material.md](../features/material.md), [themes.md](../features/themes.md), [motion.md](../features/motion.md) and [`TOOLS_STATUS.md`](../TOOLS_STATUS.md) for tool screens.
3. Original native beta composition and Drape implementation details in [SLINT_VISUAL_SYSTEM.md](../SLINT_VISUAL_SYSTEM.md), *only where they have not been superseded*. Its old floating rail, glass, top-right dock, old Settings tabs and replica layout are **not** active directions.
4. [COLOR_REWORK_SPEC.md](../COLOR_REWORK_SPEC.md) captures colour experiments and history, not the final authority where Silver/Gold theme decisions supersede them. [archived Tauri motion](../../archive/tauri/motion.md) documents Tauri/GSAP; its web code is not a Slint implementation contract.
5. Old mockups and archived plans are references only. Do not resurrect earlier UI iterations merely because a large spec contains them.

## What the native UI actually uses

- **Material:** raised/well/panel/surface hierarchy, light from above, low-alpha borders and a small set of coherent spacing/shape tokens. Direction A was approved (2026-10-22); consult [material.md](../features/material.md) and existing Slint components before introducing another visual primitive.
- **Theme:** Silver default, optional Gold, user-selectable accent hue; preserve contrast/state meaning and recolor the recorded Drape while retaining its luminance. Refer to [themes.md](../features/themes.md) and [`theme.rs`](../../crates/halation-app/src/theme.rs).
- **Typography:** actual native asset fonts and wordmark are specified in [material.md](../features/material.md). Do not carry forward superseded Inter-only replica instructions or invent different per-page fonts.
- **Motion:** interactive native Slint transitions only; reduced motion is 0 ms. Do not introduce an idle animation loop or cargo-cult Tauri GSAP sequences. See [motion.md](../features/motion.md).
- **Layout:** the rail, Home presentation, curved page frame, dock actions and Settings layout have **multiple historical iterations** in [ui-redesign.md](../../planning/active/ui-redesign.md). Follow the last confirmed implemented decision and actual branch code, not earlier diagrams. The 2026-10-24/25 branch removed the global top bar and placed actions in Settings; see commits of `slint/frame-ui` and the current [`app.slint`](../../crates/halation-app/ui/app.slint).
- **Tool screens:** [TOOLS_STATUS.md](../TOOLS_STATUS.md) and [tools-ui.md](../../planning/active/tools-ui.md) specify the shared tool frame and which controls have real backend plumbing. A placeholder button is not a working tool. Do not clone an old Converter layout or an obsolete Figma mockup blindly: check the current approved tool-frame decision and test UI bounds.
- **Rendering:** approved desktop OpenGL/Skia rules are in [planning/decisions.md](../../planning/decisions.md), implementation is in [`app.rs`](../../crates/halation-app/src/app.rs). Layout screenshots produced with the headless renderer can catch bounds and alignment; they are **not** human approval of a real native window.

## Component discipline

Slint presentation uses shared `ui/components/`, `ui/theme.slint` and typed Rust models. Do not create per-tool palette, shadow, font or padding systems. Runtime state and persistent selections live in Rust-owned services; Slint pages receive typed models and callbacks. A page must remain usable down to the project's supported 960?600 bounds with and without an expanded rail. Check focus, keyboard operation, accessibility, empty/error states and reduced-motion behavior alongside the attractive layout.

## New designs and visual review

A new design is a proposal until the maintainer approves it. Make a narrow functional slice, test the actual Slint window, use representative screenshots rather than hundreds in a long model context, and record the approval with date + commit. Never transform the word "implemented" into "visually approved" without that evidence. Functional statuses and evidence are tracked in [the feature index](../features/README.md).
