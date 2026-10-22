# Themes

Status: Draft — pending Java's choice of scope (presets only, presets with an accent hue, or a free picker); nothing
implemented yet. Java, 2026-10-22: "plateado es el default entonces, ¿se podrían añadir temas? Un selector de colores
que lo cambie a tiempo real".

## 1. What it does

Settings > Interface gains a **Theme** choice that recolours the whole app at once, without a restart: chrome, page,
panels, controls, text, the accent, Activity and the Drape. The choice is stored in `settings.json` and applied at
start before the window shows.

- **Silver** (default): today's palette, neutral greys and the lavender accent; the Drape as recorded.
- **Gold**: the warm variant tried on 2026-10-22 (commit `18f6fef`, reverted as the default in favour of Silver):
  greys with a faint warm bias, warm text, a gold accent at lavender's luminance, amber Activity, the Drape's
  silver-blue turned golden at the same luma.
- Depending on Java's choice: an **accent hue** picker (hue only; luminance and saturation fixed so contrast holds),
  or a free picker for the accent and the greys' tint.

## 2. What stays fixed

- The state colours (warning, Beta, error, success) keep their meaning in every theme. Where a theme's accent falls in
  their hue band, the state colour moves within its own band to stay apart (as the warning did in Gold).
- Contrast: every text pair of `theme.rs` (`TEXT_PAIRS`) passes in every theme; a test runs them over each preset and
  over the extremes of the hue picker.
- The wordmark's glow (`assets/halation-wordmark-glow.png`) is white bloom and a faint haze; it does not change with the
  theme.

## 3. How it is built

- Rust owns the palettes (`theme.rs`): one struct of tokens per theme, plus the Drape's tint transform. Applying a
  theme sets the `Theme` global's tokens; the tokens that are `out` today (the material's fills) become `in-out`.
- The Drape: the backdrop thread rebuilds its colour table from `drape-tint.bin` with the theme's transform when told
  to (a message, a generation number so a stale frame is dropped); the still frame is recoloured once.
- Switching costs one repaint and one colour table (256 entries); nothing runs at rest.
- Settings stores `theme` (and `accent_hue` if chosen) as additive fields with defaults; older files load as Silver.

## 4. Acceptance

1. Switching theme in Settings recolours every page and the Drape at once; restarting keeps it.
2. `TEXT_PAIRS` pass in every theme (test).
3. No timer, polling or animation added at rest.
4. Java's visual OK of each theme in the real window.
