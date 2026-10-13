# Color rework spec

Status: proposal, not implemented. Colour only: layout, type, components, spacing, radii and motion stay as they are.

## Problem

The interface is built on near-black steps that are too close to tell apart. The window behind the tools (the quiet
field in `soft-light.js`) renders at about `#060606`; the bubbles (`--surface`, `#050504`) are darker than that, and
the cards (`--panel`, `#0b0b0a`) only 3 % lighter. On a monitor, in screenshots and in the README the bubbles read as
holes or vanish, and the screen reads as one black mass with white text on it. Text contrast is fine; what is missing
is the separation between surfaces.

## Direction

Lift every neutral step so that each surface is lighter than the one under it (window < bubble < card < raised),
and give the neutrals a faint cool bias, the hue of the pale blue atmosphere and the periwinkle accent, instead of
the current warm one. The app stays dark; it becomes a dark grey-slate instead of black.

Two levels were prototyped on the real app (same tokens, two intensities). **B is the recommended one.**

- **A · Graphite**: the smallest step that fixes the separation. Window about `#0d0e12`.
- **B · Slate**: one step lighter. Window about `#141519`. Panels read clearly at a glance and in README captures.

## Tokens (`app/dist/tokens.css`)

Only values change; no token is added, renamed or removed. Every other token keeps its value.

| Token | Role | Current | A · Graphite | B · Slate |
| --- | --- | --- | --- | --- |
| `--n-1000` | window, `--bg` | `#000` | `#0b0c0f` | `#101217` |
| `--n-950` | bubbles, `--surface`, `--viewer` | `#050504` | `#16171c` | `#1b1d24` |
| `--n-900` | cards, menus, dialogs, `--panel` | `#0b0b0a` | `#1c1e24` | `#22252d` |
| `--n-850` | | `#121211` | `#212329` | `#282b34` |
| `--n-800` | raised controls, hover, `--raised` | `#1b1b19` | `#282a32` | `#30333d` |
| `--n-700` | `--line`, slider track | `#2a2a27` | `#363944` | `#3f4350` |
| `--n-600` | `--line-strong` | `#3e3e3a` | `#4c505c` | `#575b69` |
| `--n-500` | `--disabled` | `#6d6d67` | `#767a85` | `#7f8390` |
| `--n-400` | `--text-3` | `#908f89` | `#a3a5ae` | `#aaadb7` |
| `--n-300` | `--text-2` | `#b5b5af` | `#c6c8cf` | `#cbcdd4` |
| `--n-200` | `--icon` | `#d7d7d2` | `#dfe0e5` | `#e1e2e7` |
| `--n-100` | `--text-strong` | `#eaeae6` | `#eeeef2` | `#eff0f3` |
| `--n-50` | `--text`, `--primary` | `#f5f5f2` | `#f7f7f9` | `#f8f8fa` |
| `--field` | text fields, selects, segmented tracks | `var(--n-1000)` | `#101115` | `#14161b` |
| `--welcome-surface-low` | Welcome | `#0a0a0a` | `#121317` | `#16181d` |
| `--welcome-surface-mid` | Welcome | `#121212` | `#191a1f` | `#1d1f25` |
| `--welcome-surface-high` | Welcome | `#171717` | `#1f2026` | `#23252c` |
| `--lavender` | accent: sliders, switches, selection, focus | `#a3a8dc` | `#aab0ee` | `#b0b6f2` |
| `--lavender-dim` | | `rgba(163,168,220,.15)` | `rgba(170,176,238,.16)` | `rgba(176,182,242,.17)` |
| `--lavender-line` | | `rgba(163,168,220,.55)` | `rgba(170,176,238,.6)` | `rgba(176,182,242,.62)` |
| `--line-soft` | a bubble's border | `rgba(255,255,250,.075)` | `rgba(235,238,255,.12)` | `rgba(235,238,255,.13)` |
| `--edge` | a bubble's lit top edge | `rgba(255,255,250,.08)` | `rgba(235,238,255,.13)` | `rgba(235,238,255,.14)` |
| `--glass` | bubble over the Home atmosphere | `rgba(5,5,4,.62)` | `rgba(22,23,28,.68)` | `rgba(27,29,36,.7)` |
| `--state-hover` | | `rgba(245,245,242,.06)` | `rgba(247,247,249,.07)` | `rgba(248,248,250,.07)` |
| `--state-press` | | `rgba(245,245,242,.1)` | `rgba(247,247,249,.11)` | `rgba(248,248,250,.11)` |
| `--checker-a` / `--checker-b` | transparency checker | `#2a2a27` / `#1b1b19` | `#363944` / `#282a32` | `#3f4350` / `#30333d` |
| `--prog-fill` | progress bar | `rgba(163,168,220,.45)→rgba(206,209,238,.95)` | `rgba(170,176,238,.5)→rgba(212,215,247,.95)` | `rgba(176,182,242,.5)→rgba(216,219,249,.95)` |

## Backgrounds (shader constants)

The window behind the tools and pages is drawn by WebGL, not by `--bg`, so lifting the tokens alone leaves it black.
Two constants change; the shapes, motion, grain and cadence do not.

| Where | Constant | Current | A | B |
| --- | --- | --- | --- | --- |
| `soft-light.js` `softLight()` (tools, Welcome) | base `col` | `vec3(0.009, 0.010, 0.013)` | `vec3(0.034, 0.037, 0.046)` | `vec3(0.052, 0.057, 0.072)` |
| | first light × | `0.052` | `0.078` | `0.095` |
| | second light × | `0.019` | `0.030` | `0.038` |
| `atmosphere.js` `PAGE` (Library, Settings) | base | `vec3(.006,.006,.005)` | `vec3(.032,.035,.044)` | `vec3(.050,.055,.070)` |

Home's Auralis silk is not touched: it already reads, and it is the most recognisable part of the identity.

## Contrast (WCAG ratio)

Measured with the sRGB relative luminance formula used by `app/tests/contrast.js`. Window values are sampled from the
captures (the shader output), the rest are token values.

| Pair | Current | A | B |
| --- | --- | --- | --- |
| bubble vs window | 1.01 (bubble darker) | 1.08 | 1.08 |
| card vs window | 1.03 | 1.16 | 1.19 |
| raised vs bubble | 1.18 | 1.25 | 1.34 |
| line vs bubble | 1.42 | 1.56 | 1.71 |
| line-strong vs bubble | 1.90 | 2.22 | 2.49 |
| text vs bubble | 18.67 | 16.73 | 15.87 |
| text-2 vs bubble | 9.90 | 10.71 | 10.60 |
| text-3 vs bubble | 6.29 | 7.29 | 7.51 |
| text-3 vs card | 6.07 | 6.78 | 6.84 |
| text-3 vs raised | 5.32 | 5.83 | 5.62 |
| disabled vs bubble | 3.92 | 4.17 | 4.45 |
| accent vs bubble | 8.92 | 8.65 | 8.67 |
| accent fill vs slider track | 6.30 | 5.56 | 5.08 |
| text vs field | 19.23 | 17.63 | 17.06 |
| ok (mint) vs bubble | 10.35 | 9.09 | 8.55 |

Every text pair stays above AA (4.5:1) with margin, and the secondary texts gain contrast. Surface separation is what
improves: the bubble goes from darker than the window to lighter, and borders and tracks become visible.

## What stays

- Dark interface; no light theme.
- The white primary button as the one filled button of a view.
- Periwinkle leads (sliders, switches, selection, focus, progress); it is only made a little brighter so it keeps its
  weight on the lighter surfaces.
- Muted state colours (red, mint, amber, cyan, pink) unchanged.
- The pale blue atmosphere, Home's Auralis silk and the lit top edge of the bubbles.
- Black where black is the content: `--media` (letterbox behind previews), `--matte-dark`, `--scrim`, `--backdrop`,
  `--crop-shade`, `--busy-dim`.
- Cover Test platform colours (`--yt-*`, `--sp-*`, `--sc-*`, …): they copy those sites and are never the interface's.

## Acceptance criteria

1. Only the values listed above change, in `tokens.css`, `soft-light.js` and `atmosphere.js`; no CSS, HTML or layout
   change elsewhere. `node app/tests/colors.js` passes (no colour outside the tokens).
2. In every tool and page, window < bubble < card < raised in luminance, measured on a capture.
3. `app/tests/contrast.js` reports no new failures in either language.
4. Previews, cut-outs and exports are unaffected: the letterbox stays `#000`, exported files are byte-identical for
   the same input (the change touches only the interface).
5. The README captures (`npm run shots`) are regenerated with the new colours in the same commit.
6. The visual reviewer checks the 12 README screens plus Welcome and Settings once at the end.

## Out of scope

- Layout, spacing, radii, type, icons, components, copy.
- Motion and the shape or animation of the backgrounds; only their base level.
- Home's Auralis silk.
- A light theme or a theme switch.
- Brand assets (logo, app icon, README hero artwork).
- Cover Test's platform recreations.

## Prototype

The captures were made with `app/tests/shots.js` against the mocked backend, overriding the tokens above with an
injected stylesheet and the shader constants patched locally; the app code was not changed.
