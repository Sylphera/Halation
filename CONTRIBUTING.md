# Contributing to Halation

Bug reports, ideas and pull requests are welcome.

## Two lines

- `main` is **Halation Tauri**, the published app (1.x). Fixes to it go to `main`.
- `slint/native` is the **Halation Slint** integration branch, the unreleased native rebuild in Rust + Slint + Skia.
  Make changes on a dedicated branch/worktree (such as `slint/dev-workflow`), then review before integration.
  The rest of this file is about this native line.

## Getting started

Requirements: Windows 10/11, Git, Python 3.11+ for the read-only developer tools and the Rust/MSVC toolchain pinned by `rust-toolchain.toml` for compilation. Read [AGENTS.md](AGENTS.md) first; it is the only global policy. From the native checkout root:

```powershell
python tools/dev.py onboard
python tools/dev.py map <feature>
python tools/dev.py symbols <feature> --find <name>
python tools/dev.py check --mode targeted    # dry run; does not compile
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains working in integrated slices and selecting proportionate checks; [docs/README.md](docs/README.md) indexes active specs. Run targeted Cargo tests only after a coherent change is ready. `cargo run -p halation-app` opens the native window and is not a setup/onboarding command; use it only for an authorized UI review. Do not run `cargo test --workspace` or release builds automatically just to orient yourself.

## Reporting a bug

Open an issue with the version (Settings → About), Windows version, GPU, what you did, what you expected and what
happened. Do not attach media you are not allowed to share.

## Proposing a change

- Open an issue first for anything larger than a fix, so the direction can be agreed before the work.
- Keep a pull request to one change and follow the style of the code you touch.
- Run relevant targeted checks during development and full CI checks before integration. `python tools/dev.py check --mode targeted` shows what to run; `--run` executes the plan only when explicitly requested. Release builds are separately authorized, not an everyday PR check.
- Interface changes need a screenshot in the pull request; they are merged only after the maintainer reviews them in
  the running app.
- New interface text is English.

## Ground rules

- Media is processed locally. No accounts, telemetry or cloud services.
- Downloader reads public metadata only and never circumvents DRM. Tests use made-up names and IDs, never real songs.
- Third-party code, models and assets need a licence compatible with the GPL v3 and an entry in `THIRD_PARTY.md`.

## AI-assisted development

Halation is developed with extensive use of AI coding agents (Anthropic Claude Code and OpenAI Codex) as engineering
tools: implementation and refactoring, debugging and review, profiling, tests, research and documentation. They follow
the same rules as everyone else, in [AGENTS.md](AGENTS.md).

Product direction, feature scope, interface decisions, visual acceptance, quality thresholds and releases remain
human-led. Agent-produced code is not accepted because it compiles or looks plausible: it is reviewed against the
intended behaviour, tested, measured when performance matters, and visual work is judged in the running application.
The project, not the agent that produced a patch, is responsible for the product and its releases.

## License

Halation is GPL-3.0-or-later (`LICENSE`, `NOTICE.md`). By contributing, you agree that your contribution is licensed
the same way. The name "Halation", the logo, the icon and the wordmark are not covered by the GPL (`TRADEMARKS.md`): a
fork needs its own name and icon.
