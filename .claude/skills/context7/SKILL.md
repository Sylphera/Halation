---
name: context7
description: Look up current documentation of a library (Slint, winit, Skia bindings, windows-rs, Media Foundation, FFmpeg…) with the Context7 CLI before using an API that is not already in Halation's code.
---

# Context7 (CLI)

Use before writing code against an API that the repository does not already use, or when unsure of a signature.

```
npx ctx7 library <name> "<what you need>"      # → library id, e.g. /slint-ui/slint
npx ctx7 docs <library id> "<question>"         # → current docs and examples
```

- Libraries used here: Slint 1.18 (`/slint-ui/slint`), windows-rs, serde, FFmpeg.
- Quote only what the answer shows; check it against the version in `Cargo.lock`.
- Needs network access to `context7.com`; set `CTX7_TELEMETRY_DISABLED=1`. If the host is blocked, say so and fall back
  to the crate sources in `~/.cargo/registry`.
