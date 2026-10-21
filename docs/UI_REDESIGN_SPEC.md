# Anchored UI redesign (Slint beta)

Status: **specification only**, for Java's review before any thread implements it (Java, 2026-10-21: "menos
flotante… dock a la izquierda, jobs y todo el resto arriba… que todo se viera más sólido", reference: Linear).
Annex of `docs/SLINT_SPEC.md`; it supersedes the *layout* parts of `docs/SLINT_VISUAL_SYSTEM.md` (floating rail,
top-right dock, panels with radius 20 and a translucent glass fill) once approved. Identity (Inter, the mark, the
Drape, lavender accent, near-black ground) does not change. Static mockup: Artifact published with this spec (https://claude.ai/artifact/VaQf6JbL7m9DGtNa9xv2hX).

## 1. Problem and guiding criterion

Guiding criterion (Java): the application must feel like **a real tool interface**. Every decision below is judged
by that: a fixed frame the user learns once, density over decoration, state shown by surface and line, and nothing
that looks like a widget placed over a wallpaper.

The replica is a set of floating objects over a background: a rail pill at x 22, a dock pill at the top right, a
notice pill at the top centre, rounded panels (radius 20–26) in translucent grey, a tool strip pill, a dashed drop
card. Each object has its own margin, radius and edge, so nothing shares a line and the window reads as a desktop with
widgets. The target is an application: a frame (sidebar + top bar) that never moves, and one content area attached to
it.

## 2. References and what is taken from each

| UI | Taken | Not taken |
|---|---|---|
| Linear | Full-height sidebar with labelled groups; compact rows (28 px); a thin top bar with title left and actions right; 1 px dividers instead of cards; list rows as the basic unit; one accent used for state only | The inset rounded content panel with a margin (it floats; Java asked for solid, so content is flush) |
| Raycast | Density and keyboard-first feel: every sidebar item and top-bar action has a shortcut and a tooltip with it | Overlay command window (kept as a parked idea, §11) |
| Arc | Collapsible sidebar that keeps icons; collapse by button and shortcut | Hover-reveal overlay sidebar, tab/space model |
| Figma | Fixed-width inspector on the right of a canvas for tool pages; toolbar actions as 28 px icon buttons | Floating toolbars over the canvas |
| DaVinci Resolve | Flush panels separated by 1 px gaps in neutral near-black; the surface level, not shadows, tells what is on top | Page tabs at the bottom |
| VS Code | Activity/sidebar split and a status line only when it carries state | Always-on status bar (Halation has no use for one) |

## 3. Layout

Window minimum stays 960 × 600. Coordinates for 1920 × 1080 below; every region is flush to its neighbours (no gap,
no margin, no radius at the frame).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ native title bar (Windows, 32 px, kept)                                      │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ◐ Halation  ⟨ │  Library · Sections             [ page actions ]  ● ⌨ 🗀 🌐 💾│ 44 px
├───────────────┼──────────────────────────────────────────────────────────────┤  ← 1 px line
│ Home          │ (optional sub-header: tabs, 36 px, 1 px line under)          │
│ Library       │──────────────────────────────────────────────────────────────│
│               │                                                              │
│ GET           │                                                              │
│  Downloader   │                      CONTENT AREA                            │
│  Converter    │      (one scroll per page; Drape only on Home)               │
│ AUDIO         │                                                              │
│  Vocal Rem.   │                                                              │
│  Visualizer   │                                                              │
│ IMAGE         │                                                              │
│  Grade        │                                                              │
│  Cover Test   │                                                              │
│  Bg Remover   │                                                              │
│  Upscale      │                                                              │
│ VIDEO         │                                                              │
│  Interpolate  │                                                              │
│  Frame Capt.  │                                                              │
│               │                                                              │
│ ⚙ Settings    │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
   224 px  ↑ 1 px line
```

Decision on the corner: the **sidebar owns the full height** and the top bar spans the rest. The sidebar's header
row (mark, name, collapse button) is exactly the top bar's height with the same bottom line, so the two read as one
band across the whole window. The alternative (top bar over everything, sidebar below it) is the VS Code arrangement;
it was not chosen because the mark then competes with the page title on one row and the sidebar loses its column.

Native title bar: **kept** in this pass (snap layouts, resize borders and accessibility come free). Its grey differs
from the chrome, so the implementation should try to colour it with the chrome token through winit's Windows title
background colour (Windows 11); if Slint does not expose it, it stays as is. A custom title bar merged into the top
bar is out of scope (§12).

## 4. Surfaces and borders

Depth comes from three flat levels and 1 px lines. No shadow, no blur, no translucency, no radius on anything that is
part of the frame. Chrome and canvas are opaque, so nothing is blended over the Drape video.

| Level | Token | Used by |
|---|---|---|
| 0 Chrome | `chrome` | Sidebar, top bar, sub-header |
| 1 Canvas | `canvas` | Content area of every page except Home (Home shows the Drape) |
| 2 Control | `control` | Inputs, selects, buttons (secondary), drop zone, search fields |
| 3 Hover | `control-hover` | Hover of any row, item or control |
| 4 Active | `control-active` | Pressed, selected row, active sidebar item, open menu item |

- **Lines:** `line` (1 px) between sidebar and content, under the top bar and sub-header, and between list rows.
  `line-strong` for control borders and hover. Lines are opaque colours, not alpha, so they cost nothing to blend.
- **Grouping without cards:** a Settings group is a heading plus rows separated by `line`, directly on the canvas. A
  list is a table: header row, rows edge to edge, `line` between them. The only filled rectangles inside content are
  controls (level 2) and the selected row (level 4).
- **Overlays** (menus, tooltips, language/shortcut dialogs, the notice's expanded state) are the one place with a
  raised look: level 2 fill, 1 px `line-strong` border, radius 8, no shadow. They are never part of the frame.
- **Focus:** 2 px `accent` border on the focused control or row, as today.

## 5. Tokens (Rust `theme` → Slint `Theme`; defaults)

Existing text and accent tokens are kept. Surface tokens replace `ground`, `ground-top`, `panel`, `raised`, `field`,
`glass`, `hairline`, `sheen`. Contrast was computed against the table's surfaces (WCAG): text 14.4–18.0:1, muted
7.6–9.6:1, subtle 5.5–6.9:1, accent 6.9–8.6:1, all above 4.5:1; `tests/services.rs` keeps asserting them per ground.

| Token | Default | Replaces |
|---|---|---|
| `chrome` | `#0b0b0c` | `ground`, `rail` |
| `canvas` | `#101011` | `ground`, `ground-top`, `panel` |
| `control` | `#161617` | `field`, `panel` on controls |
| `control-hover` | `#1c1c1e` | `raised` (hover) |
| `control-active` | `#232325` | `raised` (selected) |
| `line` | `#1f1f21` | `hairline`, `sheen` |
| `line-strong` | `#2d2d30` | `line` (control borders) |
| `text` / `muted` / `subtle` | `#f5f5f2` / `#b5b5af` / `#9a9993` | unchanged |
| `accent` | `#a3a8dc` | unchanged (state, focus, links, active icon) |
| `activity` / `warning` / `danger` / `success` | unchanged | unchanged |

| Metric | Default |
|---|---|
| Sidebar width, open / collapsed | 224 px / 52 px |
| Top bar height (and sidebar header) | 44 px |
| Sub-header (tabs) height | 36 px |
| Sidebar item height / icon / text | 28 px / 16 px / 12.5 px, weight 500 |
| Sidebar group label | 11 px, weight 500, `subtle`, sentence case, 12 px above, 4 px below |
| Icon button (top bar) | 28 × 28 px, 16 px icon |
| Control height (compact / regular) | 28 px / 32 px |
| Table row / header row | 40 px / 32 px |
| Radii | frame 0, controls 6, overlays and drop zone 8 |
| Spacing steps | 4, 8, 12, 16, 24, 32 |
| Page title (top bar) | 13.5 px / 600 |
| Section heading in content | 13.5 px / 600; body 12.5 px; caption 11 px |

Sentence case everywhere; nothing under 10.5 px.

## 6. Sidebar

- **Header row (44 px):** the mark (20 px) and "Halation" (13.5 px / 600) on the left; the collapse button on the
  right. Clicking the mark goes Home.
- **Top group (places):** Home, Library. Library is a place, so it leaves the tool list.
- **Tool groups** from `catalog.rs`: Get (Downloader, Converter), Audio (Vocal Remover, Audio Visualizer), Image
  (Grade, Cover Test, Background Remover, Upscale), Video (AI Interpolate, Frame Capture). Group labels are static
  text (no collapsible sections in v1). A group whose tools are all turned off in Settings → Tools disappears with its
  label; a turned-off tool never leaves a gap.
- **Bottom:** Settings, pinned to the foot, with a `line` above it. Nothing else lives there.
- **Item states:** rest `muted` text and icon; hover `control-hover` and `text`; active `control-active`, `text`
  and the icon tinted `accent`; focus 2 px accent. No accent bar on the edge. Item radius 6 with 8 px side padding
  inside the sidebar.
- **Collapsed (52 px):** icons only, centred; group labels become a 1 px `line` divider; each item shows a tooltip
  (level-2 overlay) with its name on hover and keyboard focus. The header shows the mark only; the toggle sits at the
  bottom above Settings.
- **Behaviour:** open by default at 1180 px of window width and wider, collapsed below. The user's toggle (button or
  `Ctrl+B`) wins until the window crosses that width again. Like every interface state, it is not persisted
  (`CLAUDE.md`: interface state lives only while the app runs). The existing "dock mode: keep open" preference keeps
  the sidebar open regardless of width. The content moves with the width over `motion-duration × 1.6`, ease-out
  (today's rail timing); 0 ms with reduced motion.
- **Keyboard:** Up/Down move between items, Enter opens, `Ctrl+B` toggles. Accessible role and label per item as
  today.

## 7. Top bar (44 px)

Left to right, on `chrome`, with a 1 px `line` underneath and no inner dividers.

1. **Title / breadcrumb:** the page name (Home, Library · Sections · *name*, Settings, tool name), 13.5 px / 600, with
   muted parent segments. This replaces the page titles currently drawn inside the pages.
2. **Notice slot:** the one-line notice (today a floating pill) is drawn inline after the title, in `muted`, elided,
   with a dismiss ✕ at its end. It appears and clears with an opacity fade; it never overlays content. Warning and
   error notices use the state colour for their text and icon only.
3. **Page actions slot (optional):** controls that belong to the page and are today inside it: Library's search and
   Add, Settings' search and Restore defaults. Fixed order: search field (240 px, level 2), then buttons.
4. **Global actions (right):** Activity (the jobs/processes indicator: a dot in `activity` while working, with the
   count; opens the activity popover that exists today through `dock-action("activity")`), keyboard shortcuts, Halation
   folder, language, Save session. Icon buttons, 28 px, tooltip with name and shortcut. "Show processes dock" in
   Settings (`prefs.show-dock`) hides the whole global group, as it hides the dock today.

Tabs for Settings (General … About) and Library (References, Sections) sit in a 36 px **sub-header** under the top
bar: text tabs, the active one with `text` colour and a 2 px `accent` underline on the sub-header's own line; same
`chrome` fill.

## 8. Role of the Drape

Recommendation: **the Drape lives only inside Home's content area** (the region right of the sidebar and under the
top bar), with the existing 10 % static grain over it. The sidebar, top bar and every other page are flat `chrome` /
`canvas`.

Why: (1) the frame is what makes the window read as solid, and a moving field behind it would put back what is being
removed; (2) opaque chrome means no alpha blending over video frames, and the video is decoded and scaled to a smaller
rectangle than today's full window, which is cheaper; (3) Home keeps the identity moment, as `docs/DECISIONS.md`
already has it ("Home is lit and moving, the tools almost black and nearly still"). Header and sidebar are *not*
translucent over it, because translucency is the floating look in another form.

Edge case: Home at the top-left corner meets the sidebar line and the top bar line directly, with no fade. The Drape
loop's frames are scaled with `image-fit: cover` to the content area, not the window, so its composition stays centred
on what is visible.

## 9. Screens

**Home.** Top bar title "Home"; Drape in the content area. Centre: mark, wordmark, tagline as today. The **tool strip
is removed**: the sidebar now carries every tool with labels, and a second list was the duplication the first visual
pass already flagged (this is the one change to Home's content, and it is easy to restore as a row under the tagline).
The drop zone is a level-2 rectangle (fill, 1 px dashed `line-strong`, radius 8) 560 px wide, and the Recent files
strip becomes a single line under it with no filled bar. The temporary "Grain (preview)" slider is dropped from the
frame; if it stays for Java's tuning it is a small control in the content's bottom-right, not a panel.

**Tool pages (future, when engines exist).** The sidebar item is active and the top bar shows the tool name. Content is
a canvas plus an optional **inspector** on the right: 300 px, `chrome` fill, 1 px `line` on its left edge, collapsible
with a top-bar action. Its sections are headings with rows, never cards. Running work shows in the Activity popover and
as a 28 px progress strip at the bottom of the tool's own canvas when needed, not in the frame.

**Settings.** Sub-header with the tabs and the existing scroll-follow behaviour. Content: one column, 760 px maximum,
centred in the canvas (narrower windows use 24 px side padding). Each section: heading (13.5 px / 600), rows of 48 px
with name and help text on the left, the control right-aligned at 260 px, `line` between rows, 32 px between
sections. No panel fill, no radius on groups. "Advanced" stays a disclosure row.

**Library.** Sub-header with References / Sections. References: table full width of the canvas (header 32 px, rows
40 px, `line` between, selected row `control-active`); empty state centred on the canvas with the drop zone style of
Home. Sections: list on the left (240 px, `canvas`, 1 px `line` on its right) and the section's items table at the
right. Search and Add live in the top bar's page-actions slot.

**Jobs.** Still no page; the queue is reachable from the Activity popover.

## 10. Acceptance criteria

1. At 960 × 600, 1280 × 800 and 1920 × 1080, with the sidebar open and collapsed, nothing overlaps or clips; the top
   bar and sidebar header share one baseline and line (`tests/ui_layout.rs` checks bounds).
2. No element of the frame or content has a drop shadow, blur or translucent fill; only overlays have a border and
   radius 8. A search of `ui/` finds no `glass`, `hairline` or `sheen` token left.
3. Exactly one sidebar item is active and it matches the page; turned-off tools leave no gap or empty group label.
4. The Drape and grain are drawn only in Home's content rectangle; leaving Home frees them as today.
5. Every text token passes 4.5:1 on every surface it is drawn on (existing test, extended to the new grounds).
6. Notice, Activity, shortcuts, language and Save session work from the top bar exactly as from the dock today.
7. Collapsing/opening the sidebar and `Ctrl+B` work; reduced motion turns the 1.6× transition off.
8. No timer, shader or animated property at rest; idle CPU/GPU on Home is not above the current build's
   (`scripts/measure-renderers.ps1` before and after).
9. `cargo fmt --check`, clippy `-D warnings`, `cargo test`, release build. Visual approval by Java in the real native
   window before merge (`CLAUDE.md`: nothing implemented blind), then the preview on KernelPanic.

## 11. Implementation notes (for the thread that implements it)

- Touches `ui/app.slint` (frame, no more floating rail/dock/notice), `ui/components/rail-item.slint` (becomes the
  sidebar item), `ui/components/top-dock.slint` (becomes top-bar actions), `ui/theme.slint` and `src/theme.rs`
  (tokens), the page files (remove inner titles and panels). Navigation, services and callbacks do not change.
- Slint cannot draw custom shaders; everything above is rectangles, 1 px lines, text and icons.
- This work edits the same files the crates restructuring (core and app) moves: implement after that merges.
- Parked, to `docs/ROADMAP.md` only if Java wants them: command palette (`Ctrl+K`) in the top bar centre; custom title
  bar merged into the top bar; collapsible sidebar groups; a right-hand inspector pattern for tools.

## 12. Out of scope

Custom title bar and window controls; command palette or global search; light theme; tool pages and engines; a status
bar; sidebar groups the user can reorder or collapse; hover-reveal sidebar; changes to Drape, grain, copy, icons or
the Settings/Library feature set; Spanish strings.
