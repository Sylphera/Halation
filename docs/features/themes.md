# Themes

Status: Implemented and approved by Java in the native window, 2026-10-22 (native beta build 42cb9ca). Java, 2026-10-22: "plateado es el default entonces, ¿se podrían añadir
temas? Un selector de colores que lo cambie a tiempo real"; scope chosen the same day: two presets plus an accent hue.

## 1. What it does

Settings > Interface gains a **Theme** choice that recolours the whole app at once, without a restart: chrome, page,
panels, controls, text, the accent, Activity and the Drape. The choice is stored in `settings.json` and applied at
start before the window shows.

- **Silver** (default): today's palette, neutral greys and the lavender accent; the Drape as recorded.
- **Gold**: the warm variant tried on 2026-10-22 (commit `18f6fef`, reverted as the default in favour of Silver):
  greys with a faint warm bias, warm text, a gold accent at lavender's luminance, amber Activity, the Drape's
  silver-blue turned golden at the same luma.
- **Accent**: a hue strip beside the theme. Any hue in degrees; saturation is fixed (46 %) and the lightness is
  solved so the accent keeps the theme accent's luminance, hence its contrast. Dragging previews the colour across
  the app without saving; releasing, a click or the arrow keys (5° steps) save it. **Default** returns to the
  theme's own accent (stored as 360).

## 2. What stays fixed

- The state colours (warning, Beta, error, success) keep their meaning in every theme. Where a theme's accent falls in
  their hue band, the state colour moves within its own band to stay apart (as the warning did in Gold).
- Contrast: every text pair of `theme.rs` (`text_pairs`) passes AA in every theme; a test runs them over each preset
  with its own accent and with every hue in 5° steps.
- The wordmark's glow (`assets/halation-wordmark-glow.png`) is white bloom and a faint haze; it does not change with the
  theme.

## 3. How it is built

- Rust owns the palettes (`theme.rs`): `Colours` holds every token, `SILVER` and `GOLD` are the presets, `colours()`
  applies an accent hue. `apply_theme` (`app.rs`) sets the `Theme` global's base colours; the material's fills are
  bindings on them (`raised`, `well`, `bubble`, `popover`, `key`, `primary-press`), so they follow.
- The Drape: the backdrop thread reads the theme from an atomic before each frame and rebuilds its colour table
  (256 entries) from `drape-tint.bin` through `Tone::drape` when it changed; the still frame is recoloured once
  (`assets::still`).
- Switching costs one repaint, one colour table and, in Gold, one pass over the still frame; nothing runs at rest.
- Settings stores `theme` (0 Silver, 1 Gold) and `accent_hue` (0–359, 360 the theme's own) as additive fields;
  older files load as Silver. Restore defaults returns to Silver.

## 4. Acceptance

1. Switching theme in Settings recolours every page and the Drape at once; restarting keeps it.
2. The text pairs pass in every theme and hue (test).
3. No timer, polling or animation added at rest.
4. Java's visual OK of each theme in the real window.
