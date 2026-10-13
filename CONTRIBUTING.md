# Contributing to Halation

Bug reports, ideas and pull requests are welcome.

## Reporting a bug

Open an issue with the version (Settings → About), Windows version, GPU, what you did, what you expected and what
happened. Logs from `Documents\Halation` help. Do not attach media you are not allowed to share.

## Proposing a change

- Open an issue first for anything larger than a fix, so the direction can be agreed before the work.
- Keep a pull request to one change. Follow the style of the file you touch; `CLAUDE.md` and `docs/ARCHITECTURE.md`
  describe the layout and conventions (one code file per tool, colours only through `app/dist/tokens.css`, animations
  only through `app/dist/motion.js`).
- New interface text goes in `app/dist/locales/en.json`. Translations are welcome as separate pull requests.
- Run the tests of the area you changed (`node app/tests/<area>.js`), and `cargo check`, `cargo clippy -- -D warnings`
  and `cargo test` in `app/src-tauri` when Rust changed.
- Interface changes need a screenshot in the pull request.

## Ground rules

- Media is processed locally. No accounts, telemetry or cloud services.
- Downloader reads public metadata only and never circumvents DRM. Tests use made-up names and IDs, never real songs.
- Third-party code, models and assets need a license compatible with the GPL v3 and an entry in `THIRD_PARTY.md`.

## License

By contributing, you agree that your contribution is licensed under the GNU GPL v3.0 or later, like the rest of
Halation (`LICENSE`, `NOTICE.md`), including the additional permission for GSAP in `NOTICE.md`.
