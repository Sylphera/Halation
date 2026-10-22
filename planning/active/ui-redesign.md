# Anchored UI redesign (Slint beta)

Status: **approved by Java, 2026-10-21 ("se queda así la idea de rediseño")**, including the Drape decision (§8), the Settings category list and the Figma-style tool frame with the Vocal Remover as reference (§9, "así se queda la idea", 2026-10-21); specification only, no code yet. Written for Java's review before any thread implements it (Java, 2026-10-21: "menos
flotante… dock a la izquierda, jobs y todo el resto arriba… que todo se viera más sólido", reference: Linear).
Annex of [docs/SLINT_SPEC.md](../../docs/SLINT_SPEC.md); it supersedes the *layout* parts of `docs/SLINT_VISUAL_SYSTEM.md` (floating rail,
top-right dock, panels with radius 20 and a translucent glass fill) once approved. Identity (Inter, the mark, the
Drape, lavender accent, near-black ground) does not change. Static mockup: Artifact published with this spec (https://claude.ai/artifact/VaQf6JbL7m9DGtNa9xv2hX).

**Implementation (2026-10-22): implemented; approved by Java at `ca076f6` (2026-10-22, "terminado")** in the native window. Done: tokens (§5),
sidebar (§6), top bar (§7), Drape inside Home's content (§8, variant 1), Home, Settings by category and Library (§9),
with headless tests for the sidebar's width rule, `Ctrl+B` and one category at a time. Not done in this pass, on
purpose or for lack of an engine: the tool frame (§9; tools still have no pages, so it has nothing to hold), the 1.2 s
highlight of a found setting, Up/Down between sidebar items, the native title bar's colour, opening a recent file
selected in Library (the row opens Library). The Drape is still decoded at the window's size and drawn in the content
rectangle.

**Workspace (Java, 2026-10-22):** Home, the Library and the jobs are one page, Workspace (sidebar entry and
top-bar title), replacing §9's Home and the Library page: drop line, "Your files" (Files and Sections tabs, the
kind of each file by extension, Remove on hover) taking the height left, and Jobs (up to three rows). No header of
its own: the mark and name live in the sidebar. The sidebar's rows grow with the window's height (28 to 54 px) and
the group headers take the rest, so the tools fill it. Superseded by the entries below.

**Curved, presented (Java, 2026-10-22):** one 12 px radius for every corner; the page is a rounded sheet set into the
chrome (inverted curves where the sidebar and top bar wrap it) with no separator lines. The Workspace presents the
tools as cards, a picture (`assets/art/`, `tools/make-tool-art.py`), the name and one line, with no icons; the sidebar
hides on the Workspace under "Expand when needed", so the navigation is not doubled. Its rows share the height
equally, groups keep one fixed gap, and the Collapse toggle sits in a fixed place above Settings. The ten pictures
take about 6 MB decoded (480 x 300 each). Superseded by the entries below.

**Home back (Java, 2026-10-22):** the original Home (mark, wordmark, tagline, tool strip, drop zone, recent files)
returns as page 0 inside the curved frame, with the frame's tokens; the Workspace (tools, Library, jobs) is page 1 and
keeps everything else. Superseded by the entries below.

**Home only (Java, 2026-10-22):** the Workspace is removed and the Library leaves the sidebar for now (its code stays,
unused); the pages are Home and Settings. The tool pictures and their script went with the Workspace. The sidebar has
no expand modes (Settings' Dock choice is gone): it starts collapsed at every width, opens only with its toggle or `Ctrl+B`,
and pushes the page when open (an overlay was tried and dropped: Java, 2026-10-22, "vuelve a el anterior, se queda
así"). Approved by Java (2026-10-22).

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
| Figma | The tool frame (§9): left panel (layers/pages), central canvas, right inspector with collapsible sections and compact fields, one primary action at the top right; Settings with categories at the left and a dense pane at the right | Floating toolbars over the canvas (the toolbar is docked), multiplayer, free-form canvas |
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
part of the frame. Chrome and canvas are opaque (variant 1 of §8; the tint fallback would make them fills over the Drape).

| Level | Token | Used by |
|---|---|---|
| 0 Chrome | `chrome` | Sidebar, top bar, sub-header |
| 1 Canvas | `canvas` | Content area of every page (Home shows the Drape inside it, §8) |
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
| `canvas-deep` | `#0a0a0b` | (new) the canvas of tool pages |
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

Tabs for Library (References, Sections) sit in a 36 px **sub-header** under the top
bar: text tabs, the active one with `text` colour and a 2 px `accent` underline on the sub-header's own line; same
`chrome` fill.

## 8. Role of the Drape

**Decision (Java, 2026-10-21): variant 1.** The Drape is drawn only inside Home's content area (right of the sidebar,
under the top bar), with the 10 % static grain; the sidebar, top bar and every other page are the opaque `chrome` /
`canvas`. This was the first proposal, kept in the mockup next to the others and chosen after comparing them. Home
keeps the new content of §9 (header, drop line, recent files, Library and Activity blocks) on top of it.

Open point for the implementation, from the comparison: the "bubble" feeling Java raised comes from the content
rectangle's hard edges. Variants A, B and C below stay documented as the fallback if the real native window shows the
same problem; they are a change of two tint numbers (`chrome-tint`, `canvas-tint`), not a new design.

Fallback model, not in force. Two problems (Java, 2026-10-21): inside a rectangle the Drape reads as a bubble, and with an unfilled frame the
background does not differ from the rest of the UI. The balance is a question of **how much of the Drape each layer
of the frame lets through**, so it is specified as a tint per layer instead of a yes/no.

**Model.** The Drape is the window's ground on every page, edge to edge. Over it, three layers, each a `#0b0b0c` /
`#101011` fill at a set opacity (the "tint"), from most to least present: the content where text is read (canvas), the
sidebar and top bar (chrome), and the bare ground of Home. Lines (1 px) and text stay opaque. There is no rectangle
edge anywhere, so nothing is a bubble; what separates frame from content is the tint step and the line, not a fill
change against a different background.

| Variant | Home: chrome / content | Other pages: chrome / content | Reads as |
|---|---|---|---|
| **1 · Content only (chosen)** | 100 % / 0 % | 100 % / 100 % | Drape visible only inside Home's content rectangle, opaque frame; reads as a box, which is the problem above |
| A · Home only | 0 % / 0 % | 100 % / 100 % | Drape is Home's moment; tools are plain dark (the first proposal) |
| B · Balanced | 55 % / 0 % | 80 % / 90 % | The Drape is the app's atmosphere: strong on Home, visible at the edges of every page, never behind running text |
| C · Identity | 35 % / 0 % | 62 % / 78 % | The Drape is everywhere and clearly seen; reading surfaces get dimmer than they should |

If the fallback is needed, B is recommended: it gives Home a clear difference from the rest (the content has no tint, the chrome 55 %) and
carries the identity to every page through the chrome and the margins around the content. Text sits on at least
80 % of near-black on every page but Home, so contrast is fixed by the tint and does not depend on a Drape crest. Home's
text sits on the bare Drape and on 55 % chrome; it is measured on the recorded frames' brightest crest and, if it
fails 4.5:1, the Home chrome rises to 70 %.

**Cost and the rest-state rule.** The moving loop plays **only on Home**. On every other page the ground is the
Drape's still frame (`assets/drape-still.jpg`, the loop's first frame), so nothing animates at rest and the idle cost
of tools is that of one static image. The still and the loop share their first frame, so leaving Home is a fade of the
tints, not a jump. Home's grain stays the 10 % static grain, now drawn on every page over the ground.

**Tint tokens.** `chrome-tint` and `canvas-tint` per page class (`home`, `page`) in the table above, set in Rust
`theme` and exposed as `Theme` alpha values, so Java can change them by number. Tints fade over `motion-duration`
(instant with reduced motion). Hover/active fills are translucent white (8 % / 12 %).

Rejected: Drape only in the content area (a box); a vignette or fade to `canvas` at its edges (a glow, the floating
look again); a different Drape crop per region (the seam would show); a live loop on every page (idle CPU on a tool
the user stares at for an hour).

## 9. Screens

**Home.** Top bar title "Home". The Drape is the ground (§8). The tool strip is removed: the sidebar carries every
tool with labels, and a second list was duplicated navigation. Home becomes a **starting point**, not a launcher:
what is there to continue, what to add, what is going on. One column, 720 px, centred horizontally, starting under
the top bar; blocks are separated by 1 px `line`s and carry no fill, so they sit on the Drape without forming boxes.

1. **Header (left aligned):** the mark (28 px) and "Halation" wordmark small, with the tagline in `muted`. The big
   centred logo of the replica goes; Java can ask for it back as an opening splash on first launch.
2. **Add (primary action):** one wide drop line, 96 px tall, 1 px dashed `line-strong`, no fill, radius 8: "Drop a
   song or an image, or click to browse. Files are added to your Library, never copied."
3. **Recent files:** the last 6 Library references as rows of 40 px (icon by type, name, folder, relative date),
   `line` between, hover `control-hover` at 8 % white. Click opens it in Library selected. Empty: one line "Files you
   add to the Library show up here." "Show all" at the block's right opens Library.
4. **Side by side under Recent, two short blocks of the same style:**
   - **Library:** counts (references, sections, linked folders) and a warning row when files are missing ("3 files
     moved or deleted", opens Library filtered to them).
   - **Activity:** the processes queue summary: "All quiet", or running and finished jobs with a progress line; the
     engines status ("Engines not connected" while the beta has none) with its action. Same content as the top bar's
     Activity popover, so the popover only adds the details.
5. **Footer line:** build label in `subtle`, bottom-left of the content. The "Grain (preview)" slider stays only while
   Java tunes it, as a 28 px control bottom-right.

Everything on Home is data the beta already has (`recent`, library counts, `jobs`, `library-missing`, build label),
so the page needs no new services. Not on Home on purpose: any tool launcher, tips, news. Parked for later, to
`planning/ROADMAP.md` if Java wants them: "Continue where you left" per tool once tool pages exist, pinned sections.

**Tool pages: the tool frame (Java, 2026-10-21: inspired by Figma).** Every tool page uses one frame, so a person
who learned one knows all of them. Filled in when each tool gets its engine; the frame itself is specified now. The
sidebar item is active, the top bar shows the tool's name, and its **page actions** hold the tool's one primary action
(Export, Run, Download: white fill, one per page, like Figma's Share).

```
┌ left panel 220 ┬──────── canvas ────────────────┬ inspector 280 ┐
│ Layers│Looks│… │                                 │ Adjust│Output │
│ rows 28 px     │   the work, on `canvas-deep`    │ ▾ Colour    + │
│ (eye, name)    │                                 │   Temp ──●── │
│                │                                 │ ▾ Tone      + │
│                ├─────────────────────────────────┤ ▾ Grain       │
│                │ docked bar 40: ◀ ▶ time  Fit 100%│   [Amt][Size] │
└────────────────┴─────────────────────────────────┴───────────────┘
```

- **Left panel (220 px, `chrome`):** a 36 px tab strip (Layers, Looks, Files… as the tool needs) over rows of 28 px:
  the list the person works with (layers, queue of inputs, looks). Selected row `control-active`. Optional per tool.
- **Canvas (flexible):** `canvas-deep` (`#0a0a0b`, darker than `canvas`, so the work reads as the centre); the preview
  centred with no frame or shadow; zoom and fit in the docked bar. Pan/zoom keep the Slint-only rule (no shader).
- **Docked bar (40 px, `chrome`, 1 px line above):** transport, time, zoom. It replaces Figma's floating toolbar, which
  would reintroduce the floating look.
- **Inspector (280 px, `chrome`, 1 px line on its left):** a 36 px tab strip (Adjust, Output…) and **sections**: a 32 px
  header (name 600, `+` or chevron at the right), content inside the section, a 1 px line between sections. Content
  types, all compact: **slider row** (label 76 px, 4 px track in `accent`, value right-aligned, 26 px tall), **field**
  (28 px, level 2, label inside at the left), **two-column field pairs**, segmented control, switch, swatch grid and
  thumbnail grid (for looks). Nothing is a card; density target is 8–12 controls visible at 1280 × 800.
- **Panels:** fixed widths in v1, each collapsible (left: `Ctrl+Alt+B`, inspector: `Ctrl+Alt+I`) with the width
  animating at `motion-duration`; below 1180 px of window width the left panel starts collapsed. Drag-resize and
  scrubbing a number by dragging its label (Figma's) are parked.
- Running work shows in the Activity popover and as a 28 px progress strip on top of the docked bar, not in the frame.

**Reference tool: Vocal Remover** (mockup; current layout in `docs/features/vocal-remover.md` §1 was already
queue | player | export, now mapped onto the frame):

| Today | In the tool frame |
|---|---|
| Queue column with per-song status | Left panel, tab Queue (44 px rows: name, duration, status ✓ / % / ○), `+` to add, Separate all and the model credit at its foot |
| Centre: player with Voice / Instrumental lanes, M / S | Canvas: file header (name, length, rate, device chip), time ruler, one 104 px lane per stem with a 136 px label column (name, M, S); the waveform fills in as chunks arrive, the rest stays dim |
| Status line "chunk 14/33 · GPU · ~12 s" | Progress strip above the docked bar (4 px bar, text); transport and time in the docked bar |
| Right column: format, tracks, export when done, Export, Send to | Inspector tab Separate: Model (one selectable card, v2's 4 stems as a disabled card), Device (Auto / CPU only); tab Export: format, save-to (global policy), track checks, Export when done, Send to… The primary Export and Cancel sit in the top bar |
| Drop zone with no file | Canvas empty state with the drop line; Queue empty |

**Settings (Java, 2026-10-21: categories left, settings right; each category is its own tab-page).** No more single
scrolling page with a tab bar that jumps. The content area splits in two:

- **Category list (200 px, left, `canvas`, 1 px line on its right):** General, Interface, You, Files, Processing,
  Tools, Storage, About, as 28 px items in the sidebar's style (hover, active `control-active`). A "Settings" group
  label on top. Selection is interface state, kept only while the app runs.
- **Pane (right):** the selected category alone, so it can be denser and better presented: the category title
  (16 px / 600), then **groups** (heading 13.5 px / 600, e.g. Startup, Behaviour, Frame, Home, Save location, Jobs,
  Advanced) of cells in **two columns** (gap 32 px, `line` above each cell, 44 px minimum height: name with a help
  line on the left, control on the right, selects 150 px). Long controls (a path, a list) take the full width. Max pane
  width 880 px, left aligned to the list, 32 px padding. **Advanced** is a normal group at the foot of its
  category, not a hidden disclosure. Storage and About show values and actions in the same cells.
- **Search and Restore defaults** stay in the top bar's page actions: the search lists matching settings across
  categories in the pane (name, category) and a click opens that category with the cell highlighted for 1.2 s.
  Restore defaults acts on the whole app as today and keeps the same exceptions (language, artist name and links,
  tools turned on or off).
- The sub-header with tabs is gone from Settings; Library keeps its own (References, Sections).

**Library.** Sub-header with References / Sections. References: table full width of the canvas (header 32 px, rows
40 px, `line` between, selected row `control-active`); empty state centred on the canvas with the drop zone style of
Home. Sections: list on the left (240 px, `canvas`, 1 px `line` on its right) and the section's items table at the
right. Search and Add live in the top bar's page-actions slot.

**Jobs.** Still no page; the queue is reachable from the Activity popover.

## 10. Acceptance criteria

1. At 960 × 600, 1280 × 800 and 1920 × 1080, with the sidebar open and collapsed, nothing overlaps or clips; the top
   bar and sidebar header share one baseline and line (`tests/ui_layout.rs` checks bounds).
2. No element has a drop shadow, blur or translucent fill except hover/active fills; only overlays have a border and
   radius 8. A search of `ui/` finds no `glass`, `hairline` or `sheen` token left.
3. Settings shows the category list and one category pane; every setting of today is reachable in exactly one
   category and from search. The tool frame has the §9 regions (left panel 220, inspector 280, docked bar 40).
3b. Exactly one sidebar item is active and it matches the page; turned-off tools leave no gap or empty group label.
4. The Drape and grain are drawn only inside Home's content rectangle; leaving Home frees them as today.
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
- Parked, to `planning/ROADMAP.md` only if Java wants them: command palette (`Ctrl+K`) in the top bar centre; custom title
  bar merged into the top bar; collapsible sidebar groups; drag-resizable panels and drag-to-scrub numbers in the tool frame.

## 12. Out of scope

Custom title bar and window controls; any tool's own content and engine; Figma's canvas, comments or multiplayer; command palette or global search; light theme; tool pages and engines; a status
bar; sidebar groups the user can reorder or collapse; hover-reveal sidebar; changes to Drape, grain, copy, icons or
the Settings/Library feature set; Spanish strings.
