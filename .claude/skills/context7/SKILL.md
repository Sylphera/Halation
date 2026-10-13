---
name: context7
description: Look up current documentation of a library (Tauri, Mediabunny, WebCodecs, WebGL, FFmpeg…) with the Context7 CLI before using an API that is not already in Halation's code.
---

# Context7 (CLI)

Use before writing code against an API that the repository does not already use, or when unsure of a signature.

```
npx --prefix app ctx7 library <name> "<what you need>"      # → library id, e.g. /tauri-apps/tauri-docs
npx --prefix app ctx7 docs <library id> "<question>"         # → current docs and examples
```

- Libraries used here: Tauri 2 (`/tauri-apps/tauri-docs`), Mediabunny, WebCodecs and WebGL (MDN), FFmpeg.
- Quote only what the answer shows; check it against the version in `app/package.json` / `Cargo.toml`.
- Needs network access to `context7.com`; set `CTX7_TELEMETRY_DISABLED=1`. If the host is blocked, say so and
  fall back to the crate or package sources in `node_modules` / `~/.cargo/registry`.
