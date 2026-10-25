# Feature traceability: native branch

Status: inventory checked against `slint/dev-workflow`, 2026-10-25. This is **an index of sources and evidence**, not a claim that an existing filename means a working feature. The authoritative requirements and scope are each linked spec; native behavior is proved by actual tests, integration and human window review. The published Tauri 1.x feature set belongs to `main` and must not be mistaken for native parity.

**State interpretation:** Planned = absent as a working native flow; Partial = at least a slice exists but spec parity or integration remains; Implemented = behavior exists per spec, with any dated visual approval stated explicitly. This index is intentionally conservative. Evidence columns point to relevant test suites and the spec's detailed acceptance records; they do not imply all acceptance tests passed on all branches.

| Feature | State on this branch | Spec | Native evidence / owner | Remaining distinction |
| --- | --- | --- | --- | --- |
| Audio Visualizer | Planned | [audio-visualizer.md](audio-visualizer.md) | ? | Catalog placeholder only; no native renderer |
| Backgrounds | Partial | [backgrounds.md](backgrounds.md) | [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Native recorded Drape present |
| Converter | Partial | [converter.md](converter.md) | [`converter.rs`](../../crates/halation-app/src/converter/tests.rs), [`services.rs`](../../crates/halation-app/tests/services.rs), [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Native Converter approved; some Tauri paths and Send to absent |
| Cover Test | Planned | [cover-test.md](cover-test.md) | ? | Not implemented in this branch; other worktrees may contain WIP |
| Downloader | Planned | [downloader.md](downloader.md) | ? | Catalog placeholder, no native download engine |
| Frame Capture | Partial | [frame-capture.md](frame-capture.md) | [`framegrab.rs`](../../crates/halation-app/src/framegrab/tests.rs), [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Native core/UI; real-window visual approval pending |
| Framerate | Planned | [framerate.md](framerate.md) | ? | Catalog placeholder, no interpolation pipeline |
| Grade Looks | Planned | [grade-looks.md](grade-looks.md) | ? | Catalog placeholder, no native grading engine |
| Jobs | Partial | [jobs.md](jobs.md) | [`services.rs`](../../crates/halation-app/tests/services.rs), [`engine.rs`](../../crates/halation-core/tests/engine.rs) | Core queue and engine; some global tool integration absent |
| Library | Partial | [library.md](library.md) | [`services.rs`](../../crates/halation-app/tests/services.rs), [`sections.rs`](../../crates/halation-core/tests/sections.rs) | References/sections exist, incomplete full spec |
| Material | Implemented / visual approval recorded | [material.md](material.md) | [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Approved native material direction |
| Motion | Implemented / visual approval recorded | [motion.md](motion.md) | [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Approved native motion and reduced-motion contract |
| Process Menu | Planned | [process-menu.md](process-menu.md) | ? | No native global Process Menu parity |
| Remove Background | Planned | [remove-background.md](remove-background.md) | ? | Catalog placeholder, no native background removal |
| Save Location | Partial | [save-location.md](save-location.md) | [`services.rs`](../../crates/halation-app/tests/services.rs), [`destinations.rs`](../../crates/halation-core/src/destinations.rs) | Native Converter/shared destination behavior |
| Settings | Partial | [settings.md](settings.md) | [`services.rs`](../../crates/halation-app/tests/services.rs), [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Persistence and search; sidebar/history redesign pending |
| Themes | Implemented / visual approval recorded | [themes.md](themes.md) | [`services.rs`](../../crates/halation-app/tests/services.rs), [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) | Silver/Gold/Accent native |
| Upscale | Planned | [upscale.md](upscale.md) | ? | Catalog placeholder, no native upscale |
| Vocal Remover | Planned | [vocal-remover.md](vocal-remover.md) | ? | Catalog placeholder, no stem separation |


**Navigating and checking:** `python tools/dev.py map <feature>` shows actual specs/code/tests, `symbols` narrows source to line numbers, and `check` creates a dry-run test plan. [PROJECT_GUIDE.md](../development/PROJECT_GUIDE.md) traces real user actions through core, controllers and Slint. [TOOLS_STATUS.md](../TOOLS_STATUS.md) is a deeper inventory of the ten media tools and their Tauri names.

**Evidence is not self-certification:** a test file being linked is not equivalent to passing it or obtaining native-window approval. Record new visual sign-off with date and commit in its feature spec and update this index explicitly. CI checks that every spec is included, all paths resolve and no future feature silently disappears; it cannot decide whether a feature genuinely works.
