# Color rework spec

> **Historical Tauri palette study:** this document describes Graphite/CSS experiments in the published web UI. The native Silver/Gold/accent choices are described in [design/design.md](design/design.md) and [features/themes.md](features/themes.md). Do not apply the old `tokens.css` palette to Slint.

Status: implemented (#12) with D tokens and the H backgrounds, then darkened to **Graphite** (Java, 2026-10-14, #21; see
[Graphite](#graphite-java-2026-10-14)): the values in `tokens.css` are Graphite's, D stays below as the step it came
from. Colour only: layout, type, components, spacing, radii and motion stay as they are.

## Problem

The interface is built on near-black steps that are too close to tell apart. The window behind the tools (the quiet
field in `soft-light.js`) renders at about `#060606`; the bubbles (`--surface`, `#050504`) are darker than that, and
the cards (`--panel`, `#0b0b0a`) only 3 % lighter. On a monitor, in screenshots and in the README the bubbles read as
holes or vanish, and the screen reads as one black mass with white text on it. Text contrast is fine; what is missing
is the separation between surfaces.

## Direction

Keep the window near black and lift what sits on it: the dock, the bubbles, the cards and the raised controls, in
neutral greys with the current faint warm bias. The separation comes from the distance between the window and the
layers on it, so the window must not rise with them, and there is no blue tint (a first round with cool slate
neutrals lifted the window too and read as monochrome; it was rejected).

Two levels were prototyped on the real app. **D is the chosen one** (checked on an AMOLED phone as well as a desktop
monitor). C stays in the tables as the reference step.

- **C · Neutral**: the window as it is; bubbles and cards lifted.
- **D · Neutral +**: one step more on every layer, and the window a touch above black so the dock's edge and the
  bubbles' borders still read on dark monitors.

## Tokens (`app/dist/tokens.css`)

Only values change; no token is added, renamed or removed. Every token not listed keeps its value, including the
accents (periwinkle and the state colours), the text colours above `--n-400`, and `--n-1000` (`#000`).

| Token | Role | Current | C · Neutral | D · Neutral + |
| --- | --- | --- | --- | --- |
| `--n-950` | dock, bubbles, `--surface`, `--viewer` | `#050504` | `#151514` | `#1a1a19` |
| `--n-900` | cards, sections, menus, dialogs, `--panel` | `#0b0b0a` | `#1d1d1b` | `#232321` |
| `--n-850` | | `#121211` | `#232321` | `#2a2a28` |
| `--n-800` | raised controls, hover, `--raised` | `#1b1b19` | `#2a2a27` | `#31312e` |
| `--n-700` | `--line`, slider track | `#2a2a27` | `#353532` | `#3d3d39` |
| `--n-600` | `--line-strong` | `#3e3e3a` | `#4a4a46` | `#55554f` |
| `--n-500` | `--disabled` | `#6d6d67` | `#6d6d67` | `#74746e` |
| `--n-400` | `--text-3` | `#908f89` | `#9a9993` | `#9a9993` |
| `--field` | text fields, selects, segmented tracks | `var(--n-1000)` | `#0a0a09` | `#0d0d0c` |
| `--welcome-surface-low` | Welcome | `#0a0a0a` | `#111110` | `#141413` |
| `--welcome-surface-mid` | Welcome | `#121212` | `#191918` | `#1c1c1b` |
| `--welcome-surface-high` | Welcome | `#171717` | `#1f1f1d` | `#232321` |
| `--line-soft` | a bubble's border | `rgba(255,255,250,.075)` | `rgba(255,255,250,.10)` | `rgba(255,255,250,.11)` |
| `--edge` | a bubble's lit top edge | `rgba(255,255,250,.08)` | `rgba(255,255,250,.11)` | `rgba(255,255,250,.12)` |
| `--glass` | bubble over the Home atmosphere | `rgba(5,5,4,.62)` | `rgba(21,21,20,.66)` | `rgba(26,26,25,.68)` |
| `--checker-a` / `--checker-b` | transparency checker | `#2a2a27` / `#1b1b19` | `#353532` / `#2a2a27` | `#3d3d39` / `#31312e` |

## Backgrounds (shader constants)

The window behind the tools and pages is drawn by WebGL, not by `--bg`, and Home is Drape'ss silk. With D's tokens
they read too dark, so they are lifted too; only base levels, light gains and Home's target brightness change, never
the shapes, grain, motion or hues. The chosen amount is H; I (a stronger lift) stays as the reference.

| Where | Constant | Current | H · D + background (chosen) | I · D + background + (reference) |
| --- | --- | --- | --- | --- |
| `soft-light.js` `softLight()` (tools, Welcome) | base `col` | `vec3(0.009, 0.010, 0.013)` | `vec3(0.032, 0.032, 0.031)` | `vec3(0.046, 0.046, 0.045)` |
| | first light × | `0.052` | `0.068` | `0.080` |
| | second light × | `0.019` | `0.025` | `0.030` |
| `atmosphere.js` `PAGE` (Library, Settings) | base | `vec3(.006,.006,.005)` | `vec3(.030,.030,.029)` | `vec3(.044,.044,.042)` |
| `drape.js` `DEFAULTS.colors` (Home) | base, middle | `#020203`, `#5d6577` | `#0c0c0d`, `#5d6577` | `#161618`, `#6a7284` |
| `drape.js` `F` | `target`, `maxExposure` | `.054`, `1.25` | `.07`, `1.25` | `.11`, `1.5` |

Sampled results: the tool window goes from about `#060606` to `#111111` (H) or `#161616` (I), always below the bubbles
(`#1a1a19`); Home's mean brightness goes from 14.5 to 20 (H) or 29 (I) on 0–255.

## Contrast (WCAG ratio)

Measured with the sRGB relative luminance formula used by `app/tests/contrast.js`. The window is sampled from the
captures (shader output: about `#060606` now and in C, `#0b0b0b` in D); the rest are token values.

| Pair | Current | C | D |
| --- | --- | --- | --- |
| bubble vs window | 1.01 (bubble darker) | 1.11 | 1.13 |
| card vs window | 1.03 | 1.20 | 1.25 |
| card vs bubble | 1.04 | 1.08 | 1.11 |
| raised vs bubble | 1.18 | 1.27 | 1.33 |
| field vs bubble | 1.03 | 1.08 | 1.12 |
| line vs bubble | 1.42 | 1.49 | 1.60 |
| line-strong vs bubble | 1.90 | 2.05 | 2.32 |
| text vs bubble | 18.67 | 16.73 | 15.95 |
| text-2 vs bubble | 9.90 | 8.87 | 8.45 |
| text-3 vs bubble | 6.29 | 6.29 | 6.10 |
| text-3 vs card | 6.07 | 5.80 | 5.51 |
| text-3 vs raised | 5.32 | 4.93 | 4.57 |
| accent vs bubble | 8.92 | 8.00 | 7.62 |
| accent fill vs slider track | 6.30 | 5.39 | 4.77 |

Every text pair stays above AA (4.5:1); `--text-3` is raised to `#9a9993` so it still clears AA on raised controls.
For the same reason `--red` goes from `#df7a70` to `#e17d73`: on D's `--raised` (`#31312e`) the old red reads 4.45:1
(Grade's layer menu Delete, an errored row in Vocal Remover's queue) and the new one 4.59:1; `--red-dim` and
`--red-line` keep their values.
What improves is the separation: the bubbles go from darker than the window to clearly above it, and cards, fields,
borders and tracks each sit on their own step.

## Graphite (Java, 2026-10-14)

After living with D, the surfaces read too grey ("se ha perdido calidad"). Five darker neutrals were compared on one
Grade capture (Carbón `#141413`, Grafito `#111111`, Tinta `#0e0e0d`, Azabache `#0b0b0c`, Noche azulada `#0d0e11`);
**Grafito** was chosen and shipped with the dock in #21. Only the surface steps change; the lines, the text colours,
`--red` (`#e17d73`), the checker, the accents and the H backgrounds keep D's values.

| Token | D · Neutral + | Graphite (current) |
| --- | --- | --- |
| `--n-950` (`--surface`, `--viewer`) | `#1a1a19` | `#111111` |
| `--n-900` (`--panel`) | `#232321` | `#191919` |
| `--n-850` | `#2a2a28` | `#1e1e1e` |
| `--n-800` (`--raised`) | `#31312e` | `#242424` |
| `--field` | `#0d0d0c` | `#080808` |
| `--welcome-surface-low` / `-mid` / `-high` | `#141413` / `#1c1c1b` / `#232321` | `#080808` / `#111111` / `#191919` |
| `--glass` | `rgba(26,26,25,.68)` | `rgba(17,17,17,.68)` |

Contrast on Graphite's tokens (same formula as above): text-3 vs bubble 6.61, vs card 6.16, vs raised 5.43; `--red`
vs raised 5.46 (the old `#df7a70` would also pass, 5.29, but `#e17d73` stays); line vs bubble 1.73, line-strong vs
bubble 2.52; card vs bubble 1.07, raised vs bubble 1.22, field vs bubble 1.06. Every text pair stays above AA.

What changes against D: the bubbles now sit at about the level of the H tool window (`#111111`), so they are told
apart from it by their border (`--line-soft`) and lit top edge rather than by luminance; cards, raised controls and
fields keep their own steps above and below the bubble. Acceptance criterion 2 reads with that in mind: bubble ≥
window, card and raised above the bubble.

## Darker backgrounds (Java, 2026-10-14)

The H backgrounds still read too bright behind the Graphite surfaces. Four darker tones of the same backgrounds were
compared (Tone 1 to 4: base and light gains × .75, .55, .40, .28; shapes, hues, grain and motion unchanged). Chosen:
**Tone 2 (× .55) for the tools and Home**, **Tone 1 (× .75) for Library and Settings**.

| Where | Constant | H | Now |
| --- | --- | --- | --- |
| `soft-light.js` `softLight()` (tools, Welcome) | base `col`, first light ×, second light × | `vec3(0.032, 0.032, 0.031)`, `0.068`, `0.025` | `vec3(0.0176, 0.0176, 0.0171)`, `0.0374`, `0.0138` |
| `atmosphere.js` `PAGE` (Library, Settings) | light gains, base | `.08`, `.042`, `vec3(.030,.030,.029)` | `.06`, `.0315`, `vec3(.0225,.0225,.0218)` |
| `drape.js` `F.level` (Home) | the stabilised silk as shown | `1` | `.55` |

Home keeps its stabiliser (target `.07`, exposure `.8`–`1.25`) and is scaled as it is presented, so the silk keeps its
shape and coverage; `app/tests/drape.js` measures it at `.55` (mean about `.038`, "lit" above `.044`). Sampled mean
brightness on 0–255: tools 16 → 11, pages 10 → 8, Home 14 → 7; the bubbles (`#111111`) now sit clearly above the
window.

## What stays

- Dark interface; no light theme.
- The white primary button as the one filled button of a view.
- Periwinkle leads (sliders, switches, selection, focus, progress), unchanged.
- Neutral greys with the current faint warm bias; no blue tint.
- The window near black.
- Muted state colours (red, mint, amber, cyan, pink) unchanged.
- The pale blue atmosphere, the shape, hues and motion of Home's Drape silk, and the lit top edge of the bubbles.
- Black where black is the content: `--media` (letterbox behind previews), `--matte-dark`, `--scrim`, `--backdrop`,
  `--crop-shade`, `--busy-dim`.
- Cover Test platform colours (`--yt-*`, `--sp-*`, `--sc-*`, …): they copy those sites and are never the interface's.

## Acceptance criteria

1. Only the D token values and the H background values above change, in `tokens.css`, `soft-light.js`,
   `atmosphere.js` and `drape.js`; no CSS, HTML or layout
   change elsewhere. `node app/tests/colors.js` passes (no colour outside the tokens).
2. In every tool and page, window < bubble < card < raised in luminance, measured on a capture; the dock, the
   bubbles and the cards are told apart at a glance in the README captures.
3. `app/tests/contrast.js` reports no new failures in either language.
4. Previews, cut-outs and exports are unaffected: the letterbox stays `#000`, exported files are byte-identical for
   the same input (the change touches only the interface).
5. The README captures (`npm run shots`) are regenerated with the new colours in the same commit.
6. The visual reviewer checks the 12 README screens plus Welcome and Settings once at the end.

## Out of scope

- Layout, spacing, radii, type, icons, components, copy.
- Motion and the shape, lights or animation of the backgrounds.
- Accent and state colours.
- A light theme or a theme switch.
- Brand assets (logo, app icon, README hero artwork).
- Cover Test's platform recreations.

## Prototype

The captures were made with `app/tests/shots.js` against the mocked backend, overriding the tokens above with an
injected stylesheet and the shader constants patched locally; the app code was not changed.
