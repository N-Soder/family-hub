# Design standard

One look for every Family Hub surface. Chosen by the owner 2026-10-31 ("Storybook" over two
other mockups; ADR-20). The Planner PWA, the wall and the Board (`/board`, ADR-30) use it.

## Type
| Role | Font | Notes |
|---|---|---|
| Headings, page titles, routine names, the wordmark | **Fraunces** (variable, OFL) | `'SOFT' 100, 'WONK' 1`, weight 650 |
| Everything else | **Outfit** (variable, OFL) | body 400–500, labels 600, emphasis 700 |

Files and licences: `src/lib/fonts/` (latin subset from Fontsource), declared in
`src/lib/theme.css`. Vite bundles them under `/_app/immutable/assets/`, which is public
through the tunnel and cached by the service worker. No Google Fonts requests.

Phone sizes: titles 2.1rem, section heads 1.4rem, body 16–17px (17px in inputs so iOS does
not zoom).

## Colour
Warm paper ground with saturated tones, not pastels. All tokens are in `src/lib/theme.css`, with
a matching dark set.

| Token | Light | Use |
|---|---|---|
| `--bg` / `--card` | `#fff8ee` / `#fff` | page / cards |
| `--ink` / `--muted` | `#23253a` / `#6a6458` | text |
| `--accent` | tomato `#e2553e` | ticks, primary buttons, active tab |
| tones | tomato, teal, marigold (`sun`), plum, sky | `.tone-0`…`.tone-4` set `--tone`, `--tone-soft`, `--tone-ink` |

Steps cycle the tones by position; children take marigold, then teal, plum, sky, tomato.
Coloured text uses the `-ink` shade (4.5:1 on its soft fill and on the page). Light or dark
follows the phone (Auto) until Settings → This device pins one on that phone (`localStorage fh-theme`).

## Icons
**Phosphor, duotone** (MIT, `@phosphor-icons/core` 2.1.1, dev dependency only).
- `scripts/build-icons.ts` writes `tesserae/paint/icons.json`, the one icon file for the wall,
  `/sim` and the Planner (`$lib/glyphs`): `{ bg, fg, bold }` on a 256 grid, plus `$ui` (interface
  icons, not offered in pickers). Add a name to `PICK` and re-run it (`npm install` first: Phosphor
  is a dev dependency). It also rebuilds `tesserae/pages/wall.json`, which embeds the icons; commit
  all three files.
- Gaps are hand-drawn in the script (`CUSTOM`, 16-unit round stroke): so far `apple`.
  Still missing from Phosphor: toothbrush, hairbrush, sunscreen, teddy.
- `Glyph.svelte` draws the back layer in `--glyph-bg` (default: text colour) at
  `--glyph-bg-opacity` (default 0.3). Step chips set the back layer to the step's tone.
- Sizes on phones: 16–22 inline, 26 in step chips and tabs, 32 in the child avatar.

## Planner navigation and lists (ADR-39, owner 2026-11-23)
Applies to Lists, Notes, Gifts and any new Planner screen with an index and items.
- **Switch:** the Lists tab has four sides, **Lists · Tasks · Notes · Gifts** (ADR-40): plain words, the active
  one in ink with a single accent underline, a hairline under the row. No pill, no fill. It shows
  on the three index pages only; the tab reopens the side last used on that phone.
- **Index → page:** each side opens on an index; a row opens its own page with a "‹ Lists" back
  link (accent text, no box). A page never shows the switch. Home's lines link straight to a page.
- **Rows:** one card per group, one row per thing, hairlines between: tone icon, name, plain
  count, grey chevron. Section labels are small uppercase muted text above a card. Sections
  with nothing in them (Coming up) are left out, not shown empty.
- **Counts** are plain muted tabular numerals. No badges, no coloured counts.
- **Colour on icons only:** `.tone-N` colours the glyph, never the row or a container. Cards
  are the only raised surface.
- **Add lives in the list:** the last row of the items card, an accent + and a borderless 17px
  input; Enter adds and keeps focus. No floating or sticky add bars, no round red buttons.
- **Actions** (+, ⋯, Back, "+ Person", "New note") are plain icons or accent text, no circle or
  border. Every tap target is at least 44 px.
- **Nothing scrolls sideways.** No rows of pills; if there are many things, the index grows down.
- **Shops (ADR-41):** a list with shops shows **All · Shop · Shop** under the title in the same
  plain-word, single-underline style as the side switch; each shop has a tone dot, its only
  colour. A row's shop is muted text with the dot at its right end, dropped while that shop is
  picked. Items hidden by the pick are one quiet line under the card with Show / Hide. At most
  4 shops per list, one shop per item. Never on to-do lists.
- Secondary groups (Later, Ticked) are quiet muted text lines ("Ticked 7") that open in place.

## On e-paper (verified on Tesserae 0.475.0, architecture §8 S8; in `tesserae/paint/routine.js`)
- Icons: front layer `#000`, back layer flat `#AAAAAA` (grey step 10). Never `opacity`: the
  Floyd–Steinberg dither turns it into speckle. Outline at least 3 device px; below ~48 px use
  Phosphor bold for the outline with the duotone back layer.
- Fonts: the bootstrap caches them once per Tesserae (`POST /api/mcp/fonts`, pinned jsDelivr
  Fontsource URLs, `WALL_FONTS`) as `FH Fraunces` / `FH Outfit`, weight 400; Tesserae needs
  internet for that one fetch. `/sim` gets the same names from `src/lib/wall-fonts.css`. In wall CSS keep `font-weight: 400`
  and set weight with `font-variation-settings` (`'wght' 650, 'SOFT' 100, 'WONK' 1` for
  Fraunces; `fhSerif` / `fhSans` in the painter), and set `font-weight` too so the fallback
  (Atkinson) still gets bold. Text at weight 500 or more.
- Wall greys: icon back layer `#aaa`, done icon `#999` on `#ddd`, rows `#eee`, rules `#ccc`.
  Every grey is a multiple of 17, so it lands flat.
- Check the outcome in `render_preview` and on the panel: grey 10/11 contrast, patch size when
  a duotone row toggles.
