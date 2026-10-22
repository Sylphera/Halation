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
| `check-docs.py` | Checks the Markdown links, images and anchors and the `Status:` lines of `docs/features/`. CI runs it. |

Measurements and their results stay out of the repository (`.tools/` is ignored); a report worth keeping goes to
`research/`.
