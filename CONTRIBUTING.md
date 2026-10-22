# Contributing to Halation

Bug reports, ideas and pull requests are welcome.

## Two lines

- `main` is **Halation Tauri**, the published app (1.x). Fixes to it go to `main`.
- `slint/native` is **Halation Slint**, the native rebuild in Rust + Slint + Skia. It is not released yet; new work
  goes here. The rest of this file is about it.

## Getting started

Windows 10 or 11, Rust (the version in `rust-toolchain.toml`) with the MSVC toolchain, and Python 3 for the docs
checker. From the repository root:

```powershell
cargo run -p halation-app            # the app, with a profile of its own
cargo test --workspace               # the tests
```

Read [AGENTS.md](AGENTS.md) (the rules, for people and agents alike) and [docs/README.md](docs/README.md) (what to
read before touching each part).

## Reporting a bug

Open an issue with the version (Settings → About), Windows version, GPU, what you did, what you expected and what
happened. Do not attach media you are not allowed to share.

## Proposing a change

- Open an issue first for anything larger than a fix, so the direction can be agreed before the work.
- Keep a pull request to one change and follow the style of the code you touch.
- Run the checks listed in `AGENTS.md` (fmt, clippy, tests, release build, docs checker).
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
