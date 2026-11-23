# Roadmap

Ordered backlog. Each item has an acceptance check. Tick items as they land and keep this
file truthful; it is the one place that says what exists.

Status 2026-10-24: **Stage 0 done, Stage 1 done** (Definition of done verified on a clean
`docker compose up`). Tesserae pinned at 0.475.0; no upgrades yet.

## Stage 0 — Spikes on a running Tesserae (no hardware) ✅
All six passed; results and two Tesserae limitations (S3b patch reverts, S3c region maps on
MCP pushes) in `docs/architecture.md` §8.

Setup: `docker compose up tesserae` on Colima with `ghcr.io/dmellok/tesserae:0.475.0`,
`./data` mounted, `TESSERAE_SECRET_KEY` set, MCP left on, admin password set.
Install the `tesserae-mcp` bridge or call `/api/mcp/*` over HTTP from loopback.

| # | Spike | Accept when |
|---|---|---|
| S0 | arm64 image | Image pulls and the UI renders a bundled widget preview on Colima (arm64). Note pull size/time. |
| S1 | Portrait canvas | `create_canvas_page` at 1404×1872; `render_preview` returns a PNG of that size; `render_report.tap_invalid` is empty with one hotspot placed. |
| S2 | Widget data path | Authored widget `family_hub` uploaded (Settings → Widgets or `/api/mcp/widgets/install`); `server.py:fetch()` reads a local stub JSON over `network:`; render shows the data; error path shows a graceful message; measure fetch→render time. Also try a code element with `data-on-tap="@x"` and note which is cleaner. |
| S3 | Tap → webhook → push | A Touch region with action `webhook` POSTs to a local stub; capture headers/body; confirm a custom `Authorization` header can be set; stub calls `POST /api/v1/push` and a re-render + patch is produced; compare with `webhook_refresh` at minimum delay. Simulate a v1 stroke report via the device REST API to test without hardware. |
| S4 | Reproducible page | `get_canvas` exported to `tesserae/pages/child-routine.json`; on a wiped `data/`, `set_canvas` restores it and S1/S3 still pass. If not possible, write the manual steps. |
| S5 | Calendar | `calendar_day`/`calendar_week` on the page from a public test ICS URL, no account. |
| S6 | Latency baseline | A simulated always-on REST client (script) polls `/frame` at 1 s; measure stroke report → push → patch available, 10 runs, median and p95 recorded in `docs/testing.md`. |

Output: `docs/architecture.md` §8 filled in; ADR-4 and ADR-9 moved to accepted or changed.

## Stage 1 — Vertical slice ✅

1. ✅ Scaffold SvelteKit 2 + TS strict, Drizzle + better-sqlite3 (WAL), Zod, Vitest, Playwright; `docker-compose.yml` with `family-hub` + pinned Tesserae; `.env.example`; `npm run seed`.
2. ✅ Schema + migration 0000_init: member, routine_template, routine_step, occurrence, occurrence_step, completion_event, device, served_snapshot, setting. (task/habit tables arrive in Stage 2.)
3. ✅ Domain: occurrence generation for a Perth local date with midnight-crossing windows and day-of-week masks; day-type resolution (admin override → weekly pattern) and step filtering; active-routine selection by time; toggle with dedupe key; snapshot builder.
4. ✅ API: `GET /api/render/{device}/{page}.json`, `POST /api/tap/{device}/{page}/{slot}`, `GET /healthz`. Device bearer middleware. Push call to Tesserae after a tap.
5. ✅ Planner (`/planner`, phone-first, shared PIN in Stage 1): members (add/edit, display mode, glyph), day types + weekly pattern grid, templates + steps (reorder, day-type filter), today board (override complete/uncomplete, set today's day type, regenerate), devices (issue/rotate token), settings.
6. ✅ `tesserae/pages/layout.json` (slot geometry, two variants) consumed by both `client.js` and the page build script; `family_hub` widget; canvas page JSON checked in; script to import the page and wire hotspots.
7. ✅ Simulator `/sim`: renders the same markup at 1404×1872 with clickable slots that hit `/api/tap`; also shows the latest Tesserae `render_preview` PNG; acts as a fake always-on device. Built on an SSE endpoint (`/api/events`) that the Board reuses in Stage 2.
8. ✅ Tests per `docs/testing.md` §2.
9. ✅ Docs updated; report per `AGENTS.md`.

Accept when `AGENTS.md` → Definition of done holds. ✅

As built, differences from the plan: the page is a code element fed by the widget, not
hotspots over a widget (ADR-9); the tap token is in the URL (ADR-13); dedupe is per step
(ADR-14); Family Hub bootstraps Tesserae itself (ADR-16); devices can be added and wired to
Tesserae from Planner → Devices. Known gaps carried forward:
- The calendar band uses `calendar_day`, a timetable that is cramped at 140 px; the Stage 2
  "Today:" events line is the better fit there.
- Full-frame repaints (row changed back) take ~2 s and flash the panel; worth an upstream
  Tesserae issue so patches diff against anchor + fetched patch.

Status 2026-10-31: Planner restyled ("Storybook", light + dark), Phosphor duotone icons,
Today split into Calendar and Routines tabs (ADR-20, `docs/design.md`).

**2026-11-01 — Planner nav tidy (ADR-22).** Header is now Lists · Calendar · Routines · Settings on desktop and phones (fourth tab). Settings is a hub: Members, Schedule, Devices, Simulator (LAN only), theme Light / Dark / Auto, household zone, Change PIN, Log out. Phones get a per-phone "Show setup tools here" switch (day-type chips, Members, Schedule). No schema change.

**2026-10-31 — Planner day-type UI tidy.** "Day types" became **Schedule** (`/planner/schedule`): each child's week as one-tap chips (also on the member page), the day types with their tagged-step counts, and a "What changes by day" summary per routine. Routine editor: day tags on every step, a "Shows on" chip control (Every day / types), and a "Preview a day" switcher. Routines tab (desktop): "Today is" chips with the usual type marked; a pick applies at once (ADR-21), so the "Regenerate today" button is gone (step edits already sync today). Day types take the theme tones in order (teal, marigold, plum, …). No schema change.

## Open source (2026-11-23)
Published at github.com/N-Soder/family-hub under AGPL-3.0-or-later, with real names and
addresses replaced and a fresh history (the old one is a local-only branch; `docs/unraid.md`).
CI runs `check`, `test` and `npm audit --omit=dev` on every push and PR (closes M2);
Dependabot groups minor/patch updates. `npm run demo` starts a made-up household without
Tesserae (`src/lib/server/demo.ts`; `docs/getting-started.md`); the README screenshots use it.
Making it fit other households is tracked as GitHub issues.

## Hardening (audit 2026-11-05)
Built 2026-11-06: daily and pre-migration backups with a restore test (H1, ADR-31); docs
corrected (H3); PIN change needs the current PIN and signs out other phones, "Sign out all
devices" (H2); offline page cache cleared when a session ends (M4, check by hand over HTTPS);
login redirect limited to `/planner` and `/sim` (L2); routine-step ownership (L1); 400s for
bad JSON and unknown steps (L4, L5); security headers (L6); device removal (L10); painter
escaping test; Kit `csrf.trustedOrigins`; `npm run tesserae:build-page`.

Waiting on the owner:
- Confirm Unraid's appdata backup covers `data/family-hub/` (U1), and drill a restore once.
- Undo or soft delete for list items (M3).
- A kid-only session scope for the kid tablet (M1, an ADR-27 amendment).
- Later: per-client PIN lockout (L3), CSP (L6).

## Next (top of Stage 2)
1. Hardware bring-up when the E1003 arrives (`docs/hardware-setup.md`, `docs/testing.md` §4).
   **In progress 2026-10-31:** flashed (fw 1.62.2), paired, portrait/always-on/touch/quiet hours
   set; taps tick end to end on glass. Fixed on the way: pixel-hash tap-map collision between
   wall and simulator (device name in footer), checkbox-only tap target, dropped-tap clean-up
   (architecture §9). Remaining: timed 10-tap run, buttons, Family Hub-down behaviour, 24 h
   power, upstream issue for the patch-blob race (S3e).
2. File the two Tesserae upstream issues (S3b, S3c) with the spike scripts as repro (owner's call).
3. ✅ **Day types from the calendar (SPEC §12.2, ADR-29), built 2026-11-05.** No migration. An
   event titled a day type's name ("Daycare", "Ari: Home", or in a feed named after a child) sets
   that day; synced every 5 min from Tesserae's cached feeds for today + 14 days, admin picks kept,
   a generated today regenerated with ticks kept. Schedule → "From the calendar" per child and a
   "Calendar days" how-to; Routines marks the chip "calendar". Verified in a browser against a fake
   feed folder; `tests/unit/calendar-days.test.ts`. Dropped from this item: the per-child "Today:"
   line and the calendar band (routines are off the wall, ADR-28; the home Agenda replaced the
   band, item 18). Not yet: deployed; the WA public-holiday feed (optional in §12.2) is just
   another feed with "Home" events if wanted.
4. ~~After-school routine and pagination beyond 6/8 slots.~~ Closed 2026-11-05 without code:
   routines left the wall (ADR-28), so the 6/8-slot cap no longer limits anything; the kid view,
   the Board and the phone show every step. An after-school routine is added in Planner →
   Settings → Members → (child) → routines, like Morning and Bedtime; the seed stays at two.
5. ✅ **Board surface (SPEC §2.0, ADR-30), built 2026-11-05.** Migration `0008_board_session`.
   `/board`: date and clock, weather band, each child's routine now (or the next one, "Coming
   up") with tap-to-tick rows, the baby's next step or running nap (read-only), To do and the
   first two lists with tap-to-tick, and a week grid (Mon–Sun with Today and past days greyed,
   "+N more", a "Next week" cell) from the calendar feeds and dated to-dos. Live over
   `/api/events`; landscape two-column, portrait one column, type scales with the screen. Pairing:
   Planner → Settings → Board → "Pair a screen" shows a 6-digit code (10 min, 5 wrong guesses end
   it); `/board/pair` on the screen turns it into a long-lived cookie; paired screens are listed
   and can be unpaired. An adult session opens `/board` without pairing. Verified in a 1920×1080
   and an 834×1194 browser; `tests/unit/board.test.ts`, `tests/e2e/board.spec.ts`. Not yet:
   deployed; seen on a real TV or tablet (readability from a distance, Safari's SSE reconnects);
   the tunnel path regex needs `board` added (`docs/remote-access.md`).
6. ✅ **Shared lists, phone side (2026-10-31).** Planner → Lists: a "Shopping" list out of
   the box, more lists (shopping/to-do/other), add without duplicates, tap the whole row to tick,
   ticked items in a collapsible section, clear ticked, edit mode (rename, ↑↓, delete), list
   settings and delete, live refresh across phones. Not yet: the wall list page and home-screen
   "top 5" strip, the Board, drag-to-reorder (↑↓ for now).
7. ✅ **Planner as an installable PWA (2026-10-31).** Manifest, icons, iOS tags, service worker
   with read-only offline copies of opened pages. Ticking offline (queue and sync later) is not
   built. Full install and offline need HTTPS, so this lands on phones with item 8.
8. Cloudflare Tunnel + Access (ADR-17) at `https://hub.example.com`. **Repo side done
   2026-10-31** (`cloudflared` Compose service behind the `tunnel` profile, cookie and manifest
   fixes, `docs/remote-access.md`). Owner: create the Access app and tunnel, then run the checks
   in that doc and install on an iPhone and an Android phone.
9. ✅ **Wall lists screen (2026-10-31).** Lists / Back button on the wall; the first two lists
   share 12 rows with tap-to-tick; auto-return home after 3 min. Not yet tested on the real
   E1003 (box and button size on glass). No "show on wall" setting; the child can open it too.
10. ✅ **Unique member short labels (2026-11-05).** Adding or editing a member with another member's label (any case) is refused with the other's name in the error. `tests/unit/forms.test.ts`.
11. ✅ **Planner look (2026-10-31, ADR-20).** "Storybook" theme with light/dark, Phosphor duotone
    icons, three phone tabs (Lists, Calendar, Routines). `docs/design.md`.
12. ✅ **Wall on the design standard (2026-10-31).** Spike S8 passed on Tesserae 0.475.0; one icon
    file (`tesserae/paint/icons.json`) for the wall and the Planner; fonts cached by the bootstrap.
    Still to check on the real panel: grey contrast, patch size when a two-tone row toggles.
    The Board uses the same standard when it is built.

13. ✅ **Baby plan (SPEC §12.3, ADR-23), built 2026-11-01.** Member kind `baby`; plan template with step timing
    (`due_at` / N min after an earlier step), one migration; time calculation with unit tests on
    the book's day and the PDF's day; Planner Juno card (tap to tick, edit tick time, "Next");
    step editor "When" field; wall Juno button + full-screen timetable with no tap rows; bottle
    and bowl icons. Accept when: ticking "Woke up" on a phone moves the later times on the phone
    and, after a repaint, on the simulator's Juno screen; a wall tap on a row does nothing.
    Verified in the simulator (direct mode) and by `tests/unit/plan.test.ts` + an `/api/tap`
    test for slot 21. Migration `0003_plan_timing`. Not yet seen on the real E1003 (row
    contrast, the bottle icon at 64 px, a full repaint per phone tick).
    Deployed to Unraid 2026-11-01 (`81cdacc`); the one-line "After a step" editor fix went out with item 14.
14. ✅ **Nap timer: timer steps (SPEC §12.3), built 2026-11-01.** Migration `0004_plan_timers`.
    Accept: start a nap "10 min ago", the counter runs on the phone, Awake, Undo, the steps after it
    take the stop time, the wall shows "asleep" and the home button "asleep since…".
    Verified in the simulator and `tests/unit/plan.test.ts`. Deployed to Unraid 2026-11-01
    (`8fc2b78`): migration 0004 applied on a copy, Juno's "9-12 months" plan rebuilt (naps 3 and
    6 are timers; Milk 4 and 7 follow them; the 7 pm Sleep stays a tick), checked, then copied
    back. Backup: `backups/family-hub-20261101-1609-pre-0004.db` (+ -wal, -shm).
15. ✅ **Repeating jobs on lists (SPEC §5.1, ADR-24), built 2026-11-02.** Migration `0005_list_repeat`. Plus a **Now** flag for one-off to-dos (no date, pick up soon), migration `0006_list_now`.
    Due date + repeat (after done / fixed) + lead time on to-do/other list items; item page with
    "Done on" + note, snooze, skip, history and undo; Later section; progress bar; Coming up pill (a section of the Lists index since ADR-39);
    seven starter house jobs; wall chips ("In 12 days", "3 days late") with tap-to-do and undo.
    Verified in a phone-size browser and the simulator (direct); `tests/unit/repeat.test.ts`,
    `tests/unit/repeating-items.test.ts`. Deployed to Unraid 2026-11-02 (`b5ac2a5`, migrations
    0005–0006; backup `backups/family-hub-20261102-1337-pre-0005.db`). Not yet: seen on the E1003
    (chip contrast), km-based service intervals, push reminders, per-adult "who did it".
16. ✅ **Wall home redesign (SPEC §8.1, ADR-25), built 2026-11-02.** Home: Today beside To do
    (urgent list items, tap to tick), Coming up below; Routines and Lists buttons. Routines screen:
    a tab per child or baby (checklist, or the baby's plan). Verified in the simulator (direct) and
    with sample calendar data; `tests/unit/wall-home.test.ts`, updated toggle/plan/API/e2e tests.
    Deployed 2026-11-02 (`91191e8`; the page re-imports into Tesserae on start). Not yet: checked
    on the E1003 (column widths, tab tap targets).
17. ✅ **Item notes and circle-to-tick (SPEC §5.1), built 2026-11-02.** Migration `0007_list_notes`.
    Notes with link chips on every item; on to-do lists the circle ticks and the row opens the
    item; a circle beside the item page title. Verified in a phone-size browser. Deployed
    2026-11-02 (`4dcf2d4`; backup `backups/family-hub-20261102-1354-pre-0007.db`); owner checked it.

18. ✅ **Wall: routines stay up, whole-row ticks, today/agenda halves, weather (SPEC §8.1, ADR-26), built 2026-11-02.**
    Routines opened during a routine stay until its window closes (`routinesHoldUntil`); a step's
    whole row is the tap target. Home: top half is today (date, weather band, Today beside a
    read-only To do with 5 rows), bottom half the Agenda (days with something on; dated to-dos 8–21 days out).
    Weather from Open-Meteo every 30 min; place search in Planner → Settings (time-zone matches
    first). Morning wind shows the turn (sea breeze). No migration (place in `setting`).
    Verified in the simulator (direct) and a phone-size browser; `tests/unit/weather.test.ts`,
    `tests/unit/wall-home.test.ts`. Not yet: deployed; seen on the E1003 (band contrast, arrow
    size, row-wide invert); pick the place on Unraid after deploy.
    2026-11-10: the band also shows today's peak UV (`uv_index_max`, "UV 11", number only, wall only);
    painted in headless Chrome with wind change + rain + UV, still two lines. Not yet seen on the E1003.
19. ✅ **Kid view for a tablet (ADR-27), built 2026-11-03.** `/planner/kids`, opened from Routines →
    Kid view or Settings → Kid view. Big tone-coloured cards (2 columns on an iPad in portrait, 4 in
    landscape), a star per step, tap to tick, hold to undo, chime + Android buzz, "All done!"
    celebration, sound on/off, child switcher when there are two or more, routine tabs (opens on the
    one on the wall now, else the next). The tablet reopens in kid view until a grown-up holds the
    corner button for 2 s. The screen stays on while it is in use (wake lock, HTTPS only; 2026-11-12: let go after 15 min
    with no tap, then the iPad's Auto-Lock applies). No migration. Verified in an emulated iPad (Playwright, portrait and
    landscape) and `tests/e2e/kid-view.spec.ts`. 2026-11-04: no sound in the iPad home-screen app;
    fixed by setting the audio session to `playback` (plays through the iPad's mute), resuming from
    iOS's `interrupted` state after sleep, and unlocking with a silent sample on every tap end.
    2026-11-06: kids' longer presses were lost (iOS cancels a touch that rests or wiggles before
    the lift); a press now ticks after 0.15 s without waiting for the lift. Dashed tick ring removed
    (kids aimed for it instead of the card).
    2026-11-23: sound stopped after the iPad app had been open for hours (reopening fixed it). iPadOS
    can leave the Web Audio context "running" but silent, or stuck "interrupted". The context is now
    replaced when its clock has stopped, when it is interrupted, after 5 min idle, when a resume takes
    over 1.5 s, and let go when the page is hidden (`tests/unit/kid-feedback.test.ts`). Not yet seen on the iPad.
    Not yet: confirmed on the real iPad; feel of the hold; wake lock in the installed app.

20. ✅ **Wall: side buttons instead of touch, Home and Lists only (ADR-28), built 2026-11-03.**
    Right / left flip between Home and Lists, middle = Home. Routines and Juno's plan are off
    the wall (iPad kid view and phones instead). Page strip top right; Routines / Lists / Back
    buttons gone. `/api/button` (device token, rate
    limit), `/sim` side buttons, Planner → Devices → **Side buttons** shows the map to paste into
    Tesserae. Verified in the simulator (direct); `tests/unit/buttons.test.ts`, an `/api/button`
    test, rewritten `tests/e2e/sim-flow.spec.ts`. Owner steps on the wall: untick Touch input,
    paste the button map. Not yet: glass-mode e2e (needs local Tesserae), press-to-glass time on
    the E1003, whether a button press keeps the 1 s poll.

21. ✅ **Gift ideas (SPEC §5.2, ADR-32), built 2026-11-07.** Migration `0009_gifts`. People kept
    all year with ideas added as they come up; idea → bought → given; history per person by
    occasion; "gave this before" notice; Lists → Gifts pill, Planner only (its own side of the Lists tab since ADR-39).
    Later: budget per person, wrapped state, gift closet (bought, no one yet), occasion table
    with countdowns, kids adding wishes from a locked-down view.

22. ✅ **Bigger day at a glance (ADR-33), built 2026-11-11.** No migration. Home's day section
    takes the height it needs (at most 1120 px) and Today / To do grow up to ×1.3; the Agenda takes
    the rest. Weather band in one fixed layout: wind, rain and UV as a level icon, three bars and a
    word (no km/h). Verified in a local render of the painter and Playwright; `weather.test.ts`.
    Not yet: deployed; a look on a running Tesserae (the growth uses CSS `zoom`, which headless
    Chromium supports) and on the glass at 2 m.

23. ✅ **Wall on battery, Home only (ADR-34, ADR-35), 2026-11-10 / 11-12.** Tesserae: always-on
    off, synchronized wake at set times. `wallStops` returns Home only, so every front button
    repaints Home; no page strip; footer "Any side button refreshes". Tests: `buttons.test.ts`,
    `/api/button`, `sim-flow.spec.ts` rewritten. Seen 2026-11-12: one wake a day, battery flat at
    82%; the device's timer ran 34 min slow over a 16 h sleep (the firmware learns the drift);
    one morning frame missed while the server was down. Not yet: the Home-only frame on glass.

24. ✅ **Weather in four blocks; empty Agenda days back (ADR-36), built 2026-11-14.** No migration.
    The band shows Morning / Midday / Arvo / Evening with the sky beside the temperature and
    chips for wind (always), rain and UV; hourly `uv_index` fetched. The Agenda lists empty days
    as just the date. Verified in a local render of the painter (seeded database, headless
    Chrome); `weather.test.ts`. Not yet: deployed; a look on glass at 2 m.

25. ✅ **Shared notes (SPEC §5.3, ADR-37), built 2026-11-15.** Migration `0010_notes`. A fifth
    Planner tab, **Notes** (inside Lists since ADR-38): a heading and plain text, as many notes as wanted, last edited first.
    Autosave (about 1 s after typing stops, on blur, on leaving) with a version check, so two
    phones never overwrite each other silently; offline typing is kept on the phone and saved
    when back online; an untouched new note is not kept. `notes.test.ts`, `notes.spec.ts`.
    Not yet: deployed; tried on an iPhone as an installed app (keepalive save on swipe-away).
    Later, if wanted: search, pinning.
26. ✅ **Planner Home and four tabs (ADR-38), built 2026-11-21.** No migration. `/planner` is
    Home: greeting and date, weather with the wall's four blocks, **Now** (each child's routine
    with progress and a Done button for the next step; the baby's last tick, running timer with
    Stop, or Start / tick for the next step), **Today** (events still to come; tomorrow from 5 pm,
    after the last routine, or when today is empty), **To do** (tap to tick, as on the Board),
    **Lists and notes** (one line each), **This week** (Mon–Sun with event dots). A running
    routine leads; before one, weather and today lead. Tabs: Home · Routines · Lists · Settings;
    Notes behind a Lists | Notes switch (three-way with Gifts since ADR-39); Calendar opened from Home. Routines moved to
    `/planner/routines`. `home.test.ts`, e2e specs updated. Not yet: deployed; tried on an iPhone
    as the installed app (the manifest's start page changed, so an installed app may keep the
    old start until re-added).

27. ✅ **Lists, Notes and Gifts without the pills (ADR-39), built 2026-11-23.** No migration.
    Lists · Notes · Gifts switch (plain words, one underline) on the three index pages; Gifts is
    its own side; the Lists tab remembers the side per phone. `/planner/lists` is an index:
    Coming up (only when something is due) and one row per list with its count; `?list=<id>` is
    the list's own page with a back link, a plain ⋯, add as the last row, and Later / Ticked as
    quiet lines. Notes and Gifts headers in the same plain style. `tests/e2e/lists.spec.ts`;
    board, gifts and notes specs updated. Rules: `docs/design.md`. Not yet: tried on an iPhone
    as the installed app.

## Stage 2

- Board surface `/board` ✅ (Next item 5, ADR-30). Left for later: an adult unlock on the Board for habit detail, swipe between children, countdowns tile.
- Per-adult accounts (`adult_account`, name + passcode, owner/adult roles); who-did-what on completions and approvals.
- Remote access (ADR-17, decided 2026-10-31): Cloudflare Tunnel + Access (email one-time PIN) on `/planner` and `/board` only.

- ~~After-school routine; pagination when steps exceed slots.~~ Closed with Next item 4.
- Overview page when >1 member ("Now / Next" strip per child, tap → child page, auto-return).
- Native task module: local tasks are now list items with repeats (item 15, ADR-24). Left: `task`/`sync_outbox` for habit mirrors only, and a trend view if wanted.
- Habits: `HealthHabitsAdapter` (`cf-access` and `bearer` auth modes); "Link habits" Planner page; write-through + outbox; adult page with habit list; aggregate on shared page. Requires the small PR in `health-dashboard` (SPEC §13.2) and an Access service-token policy — owner's go-ahead first.
- ICS calendar adapter: day types ✅ (Next item 3, ADR-29, reads Tesserae's cached feeds); the per-child "Today:" line dropped with ADR-28.
- Quiet hours (Tesserae) aligned with bedtime; buzzer off at night; sleep page (clock/photo).
- Shared lists (`list`, `list_item`, grocery/todo/other; phone editing ✅; adult wall list page with tap-to-tick), event countdowns tile (birthdays from member profiles + chosen calendar events), weather (✅ item 18: the home band), sleep page.
- Planner as an installable PWA: manifest, icons, offline shell ✅; push notifications are *Later*.
- Static completion celebration frame ("All done!") when a routine finishes.
- Board week grid ✅ (item 5; no per-day weather: the forecast fetched is today's only).
- Calendar overflow: cap event lists on the Board and the "Today:" line with "+N more"; parse "Name – …" prefixes to assign events to members.
- Overview strip: per-child progress pill; per-routine counts stay on child pages.
- Lists: whole row is the tap target.
- Full triage of Skylight features: `docs/skylight-parity.md`.
- Unraid deployment ✅ live 2026-10-31 (`docs/unraid.md`, `deploy/unraid/docker-compose.yml`); health check; backups ✅ 2026-11-06 (in-app daily + pre-migration, ADR-31; restore not yet drilled on Unraid).

## Stage 3 — Rewards and stars (kept; everything else from the former Stage 3/4 is dropped)

- `reward_ledger` (member, delta, reason, source, approved_at?, approved_by?), `reward` (title, star_cost, glyph, active), star values on routine templates/steps and tasks.
- Optional **parent approval**: when enabled per member, completions create a *pending* ledger row; approve or reject from the phone; the wall shows pending stars hollow.
- Child page shows star balance and progress to the next reward; redemption from the phone (wall redemption later).
- Bonus stars and manual adjustments in the Planner.
- Dropped from the active roadmap 2026-10-24: meal plan and recipes, second adult login, multiple displays, document import. Triage of the full Skylight list: `docs/skylight-parity.md`.

## Hardware-dependent (when the E1003 arrives)

See `docs/testing.md` §4. Portrait touch calibration, real tap latency, buzzer, always-on
power behaviour, quiet-hours touch-off, button mapping.
