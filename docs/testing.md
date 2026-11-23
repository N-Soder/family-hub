# Testing

## 1. Strategy
Three layers, kept small: unit tests for the domain, integration tests for the HTTP surface,
one browser flow through the simulator. Hardware tests are a manual checklist run once the
E1003 arrives and again after any Tesserae or firmware upgrade.

## 2. Automated (Stage 1) — built

Run: `npm test` (Vitest, 229 tests, ~3 s), `npm run check` (svelte-check, strict TS),
`npm run build && npm run test:e2e` (Playwright, production build, throwaway DB). Add
`E2E_TESSERAE=1` to run the flow through a local Tesserae on :8765 (device `sim-e2e`), or
`E2E_BASE_URL=http://localhost:3000 E2E_TESSERAE=1 E2E_PIN=<ADMIN_PIN>` against a running
`docker compose up` stack (the Definition-of-Done check).

| File | Covers |
|---|---|
| `tests/unit/time.test.ts` | Perth dates, 03:00 rollover, midnight-crossing windows, day mask, active/next selection |
| `tests/unit/occurrence.test.ts` | day-type precedence, step filter, lazy idempotent generation, snapshots, regenerate, step edits sync today, step delete |
| `tests/unit/toggle.test.ts` | toggle/dedupe (ADR-14), empty slot, 409s, Planner sets, slot mapping, 6/8 slots, overflow |
| `tests/unit/repaint.test.ts` | patch vs full rule, routine switch, coalescing, failed push |
| `tests/unit/page-auth.test.ts` | checked-in `wall.json` = builder, placeholders, widget tarball, device auth 401/403, rate limit, PIN lockout |
| `tests/unit/lists.test.ts` | shared lists: migration's Shopping list, add without duplicates, re-add unticks, idempotent tick, clear ticked, reorder, delete cascades |
| `tests/unit/gifts.test.ts` | Gifts (ADR-32): default occasion (birthday vs Christmas, today counts), people A–Z with counts and unique names, delete cascades, no duplicate open ideas, idea → bought fills the occasion and back keeps it, given history by occasion and the "gave before" notice, mark an occasion given, birthday and price form parsing |
| `tests/unit/notes.test.ts` | Notes (ADR-37): new note at version 1, last edited first with a first-line preview, save bumps the version, an older version is refused with the current note, a repeated save is not a conflict, a deleted note is gone, only empty notes are dropped, save parsing (heading trimmed, text spacing kept, limits), "edited" labels |
| `tests/unit/calendar-days.test.ts` | Calendar day types (ADR-29): title matching (child prefixes, feeds named after a child, "X day", near-misses ignored), family vs child precedence and ties, spans and timed events, sync writes/updates/removes calendar rows, admin picks kept and restored, a generated day regenerated with ticks kept, unreadable feed list leaves rows alone |
| `tests/unit/calendar.test.ts` | Today tab calendar: Perth times, all-day first, past flagged, dedupe across calendars, short locations, weekly repeat with EXDATE, multi-day once in Coming up, disabled/broken feeds |
| `tests/unit/cf-access.test.ts` | Cloudflare Access JWT: valid token → email; wrong audience/issuer, expired, not yet valid, wrong key, edited claims, alg none, garbage all rejected; key rotation; fails closed without keys |
| `tests/unit/forms.test.ts` | Zod validation of Planner forms |
| `tests/integration/api.test.ts` | render 401/403/200 + snapshot row, tap 401/403/409/empty/applied + push recorded, rate limit, migrations + idempotent seed; 400 for bad JSON and unknown steps; routine-step actions refuse another routine's step |
| `tests/integration/planner-gate.test.ts` | the real `handle` hook: login redirect, 401 for APIs, CSRF same-host check, security headers, PWA files public, a forged Access header does not get in on the LAN |
| `tests/unit/backup.test.ts` | `VACUUM INTO` backup reopens with the same rows, retention per tag, same-minute names, broken foreign key reported; backup before a pending migration and not when current; a backup restores and the Planner loads; one daily backup per Perth day |
| `tests/unit/sessions.test.ts` | sign out other sessions; PIN change needs the current PIN (counts towards lockout), ends other sessions, keeps the caller's; login redirect refuses `//`, `/\`, other origins and non-Planner paths |
| `tests/unit/painter-escape.test.ts` | hostile names, titles, calendar text and weather reach the wall painter's HTML as text on home, lists and routines, and in the offline message |
| `tests/unit/wall-home.test.ts` | wall home To do (which items, order, tap to tick, grace, +N more); weather in the payload and view key; agenda's dated to-dos; Routines button text; routines tabs, default child, tab switch, Back; the routines screen held for a routine's window |
| `tests/unit/painter-home.test.ts` | Home painter: four weather blocks with chips (grey light wind, black level 3, rain and UV only when given), no band without blocks; Agenda lists empty days as just the date |
| `tests/unit/weather.test.ts` | weather blocks (ADR-36): worst sky, morning low / later highs, strongest wind, rain 30 %+, UV 6+, same at any time of day, moon on a clear evening, no hourly UV; weather line: morning wind and its turn, wobble ignored, rain wording, night icons, stale day; place search order and "lat, lon"; cache refresh, place change, stale copy, failure keeps the last answer |
| `tests/unit/board.test.ts` | Board (ADR-30): pairing code issue/redeem/expiry/single use/five wrong guesses, session valid/last seen/unpair; week grid Mon–Sun with today and past, all-day then timed, past events, "+N more", a child's calendar glyph, dated to-dos on their day (not shopping), next week; kids' running routine with steps and count, a board tick recorded as `board`, the next routine as "soon" |
| `tests/unit/home.test.ts` | Home (ADR-38): phase (a running routine leads, one to come is `day`, none left is `evening`), greeting by hour; morning keeps only events still to come and holds tomorrow back; tomorrow shows after the last routine and during Bedtime (from 5 pm) and when today is empty; the next step ticks and the count moves; the baby's last tick, next timer and running timer with ids; To do, lists and notes capped with counts |
| `tests/e2e/board.spec.ts` | Planner opens Shopping from the Lists index; issues a pairing code → an unpaired browser is sent to `/board/pair`, pairs, sees the Board → ticks a step and a shopping item → the Planner shows both → Settings lists the screen and unpairs it → `/board` asks to pair again |
| `tests/e2e/gifts.spec.ts` | Phone-sized: Lists → Gifts switch → add a person → ideas (a duplicate refused) → mark one bought (occasion shown) → home counts → Given → re-adding says when it was given → idea page price and link chip → delete the person |
| `tests/e2e/lists.spec.ts` | Phone-sized (ADR-39): Lists tab → index with the switch, no Coming up while nothing is due → `?view=coming` redirects to the index → + creates a list, which opens on its own page without the switch → add from the last row (Enter keeps focus) → flag one Now → back link → Coming up shows it, ticking it there hides the section → index row opens the list, Ticked line opens → switch to Gifts, the Lists tab reopens Gifts (also after a reload), then Notes → delete the list |
| `tests/e2e/notes.spec.ts` | Phone-sized: Lists tab → Notes switch → New note → type → saves on its own → still there after a reload → a second phone follows a save live → second phone offline types, first phone saves, back online the second is refused and shows both → Use mine instead → list preview → an untouched new note is not kept → delete needs the box ticked |
| `tests/e2e/sim-flow.spec.ts` | Planner adds an all-day routine → `/sim` opens Routines, taps a step → Planner shows it done → next render JSON done; via Tesserae it also checks the glass pixels |

Planned list (kept for reference):

### Unit (Vitest)
- Occurrence generation: Perth local date; routine window 19:00–01:00 belongs to the start
  date; 03:00 display rollover; day-of-week mask; idempotent generation on repeated reads.
- Active-routine selection by time of day, with none active outside windows.
- Day type resolution precedence (admin override → calendar → weekly pattern); step filter by day type; an override after generation does not change today's occurrence until "regenerate" (the Planner's Today picker regenerates for you, ADR-21); setting or clearing one weekday of the weekly pattern.
- Toggle: complete → uncomplete → complete produces three `completion_event` rows; the same
  slot tapped twice inside 4 s produces one; a different snapshot id resets the window.
- Snapshot builder: slot → step mapping is stable for a given occurrence and mode; picture
  mode yields ≤ 6 slots, reader ≤ 8; steps beyond the slot count are flagged for pagination.
- Zod validation of every Planner form payload (reject empty titles, bad times, bad bitmask).
- Repeating list items (`repeat.test.ts`, `repeating-items.test.ts`): month-end clamping and no drift on fixed schedules; after-done vs fixed next dates (late, early, backdated, missed weeks); automatic lead times; due labels; done → Later, undo restores the date, skip, snooze; due items sort first; Coming up; starter jobs; wall shows only due items, tap does it, grace, second tap undoes; Now flag sorts after due items and into Coming up, is one choice with a date, cannot go on a repeating item, survives a tick and undo; notes keep line breaks, trim and clear (`forms.test.ts`: shopping items post name and notes only, "By a date" needs a date).

### Integration (Vitest + SvelteKit handler)
- `GET /api/render/...` without bearer → 401; wrong device's bearer → 403; good → 200 and a
  `served_snapshot` row.
- `POST /api/tap/...` on a slot with no step → 200 `{applied:false, reason:"empty_slot"}`;
  on a stale/unknown snapshot → 409; good → 200 and a push call recorded (Tesserae mocked).
- Admin PIN: 5 bad attempts → locked; cookie required for `/admin/*`.
- Migration from empty DB applies cleanly; seed is idempotent.

### Browser (Playwright, one flow)
Open `/sim` → see the seeded routine → click a step → admin "today" shows it complete →
next `/api/render` JSON (and, when Tesserae is running, the next `render_preview` PNG) shows
the completed state.

PWA offline check (manual script, 2026-10-31, production build on localhost, Pixel 7
emulation): service worker controls the page; offline reload shows the saved list with the
banner; an offline tick is blocked with "Changes need a connection"; offline links to saved
pages work and an unsaved page shows the offline page; back online ticking works; logout
deletes the saved pages. Still to do on real phones over HTTPS: install on iPhone (Safari →
Share → Add to Home Screen) and Android (Chrome → Install app).

## 3. Simulator (built)
`/sim` (Planner session) has two views:
- **Glass (via Tesserae):** a fake always-on E1003 (`sim-wall`) inside the app, paired with
  Tesserae at bootstrap. It polls `/frame/data` every second while watched, downloads full
  frames and applies patch rects to its own 4 bpp framebuffer exactly as the firmware does, and
  serves it as a portrait PNG. Overlays come from Tesserae's tap manifest; a click is reported to
  Tesserae as a region tap, so Tesserae fires the authenticated webhook to `/api/tap`. It shows
  tap → first change and tap → settled times.
- **Direct:** the same painter run in the browser from `/sim/direct`; taps go through the same
  toggle code as device `sim-direct`. Works without Tesserae.

### Latency (fill in)
| Path | Median | p95 | Tesserae | Date |
|---|---|---|---|---|
| Simulated v2 tap report → `/tap` response (`ok`) | 33 ms | 59 ms | 0.475.0 | 2026-10-24 |
| Tap → webhook received → push returned (stub app, Mac → Colima) | ~0.8 s | ~1.0 s | 0.475.0 | 2026-10-24 |
| **Tap → patch available to client** (primary path, 100 ms poll) | **0.87 s** | **0.92 s** | 0.475.0 | 2026-10-24 |
| Tap → patch, `webhook_refresh` fallback at 0.5 s delay (n=5) | 1.49 s | 1.67 s | 0.475.0 | 2026-10-24 |
| MCP full-frame push alone | 0.54 s | | 0.475.0 | 2026-10-24 |
| **Compose stack, `/sim` glass: tap → patch on framebuffer** (1 s poll, n=8) | **0.97 s** | 1.12 s | 0.475.0 | 2026-10-24 |
| **Compose stack, `/sim` glass: tap → full frame on framebuffer** (row changed back, n=4) | **2.02 s** | 2.13 s | 0.475.0 | 2026-10-24 |
| `/sim` glass: wall Lists / Back tap → new screen on framebuffer (full frame, n=4; first after start ~7 s, cold render) | 2.0–2.2 s | | 0.475.0 | 2026-10-31 |
| Tesserae render of the restyled wall page (`preview.png`, fonts cached) | 1.1 s | | 0.475.0 | 2026-10-31 |
| **Real glass: tap → row repainted** | | | | hardware |

## 4. Hardware-dependent checklist (manual, E1003)
Run in portrait, USB-powered, always-on, touch on, linger 20 s.
- [ ] Device registers and shows the assigned page within one poll.
- [ ] Portrait touch: tapping each of the slots hits the matching row (Touch monitor shows
      `fired` with the expected region), including the top and bottom slots.
- [ ] Tier-0 feedback: row inverts and buzzer sounds within ~0.5 s.
- [ ] Repaint: the ticked state lands via a partial refresh (no full-screen flash) within
      ~3 s; record the time over 10 taps.
- [ ] Double tap within 1 s does not revert the state.
- [ ] Tap during a repaint is dropped as stale, and the state on glass matches admin afterwards.
- [ ] Un-tick works and repaints.
- [ ] Side buttons (ADR-28): right and left flip between Home and Lists, the middle button
      goes home; time from press to new screen on glass (with touch off the panel
      may not linger at 1 s polls after a button press: if it waits for the 10 s `awake_poll_s`,
      lower that or check Tesserae's linger for button wakes).
- [ ] Family Hub container stopped: wall shows the offline message, taps queue nothing wrong,
      recovery after restart within one poll.
- [ ] Tesserae restarted: page restored from the checked-in definition; hotspots intact.
- [ ] Quiet hours: touch ignored and buzzer silent inside the window.
- [ ] Power: 24 h always-on on USB with no sleep, no missed polls in Settings → Events.
- [ ] Legibility at 2 m in both display modes; glyphs recognisable to the child.
- [ ] Ghosting after 50 toggles acceptable; a scheduled full refresh clears it.
