# Tools

Developer scripts. None of them is part of the app or runs during a build.

| Script | What it does |
| --- | --- |
| `launch-beta.ps1` | Writes a manifest of the release build (`target/release/halation-slint.exe`) and, only with `-Launch`, opens it with the beta profile (`%LOCALAPPDATA%\Halation\slint-beta`, or `-ProfileRoot`). It does not build. If scripts are blocked: `powershell -ExecutionPolicy Bypass -File tools/launch-beta.ps1 -Launch`. |
| `measure-memory.ps1` | Memory of the release build in its diagnostic scenes (`--diagnostic-scene empty\|home\|cycle`). Dry run by default; `-Run` opens six windows in turn, samples the owned process only and writes CSVs under `.tools/`. Counters and caveats: [archive/superseded/native-beta-readme.md](../archive/superseded/native-beta-readme.md#bounded-native-memory-diagnostic). |
| `measure-renderers.ps1` | The same measurement across renderer builds (Skia D3D, Skia OpenGL, software), each built into its own target under `.tools/`. |
| `record-drape.js` | Records the original Drape as the seamless loop in `assets/` (the only place the original `drape.js` may run; see `AGENTS.md`). Needs a checkout of `main`, Chrome, Playwright and FFmpeg; the header lists the files it writes. |
| `render-wordmark-glow.js` | Renders the halation glow of Home's wordmark into `assets/halation-wordmark-glow.png` from the settings at its top (Java's values from the glow lab). Needs Chrome and Playwright. |
| `render-brand.js` | Renders the logo from `docs/media/brand/source/halation-mark.svg` into `assets/` (the mark and the window icon) and `docs/media/brand/`. Needs Chrome and Playwright. |
| `dev.py` | Dependency-free entrypoint: `onboard`, `doctor`, `map <feature>`, bounded `symbols <feature> --find`, `changes`, `handoff`, and `check`. Test planning is dry-run unless `--run` is passed; Rust test scope is explicit (`--mode targeted` or `full`). See [development guide](../docs/DEVELOPMENT.md). |
| `test_dev.py` | Fast stdlib-only tests of the developer CLI, Git scope detection and feature-path map. Run `python tools/test_dev.py`. CI runs it. |
| `check-structure.py` | Fast read-only architectural contract: core/app workspace, no Tauri/UI dependencies in core, automatic assistant entrypoints and 19-spec traceability. CI enforces it. |
| `test_structure.py` | Tests of the structure checker, including negative fixtures and duplicate agent-policy detection. CI runs it. |
| `check-docs.py` | Checks the Markdown links, images and anchors and the `Status:` lines of `docs/features/`. CI runs it. |

Measurements and their results stay out of the repository (`.tools/` is ignored); a report worth keeping goes to
`research/`.
