# Family Hub — Validated Spec (v1.0, 2026-10-24) — handed to implementation

> **Historical.** This is the spec the project started from. Many decisions have since been
> amended; where it and the ADRs in `docs/architecture.md` differ, the ADRs win.

Status: **Stage 0 and Stage 1 built (2026-10-24)**; as-built decisions are ADR-9, ADR-13 to
ADR-16 in `docs/architecture.md`. This document replaces the kickoff brief as the source of
truth for Stage 0/1. Items marked **[Q]** are open questions for the owner; each has a
default that will be used if unanswered. Items marked **[SPIKE]** must be verified against a
running Tesserae instance before code depends on them.

---

## 1. What changed from the kickoff brief, and why

| Brief said | Spec says | Reason |
|---|---|---|
| App renders calendar for the wall | Tesserae's own `calendar_*` widgets render the wall calendar from an ICS/CalDAV URL. App owns routines, tasks, habits only. | Tesserae bundles `calendar_day/week/month` with a shared `calendar_core` data plugin. Re-implementing it is pure waste. The app keeps a calendar *adapter interface* for later features (e.g. "who has what after school"), but not in Stage 1. |
| Dynamically generated routine checkboxes with per-element touch | Fixed **tap slots** (e.g. 8 per routine page). Each slot is an editor-authored touch region with a static webhook URL. App maps slot → routine step at render time. | Tesserae blocks webhook actions declared from widget markup (provenance gate, v0.321.1). Only editor/config-declared actions may fire webhooks. Checkbox markup cannot carry its own URL. |
| "Rapid post-action refresh" | Two-step feedback: (a) on-device tier-0 invert of the tapped region (~250–450 ms on E1003, protocol v2) + buzzer; (b) server repaint via patches 1–5 s later. | Those are the measured/documented figures. Nothing on e-ink is instant; the design must make the invert feedback sufficient so children do not re-tap. |
| Hardware mode unstated | **USB-powered, `always_on: true`, `awake_poll_s ≈ 10`.** Battery deep-sleep is a fallback profile, not the design target. | Deep-sleep devices only receive repaints during the touch-linger window or next timer wake. Interactive use on a deep-sleep board is a bad experience and the battery drains anyway with the digitizer powered. **[Q1]** |
| Completion "uncompletion" via tap | Tap toggles, but the toggle is applied against the **server's last-served snapshot** for that device/page, with a per-slot 4 s dedupe window. | Webhook payload carries only device (and page id). No region or state data reaches our app. The app must remember what it last rendered. |
| SvelteKit + TypeScript + SQLite "unless better found" | Confirmed. Node 22 LTS, SvelteKit 2, Drizzle ORM + drizzle-kit migrations, `better-sqlite3`, Zod, Vitest, Playwright (1 smoke test). | Nothing materially better for a one-household app. Kinwall rejected (see §10). |
| Latency unstated | **Lowest achievable tap-to-repaint latency is a first-class requirement** (§4.4). Primary path: `webhook` action + app calls Tesserae `POST /api/v1/push` at once; device on always-on with SSE stream or 1 s linger poll; patches not full frames. | Owner's call (2026-10-24). The default `webhook_refresh` adds a fixed ~5 s delay because the POST has no acknowledgement; our app *is* the acknowledgement, so we can push immediately. |
| Two children seeded | **One child** seeded; members/admin support adding more. With one child the **default page is that child's active routine**, so a tap needs zero navigation. | Owner's answer. Fewer hops = less latency and less clutter. |
| "Dashboard with a phone admin" | **Family planner with three surfaces** (§2.0): the e-ink wall, a Planner PWA for adults, and a browser Board for any spare screen. One app, one database. | the owner (2026-10-24): "a full family planning dashboard, not all on the device". The e-ink is the constrained surface, not the product. |
| Five docs + full admin + calendar + habits + Obsidian in Stage 1 | Stage 1 cut to the vertical slice that proves the success criterion (§9). Habits/Obsidian are **interfaces + mock adapters only**, no UI. | Keep the first iteration honest. |
| "Tesserae MCP for dashboard composition" | Use MCP for `render_preview`, `render_report`, `push_to_device` and to scaffold the canvas page. **Dashboard definition is exported and checked into the repo** so it is reproducible. | MCP writes only touch *canvas* dashboards. Pre-1.0 project releasing every few days; we must be able to rebuild the page from source. **[SPIKE S4]** |

---

## 2. Product scope

### 2.0 Surfaces
| Surface | Who | Character | Tech |
|---|---|---|---|
| **Wall** | children + glance for adults | calm, mono, read-mostly, large taps to complete and to switch page | Tesserae renders our widget on the E1003 |
| **Planner** | adults, on phones and desktops | the full family planning app: routines, tasks, lists, countdowns, rewards, day types, members, settings. Installable PWA. | SvelteKit routes under `/planner` (was "admin"); a privileged `/planner/settings` area for devices, tokens, integrations |
| **Board** | anyone, on a spare tablet / monitor / TV browser | full colour, live, optional touch; the same data as the wall without the e-ink constraints. Built 2026-11-05 (ADR-30) | SvelteKit route `/board`, server-sent events for live updates (the simulator already needs SSE) |

Rules: the wall never gains editing. The Board may allow completing and ticking, never creating. Creating and editing happen only in the Planner. **Terminology:** earlier sections and the other docs sometimes say "admin"; that is the Planner (its settings area is the privileged part). Anything in `docs/skylight-parity.md` marked *Never* refers to the wall unless it says otherwise; most of it is fine on the Planner or Board.

### MVP (Stage 1)
- Default page (portrait): date/time header, today's calendar strip (Tesserae widget), and the **single child's active routine** rendered directly with tappable steps. When a second member is added, this page becomes a family overview with one "Now / Next" strip per child and the routine moves to per-child pages.
- Per-child routine page (used when >1 child, or when a routine exceeds the overview's slot count): the active routine (morning / after-school / bedtime chosen by time window), up to 8 steps as large tappable rows, done/undone state, progress indicator. Tap toggles a step.
- **Day types**: each member has a weekly pattern (weekday → day type such as `daycare`, `home`, `swimming`) and a one-tap "today" override in admin. Routine steps can be filtered by day type, so a daycare morning shows "pack bag"; a home morning does not. The wall shows a one-line "Today: Daycare · Swimming 3:30 pm" per child (§12).
- Navigation: tap child's strip on overview → child page; "Home" hotspot → overview. Handled entirely by Tesserae `Go to page` actions, no app involvement.
- Planner (phone-first, adults only): members, routine templates + steps, day types, time windows, today board with overrides, settings. PIN protected in Stage 1; per-adult accounts in Stage 2.
- Simulator: a browser page that renders the same frame the device would get and lets you click slots, firing the same authenticated webhook. It is the seed of the Board surface.
- Seeded demo data: 1 child, morning + bedtime routines, after-school optional. Admin has "Add member"; nothing in the data model assumes one child.

### Later (Stage 2+)
- Board surface (`/board`): colour, live via SSE, layouts for landscape tablet/TV and portrait tablet; tap-to-complete; no creation.
- Per-adult accounts for the Planner (name + passcode, passkeys later), audit of who completed/approved what.
- Remote access for the Planner when away from home (§7).
- Calendar-derived day types: an ICS adapter reads a dedicated "Family schedule" feed and sets day types from recurring all-day events, overriding the weekly pattern (§12). Parents then manage weekly schedules and their exceptions in one calendar.
- Skylight-equivalent features: shared lists, countdowns, weather, sleep page, PWA admin, static celebration (Stage 2); rewards and stars with optional parent approval (Stage 3). Everything else is *Later* or *Never* per `docs/skylight-parity.md`.
- Personal tasks: **native task module** in Family Hub (decided 2026-10-24): adult-owned tasks with due date, recurrence, completion history, and a web admin page with simple trend views (completion rate by week, streaks). Two task kinds:
  - `local` — **changed 2026-11-02 (ADR-24): built as list items, not a separate module.** Any to-do/other list item can have a due date and a repeat; see §5.1. No `task` table, no Tasks page.
  - `habit` — a **linked mirror of a health-dashboard habit**. The health dashboard stays the system of record; Family Hub reads the day's state from it and writes completions through to it (§13). No second copy of habit history exists in Family Hub.
- Habits on the wall: aggregate-only ("4 of 6") on the adult strip; the full list only on an adult page. Trends stay in the health dashboard, which already has streaks and weekly goals. The `TaskSource` adapter interface stays so an Obsidian source could be added later; it is not planned.
- Rewards/streaks, parent-approval step (Kinwall idea) — only if the family wants it.
- Multiple devices / rooms.

### Explicitly out
- Cloud accounts, Google OAuth flows in-app (calendar comes via ICS/CalDAV URL into Tesserae).
- Animations, hover, drag.
- Custom firmware, Tesserae fork.

---

## 3. Hardware and power

- Seeed reTerminal E1003: 10.3", 1872×1404 native landscape, 16-level grey, ESP32-S3, 3 front buttons, capacitive touch, battery in case.
- Tesserae unified firmware via web flasher (Chrome/Edge; CH340 driver on macOS). Tesserae is the reference touch platform for this exact board.
- **Decision (default):** mount in **portrait** (1404 wide × 1872 tall), USB-powered, Tesserae `always_on`. Touch enabled in Settings → Devices. Buzzer on. Quiet-hours touch-off overnight.
- Firmware ≥ 1.44.0 required for touch-wake modes; ≥ 1.21.0 for the "stale" signal. Flash latest.
- Rotation: upright touch on rotated panels was fixed in v0.436.1. **[SPIKE S1]** confirm portrait hit-testing on real hardware; this is a hardware-dependent test.

**[Q1]** Will the device be permanently USB-powered? (Default: yes. If no, the routine pages still work but repaint only inside the touch-linger window; expect 15–60 s stale states and days-not-weeks battery life.)

**[Q2]** Portrait or landscape on the wall? (Default: portrait, as the brief says.)

---

## 4. Architecture

### 4.1 Responsibilities

| Tesserae owns | Family Hub app owns |
|---|---|
| Device pairing, firmware, OTA, battery, buttons | Family members, routine templates, time windows |
| Page composition, rotation, Go-to-page navigation | Daily occurrence generation (Australia/Perth), completion state + history |
| Rendering HTML → e-ink frames, patches, pushing | Slot → step mapping per render ("served snapshot") |
| Touch hit-testing, tier-0 feedback, dedupe by event id, outbound webhooks | Authenticating webhooks, idempotent toggles, dedupe window |
| Calendar widgets (ICS/CalDAV/Google via its own plugins) | Admin UI (phone), simulator, seed data |
| Admin password for its own UI | Adapters: calendar (future), Obsidian, habits |

### 4.2 Data flow

```
                ┌──────────────┐  GET /api/render/{device}/{page}.json  ┌──────────────┐
  E1003 ──poll──│   Tesserae   │ ─────────────────────────────────────▶ │  Family Hub  │
       ◀─frame──│  (Docker)    │   (family_hub widget server.py fetch)  │  SvelteKit   │
                │              │                                        │  + SQLite    │
  tap ─────────▶│ hit-test     │  POST /api/tap/{device}/{page}/{slot}  │              │
                │ webhook_     │ ─────────────────────────────────────▶ │  toggle step │
                │ refresh      │  Authorization: Bearer <device token>  │  (idempotent)│
                │              │ ◀──── 200 {applied:true}               │              │
                │ re-render    │  (optional) POST /api/v1/push ◀─────── │  "re-render" │
                │ → patches    │                                        └──────────────┘
                └──────────────┘
```

Rendering path, two candidate mechanisms — pick one in **[SPIKE S2]**:

- **A. Authored widget plugin** `family_hub` (plugin.json + server.py + client.js). `server.py.fetch()` calls the app's JSON endpoint (declared `network:<app-host>`), no disk cache. `client.js` paints the routine page into the Shadow DOM at fixed slot geometry. Invisible **Touch region** elements are placed over each slot in the editor, each with a `webhook_refresh` action. *Pro:* clean, testable, Tesserae-native. *Con:* widget and hotspot geometry must agree; duplicated layout constants.
- **B. Code element** with named Actions (`data-on-tap="@slot3"`), markup served/generated from our JSON. *Pro:* buttons and actions in one place; dynamic nodes are picked up. *Con:* less clear how code elements fetch LAN data without violating the "don't fetch from client" contract; provenance rules for webhooks inside code elements need confirming.

Default assumption: **A**. If S2 shows B is cleanly supported, switch.

### 4.3 Touch → state → repaint sequence (target)

1. Child taps slot 3. Device inverts region (~0.3 s), buzzer sounds. Device reports to Tesserae with `event_id` (deduped there).
2. Tesserae validates region against the on-glass frame digest. Stale frame → tap dropped (`stale`), no webhook. Good: a tap against an outdated layout never maps to the wrong step.
3. Tesserae POSTs `/api/tap/{device}/{page}/3`. App authenticates, loads the served snapshot for `(device,page)`, resolves slot 3 → `occurrence_step_id`, checks the 4 s per-slot dedupe, flips state, writes a `completion_event`, returns 200.
4. Repaint (**primary**): the action is plain `webhook`; the app, having committed the change, immediately calls Tesserae `POST /api/v1/push` for that device/page. Tesserae re-renders and the device, already in its 1 s linger poll (or SSE stream), picks up the patch. **Fallback** if push proves unreliable in **[SPIKE S3]**: `webhook_refresh` with `button_webhook_refresh_delay_s` lowered to the minimum that still renders post-commit state (expect 1–2 s).
5. Tesserae re-renders, fetches fresh JSON (new snapshot stored), diffs, sends patch rects → partial refresh of the changed row only.

### 4.4 Latency budget (always-on, USB power, app and Tesserae on the same host)

| Stage | Target | Mechanism |
|---|---|---|
| Finger lift → row inverts + beep | ≤ 0.45 s | Device-owned tier-0 feedback (protocol v2); no network |
| Device → Tesserae tap report → webhook POST | ≤ 0.2 s | LAN, same Docker network |
| App commit + respond + push call | ≤ 0.1 s | SQLite in WAL mode, synchronous handler, no queues |
| Tesserae re-render (headless Chromium) | 0.5–1.5 s | Widget is tiny, no fonts/images fetched at render time, `warm_ahead_s` if useful |
| Device fetches patch | ≤ 1 s | SSE stream `GET /api/v1/device/<id>/stream` if firmware supports it, else 1 s linger poll; `touch_linger_s` ≥ 20 |
| Partial e-ink refresh of the row | 0.3–0.6 s | Patch rects, not full frame |
| **Tap → final state on glass** | **≈ 2–3 s**, feedback inside 0.5 s | |

Levers we control: keep render JSON under 50 ms; keep the widget's DOM small; avoid web fonts (ship one bundled font); never trigger a full-frame refresh for a single toggle; run both containers on Unraid, not across hosts. Lever we do not control: Chromium render time and the panel's refresh waveform. **[SPIKE S6]** measures each hop with a simulated v1 stroke report.

Failure modes handled:
- App down → server.py returns `{"error": …}`; Tesserae shows the error string. Widget should instead render "Hub offline — last updated hh:mm" from a cached copy. **[SPIKE S2]** check whether server.py can return last-good data.
- Double tap → second tap in dedupe window is ignored (returns 200 `{applied:false, reason:"deduped"}`), so no reversal.
- Tap during repaint → `stale` on Tesserae side; the child sees the row invert then revert; acceptable, documented.

---

## 5. Data model (SQLite, Drizzle)

```
member            id, name, short_label (2–3 chars, non-colour identity), kind: child|adult, sort, icon (1 of N glyphs), display_mode: picture|reader, active
task              id, member_id, kind: local|habit, title, notes?, icon?, due_date?, recurrence_rule? (RRULE subset), external_source: health|null, external_ref (health `metric` slug)|null, active   UNIQUE(external_source, external_ref)   (Stage 2)
task_completion   id, task_id, local_date, completed_at, value (1 or numeric), source: wall|board|planner|remote   UNIQUE(task_id, local_date)   (for kind=local this is the truth; for kind=habit it is a cache of the remote state)
sync_outbox       id, target: health, op: entry, payload_json, created_at, attempts, last_error?, done_at?   (write-through retries)
routine_template  id, member_id, name, kind: morning|after_school|bedtime|custom, window_start, window_end (local HH:MM), days_of_week (bitmask), active
routine_step      id, template_id, title, sort, icon?, day_type_ids_json? (null = every day), active
day_type          id, name, glyph, sort                                  (seeded: home, daycare/school, swimming; editable)
weekly_pattern    member_id, weekday (0–6), day_type_id                  PK(member_id, weekday)
day_override      member_id, local_date, day_type_id, note?, source: admin|calendar   PK(member_id, local_date)
occurrence        id, template_id, local_date (YYYY-MM-DD, Perth), day_type_id?, generated_at   UNIQUE(template_id, local_date)
occurrence_step   id, occurrence_id, step_id, title_snapshot, sort_snapshot, completed_at?, completed_by: wall|board|planner|api
completion_event  id, occurrence_step_id, action: complete|uncomplete, source, device_id?, event_ts, dedupe_key   (append-only history)
adult_account     id, member_id, display_name, passcode_hash, role: owner|adult, created_at, last_login   (Stage 2; Stage 1 has one shared PIN in `setting`)
device            id (tesserae device id), name, token_hash, last_seen, settings_json
served_snapshot   id, device_id, page_id, rendered_at, slots_json [{slot, occurrence_step_id, state}]
calendar_source   id, name, kind: ics|caldav|google|outlook|mock, config_json (secret fields encrypted), member_id?, active   (interface only in Stage 1)
setting           key, value_json   (timezone, planner pin hash (Stage 1), day rollover time, quiet hours)
```

Rules:
- Occurrences are generated lazily on first read for `(template, local_date)` and never deleted. Step titles are snapshotted so template edits don't rewrite history.
- "Today" is the Perth local date, but a routine whose window crosses midnight (bedtime 19:00–01:00) belongs to the date it **starts**. Day rollover for display defaults 03:00. **[Q3]**
- Day type resolution for (member, date): **admin override → calendar override → weekly pattern**. Step filtering happens at occurrence generation and the resolved day type is stored on the occurrence, so a later override does not rewrite a day already started; admin has "regenerate today".
- Idempotency: `completion_event.dedupe_key = sha(device,page,slot,snapshot_id,floor(ts/4s))`, UNIQUE.
- Habits live in an adapter-owned cache, not in these tables. Local tasks are list items with a due date and repeat (§5.1, ADR-24); the `task` table above is only for habit mirrors if they are built.

### 5.1 Due dates, Now, notes and repeating list items (built 2026-11-02, ADR-24, migrations 0005–0007)

```
list_item         + due_date?, repeat_every?, repeat_unit: day|week|month|year?, repeat_mode: after|fixed?, repeat_anchor?, lead_days?, now_since?, notes?
list_item_log     id, item_id, kind: done|skipped, done_on (local date, may be backdated), done_at, done_by: wall|board|planner, note?, due_before
```

- One Lists tab: an index (Coming up, then one row per list) and a page per list (ADR-39). Shopping lists stay plain; to-do and other lists offer a due date and a repeat per item.
- **Tapping (owner, 2026-11-02, migration 0007):** on to-do and other lists (and Coming up) the circle ticks an item and the rest of the row opens it, so editing never ticks by mistake (Reminders/Things). Shopping keeps whole-row ticking (fast in the shop) with ⋯ to open. The item page repeats the circle beside the title: a one-off is ticked and the page returns to the list; a repeating one is done today. **Mark done** (renamed from "Done", owner 2026-11-25, as it read like "finished editing") and the circle both return a repeating item to the whole list with "done, next due …" and Undo. A one-off ticked on a phone stays in its row struck through for 15 min so a mis-tap can be undone in place, then moves to Ticked.
- **Notes** on every item (`notes`, ≤ 2,000 characters, line breaks kept): a box that grows on the item page, with http(s) links shown as chips that open in a new tab; the first line shows under the title on the list (link icon when it holds a link). Shopping items' page has name and notes only.
- **After done** (servicing, cleaning): next due = the day it was done + interval. **Fixed** (bins, rego, bills): next due = the next date on the schedule counted from `repeat_anchor` after both the done date and the old due date, so months never drift (31st → 28 Feb → 31 Mar) and doing it early does not make it due again.
- **Lead time**: it shows on the list from `lead_days` before the due date; empty = automatic, 10% of the interval rounded, 0–30 days (weekly 1, monthly 3, quarterly 9, yearly 30). Until then it waits under a collapsed "Later". One-off dated items always show; "soon" for them is 7 days.
- **When** (items that do not repeat): *No date* (on the list, no rush), *Now* (to pick up soon, no set day; `now_since` = when flagged) or *By a date*. One choice: flagging Now clears a date and a date clears Now. Set on the item page, or with the Now button in Edit items. Repeating items cannot be flagged. Ticking keeps the flag (for undo); adding a ticked item back starts it unflagged.
- States: overdue, today, soon, later. Due items sort to the top of a list by due date, then items flagged Now; the rest keep list order. A bar shows how far through the interval it is.
- Doing a repeating item never ticks it: it writes a `list_item_log` row and moves `due_date` on. Undo (the notice's Undo, the wall's second tap, or "Undo" on the newest history entry) deletes that row and restores `due_before`. Older history entries can be removed without moving the date.
- Item page: name, due, repeat, lead time; "Done on" (date ≤ today, optional note); Snooze a week / a month (from today if overdue); Skip (fixed only); history with count and average gap.
- **Coming up** (a section at the top of the Lists index, shown only when something is due; ADR-39): due-soon, due and overdue items from every list, soonest first, then items flagged Now (oldest flag first), tickable in place.
- Starter jobs (list ⋯ → "Add a repeating house job"): service the car, rego, smoke alarm test, smoke alarm batteries (1 April), aircon filters, gutters, pool chlorine. Each opens its item page to check the date.
- Wall: a repeating item is on the lists screen only from its lead time, with a chip ("In 12 days", black "3 days late"); a tap does it today, it stays struck through for the 2-minute grace, a second tap undoes. Dates use the household zone's calendar date (no 03:00 rollover).
- Wall: the lists screen shows each list in full. The home screen's **To do** (ADR-25, §8.1) shows what is urgent from to-do and other lists: overdue, due within 7 days, or flagged Now.
- Not built: "12 months or 15,000 km", phone notifications, assigning an item to one adult (no per-adult accounts yet; history records wall/phone only).

### 5.2 Gift ideas (built 2026-11-07, ADR-32, migration 0009)

```
gift_person  id, name (unique, case ignored), birthday? (MM-DD), notes?, created_at
gift_idea    id, person_id, title, notes?, price? (whole dollars), status: idea|bought|given,
             occasion? ("Christmas 2026"), created_at, bought_at?, given_at?
```

- Planner only: **Gifts** is the third side of the Lists tab (Lists · Notes · Gifts, ADR-39). Never on the wall, the Board, the kid view or Coming up.
- **Gifts page:** people A–Z with "3 ideas · 1 bought" and their birthday; a quick add (person + idea) for when an idea comes up; add a person. Above them, each occasion with bought gifts not yet given ("Christmas 2026 · 5 bought for 3 people") with **Mark all given**.
- **Person page:** add an idea; *Ideas* (the circle marks it bought, the row opens it); *Bought* (circle puts it back to an idea, **Given** moves it to history); *Given* grouped by occasion, newest first; name, birthday and notes (sizes, likes) under ⋯; delete with confirmation.
- **Idea page:** name, notes with link chips (as list items), price, occasion, status.
- **Occasion:** set when an idea is bought, if empty: the person's next birthday or the next Christmas, whichever comes first from today ("Birthday 2027", "Christmas 2026"). Editable on the idea page.
- **Duplicates:** adding an idea the person already has as an idea or bought (case and spacing ignored) adds nothing. If they were given it before, it is added with a notice: "Gave Mum Slippers at Christmas 2025."
- Writes set a state, so repeating one changes nothing.

### 5.3 Shared notes (built 2026-11-15, ADR-37, migration 0010)

```
note  id, title ('' allowed), body (plain text), version (starts at 1), created_at, updated_at
```

- Planner only: the **Notes** tab (Lists · Notes · Calendar · Routines · Settings). Never on the wall, the Board or the kid view.
- **Notes page:** every note, last edited first: heading (or "Untitled"), its first line of text, "Edited 3 h ago". **New note** opens an empty note with the heading focused.
- **Note page:** heading (up to 80 characters) and plain text (up to 20,000). No formatting. Saves on its own; the line above says *Saved · edited just now*, *Saving…*, or what went wrong. Delete under a fold with a tick-to-confirm box.
- **Saving:** `PUT /planner/notes/[id]` with `{ title, body, version }`. On the current version it saves and the version goes up; on an older one it is refused (409) with the current note, unless the text is already what is being saved (a repeated save is not a conflict).
- **Two phones:** an open note follows the other phone's saves while nothing is waiting to go from this one. A refused save shows the other phone's note with *What you typed* below it: **Use mine instead** or **Keep theirs**.
- **Offline / signed out:** typing is kept on the phone (`localStorage`) and saved when the connection is back or on the next visit; a stale copy goes through the same check.
- A new note left with no heading and no text is deleted when the page is left. A note emptied later is kept as "Untitled".
- No author is recorded: adults share one Planner sign-in (per-adult accounts are Stage 2, not built).

---

## 6. API surface (app)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/render/{device}/{page}.json` | device bearer | Snapshot for Tesserae widget. Side effect: stores `served_snapshot`. Returns `{generated_at, page, children:[…], slots:[…]}` |
| `POST /api/tap/{device}/{page}/{slot}` | device bearer | Toggle; idempotent; returns `{applied, step, state, reason?}` |
| `GET /sim` | adult session | Simulator: renders the same HTML the widget paints, at 1404×1872, with clickable slots that call `/api/tap`. Also hosts "render as device would" PNG via Tesserae `render_preview` when available. |
| `/planner/**` | adult session (PIN in Stage 1; per-adult accounts in Stage 2; cookie, rate-limited) | The planning app: members, day types, templates, steps, today board, lists, countdowns, rewards, devices, settings |
| `/board` and `GET /api/events` (SSE) | board session (pairing code once per browser; an adult session also works) | Live colour dashboard for a spare screen; completes/ticks allowed, no creation. **Built 2026-11-05 (ADR-30):** `/board/pair` takes the code from Planner → Settings → Board |
| `GET /healthz` | none | Liveness |

Secrets: device tokens shown once, stored hashed. **[SPIKE S3] result:** Tesserae webhook actions cannot send headers, so the fallback applies: the token travels as `?k=` on the tap URL (ADR-13); `/api/render` still uses the `Authorization` bearer.

---

## 7. Security and privacy

- Device-triggered writes always authenticated (bearer per device). LAN origin is not trusted.
- Planner separated from child controls: the wall never shows it; it is phone/desktop only behind a PIN with lockout on the LAN, or the Cloudflare Access email login on `hub.example.com` (ADR-18; per-adult accounts in Stage 2).
- Tesserae's own admin password enabled; `TESSERAE_SECRET_KEY` pinned; `TESSERAE_TRUSTED_NETWORKS` **not** widened.
- No health or personal calendar detail on shared pages. Habits render only aggregate (e.g. "3/5 done") and only if **[Q6]** says so.
- Calendar credentials, when added, live in Tesserae's calendar plugin (ICS URL) or in `calendar_source.config_json` encrypted with an app key from env. Never in the frame JSON.
- Both containers on one Docker network on Unraid; only Tesserae (8765) and app (3000) exposed to LAN. **[Q4]** reverse proxy / HTTPS preference?
- **Remote access (Planner on phones away from home).** Decided 2026-10-31 (ADR-17): Cloudflare Tunnel + Cloudflare Access (email one-time PIN) in front of `/planner` and `/board` only, never `/api/tap` or `/api/render` (those stay LAN-internal to Tesserae). This mirrors the health dashboard's front door, which the owner already runs. No port is opened; `cloudflared` dials out. **[Q17 answered]**
- Board surface on an LCD may show colour and more detail, but it is still a shared screen: same privacy rules as the wall (no habit detail, no adult calendar bodies) unless an adult unlocks it for the session.
- SQLite in a named volume; nightly `VACUUM INTO` backup to the Unraid share.

---

## 8. UX constraints for e-paper

- Portrait 1404×1872. Base body 44–56 px, step titles ≥ 64 px, header 96 px. Legible at 2 m.
- Tap rows ≥ 160 px tall, full width, 24 px gap. Max 8 per page; more steps → routine paginates (Stage 2).
- Completed = filled box + strike + 40% grey text. Incomplete = heavy outline box + black text. Never colour or thin icons alone.
- Members distinguished by short label badge ("ARI", "ZOE") + one of 6 simple glyphs, not colour.
- **Two display modes per member**, set in admin (`member.display_mode`):
  - `picture` (pre-reader): glyph dominant, ~200 px, title in a secondary role at ~56 px, one step per row, 6 slots max, progress shown as a row of filled/empty circles.
  - `reader`: text dominant at ≥ 64 px, glyph ~96 px as a cue, 8 slots max, progress bar with "5 of 8".
  Both modes share the same slot geometry origin and tap targets so the touch regions in Tesserae do not change when a mode is switched; only the row height/count differs, which the page definition handles with two variants.
- 16-level grey used for: progress bars, de-emphasis, dividers. Pure black for text.
- No animations, no hover, no scrolling. Every state must be fully readable from a single still frame.
- Default page = family overview. Children navigate by tapping their badge; auto-return to overview after N minutes via Tesserae rotation schedule.
- Tier-0 invert feedback + buzzer is the *only* immediate acknowledgement; design the row so an inverted row reads as "got it".

### 8.1 Wall screens (ADR-25, built 2026-11-02)
- **Home** (owner 2026-11-02; day section sized to fit, 2026-11-11, ADR-33): the date (and the home page member's day type), buttons **Routines** and **Lists** top right; the **weather band** (ADR-26; four blocks since 2026-11-14, ADR-36): Morning 6–9, Midday 9–3, Arvo 3–6, Evening 6–9, each with its sky icon beside the temperature (the morning's low, the others' highs), a word, and chips: wind always (compass point it comes from and 1–3 wavy lines), rain from 30 %, UV from 6; grey is light wind, an outline worth knowing, black take notice (owner 2026-11-10: no sunscreen advice); then **Today** (every calendar) beside **To do** (up to 5 read-only rows of urgent list items, a bullet each — they are ticked on the Lists screen or the phone, owner 2026-11-02: overdue, due today or within 7 days, flagged Now; shopping lists excluded; "+N more on the phone"). The day section (date, weather, Today, To do) takes the height it needs, at most 1120 px, with Today and To do growing up to ×1.3 to fill it; the **Agenda** takes the rest (whole days only): every day, empty ones as just the date (owner 2026-11-14, ADR-36), up to 4 lines a day, including dated to-dos due after the To do week (up to 3 weeks out). The Routines button says what is on underneath ("Juno asleep since 9:52 am", or "Nora to do" while a routine is unfinished).
- **Routines:** a tab per child or baby (up to 4, member order) and the chosen one's checklist; a baby with a day plan shows the plan (§12.3). Opens on the first child with a routine to finish, else the first. Outside every window: "No routine on now · Next: Bedtime at 6:30 pm". Tap anywhere on a step's row to tick it. Opened while a routine is on (or within 3 minutes of one starting), the screen stays until that routine's window closes; otherwise a tick keeps it open and 3 idle minutes return home.
- **Lists:** unchanged: the first two lists in full.
- Tap slots: rows 1–12 (steps on Routines, items on Lists; home has none), 20 Lists/Back, 21 the old plan button (older frames only), 22 Routines, 23–26 the routines tabs.
- **No touch since 2026-11-03 (ADR-28).** The wall shows **Home only** since 2026-11-12 (ADR-35: any front button repaints Home, no page strip; the text below on Lists and the strip is history). Before that it showed **Home and Lists only**; routines (and the baby's plan) are on the iPad kid view and phones. The front buttons change the screen: right = next, left = previous, the middle (refresh) button = Home. A page strip top right shows Home · Lists with the current one in black; the Routines / Lists / Back buttons are no longer painted. Ticking happens on phones and the kid view (ADR-27). The tap slots and `/api/tap` stay in the code, unused while touch is off.

---

## 9. Stages

### Stage 0 — Spikes (½–1 day, needs no hardware)
Run Tesserae v0.475.0 (pinned) in Docker locally, with MCP on. **Local Docker is the existing Colima install on this Mac** (verified 2026-10-24: Colima running on Virtualization.Framework, aarch64, Docker 29.5.2, Compose 5.5.1, socket `~/.colima/default/docker.sock`). No Docker Desktop. Two consequences:
- The Tesserae image `ghcr.io/dmellok/tesserae:<version>` (~970 MB pull, ~2.5 GB on disk, mostly Chromium; `latest` moves, so pin `0.475.0`) and our app image must run on **arm64** here and **amd64** on Unraid; the compose file must not pin a platform. **[SPIKE S0]** pull the pinned tag on arm64 and confirm headless Chromium renders. Docs say only arm/v7 is not built.
- Compose facts from the Tesserae docs: mount `./data:/app/data`; set `TESSERAE_SECRET_KEY` (64 hex) before storing anything; under bridge networking set `TESSERAE_HOST_IP` to the host's LAN IP and publish `8765:8765`; MQTT 1883 is not needed (REST transport).
- When the E1003 arrives, it must reach Tesserae on the Mac's LAN IP, so port 8765 must be published through Colima to the host interface (default Colima port forwarding does this; verify with a LAN curl). `TESSERAE_HOST_IP` must be the Mac's LAN IP, not the VM's.

Prove:
- **S1** Portrait canvas page at 1404×1872 renders via `render_preview`; `render_report.tap_invalid` empty. (Rotation on real glass is hardware-dependent.)
- **S2** Authored widget `family_hub` installed via Settings → Widgets upload (or `/api/mcp/widgets/install`), `server.py.fetch()` hitting a local stub JSON with `network:` declared, no caching, error path. Compare with a code-element approach.
- **S3** Touch region with plain `webhook` → local stub receives POST; inspect headers/payload; confirm custom header support for the bearer token; then stub calls `POST /api/v1/push` and we confirm a re-render and patch are produced. Keep `webhook_refresh` + minimum delay as the measured fallback. Confirm dedupe by event id using the Touch monitor / a simulated v1 stroke report.
- **S4** Export the canvas page definition (`get_canvas`) to JSON in repo; re-import with `set_canvas` on a clean Tesserae. If not possible, document manual steps.
- **S5** Confirm `calendar_core` accepts an ICS URL (no account) for the overview calendar.
- **S6** End-to-end latency measurement with a simulated device client (REST transport, always-on, linger poll and SSE if available): stroke report → push → patch available. Record numbers in `docs/testing.md`; the real-glass refresh time is added when hardware arrives.
- Output: `docs/architecture.md` decision record with the S1–S5 results and chosen mechanism.

### Stage 1 — Vertical slice (success criterion)
- SvelteKit app, Drizzle migrations, seed script, Docker Compose (app + Tesserae), `.env.example`.
- Data model §5, API §6, Planner pages for members/templates/steps/today, PIN auth.
- Day types: seeded set, weekly pattern grid per member, today override, step-level day-type filter, "Today:" line in the render JSON (calendar events in that line arrive in Stage 2).
- `family_hub` widget + checked-in canvas page definition + hotspot layout constants shared via one JSON file consumed by both widget and the page builder script. Two layout variants (picture / reader) in that file.
- Simulator page, which also acts as a fake always-on device: it polls or streams frames from Tesserae so the latency path is exercised without hardware.
- Tests: Vitest for occurrence generation (Perth, DST-free but midnight-crossing windows, day-of-week), idempotent toggle + dedupe, snapshot slot mapping; one Playwright flow: sim tap → DB → next render JSON shows completed; one integration test calling `/api/tap` with bad/missing token.
- Docs: README, architecture, roadmap, hardware-setup, testing (hardware-dependent checklist clearly separated).

**Revised success criterion:** `docker compose up`, open the simulator, see the overview and a child page rendered by Tesserae's own renderer (`render_preview` PNG) at 1404×1872, click a step in the simulator, see it persisted in the Planner, and see the next Tesserae render PNG show the completed state. Real-glass latency, portrait touch calibration and buzzer are hardware-dependent and listed as such.

### Stage 2
After-school routine, >slot-count pagination, quiet hours, overview "Now / Next" strip, native task module with admin trends on an adult page, habits read model, **ICS calendar adapter for day types and the "Today:" line (§12)**, weather and countdown widgets, shared lists, Unraid deployment notes + backup job.

### Stage 3
Rewards and stars with optional parent approval only (see roadmap). Meal plan, second adult login, multiple displays, document import, photo mode and Obsidian are *Later*, not scheduled. CalDAV/Google adapters only if a private ICS URL proves insufficient.

---

## 10. Assessments

**Kinwall** — AGPL, tablet/touch-LCD first, full organiser (calendar two-way sync, chores, meals, meds, photos), REST + MCP + HMAC webhooks, ~8 stars. Running it just to borrow chores would add a second large service, a second data model and a second admin UI for a feature we can write in a few hundred lines. **Not adopted.** Worth copying: "Now / Next" strip with countdown; optional parent-approval step; per-child views.

**Health dashboard (the owner's repo `health-dashboard`)** — SvelteKit 2 + Drizzle + D1 on Cloudflare Workers, Cloudflare Access only, Perth owner-timezone timeline, habits as `metrics.is_habit` rows with `daily_metrics(date, metric, source)` values, `POST /api/habits/entry` idempotent upsert, no day-read API yet, push notifications and a 5-minute cron exist. The sync contract in §13 needs one new read route and one Access service-token policy there. Nothing else changes.

**Obsidian Local REST API** — bearer key, HTTPS on 127.0.0.1:27124 with self-signed CA (plain HTTP on 27123 optional), generic file GET/PUT/PATCH, JsonLogic search, SSE events, built-in MCP. No task-aware API; checkbox toggling = patching a markdown line. **Only reachable while Obsidian is open on that desktop.** the owner confirms that host can be always on, so the adapter is viable. Whether to use it at all is **[Q5]**.

**Tesserae** — Python/Playwright, AGPL, pre-1.0, v0.475.0 (2026-10-23), releases every few days. Strong fit: E1003 is its reference touch board; patches, dedupe, stale guard, buzzer, always-on, MCP preview/report/push all exist. Risks: churn (pin versions; keep page definition in repo), widget plugins run in-process (keep ours tiny), docs lag the code (hence spikes).

---

## 11. Open questions (defaults in brackets)

1. **Power:** permanently USB-powered on the wall? [yes → always-on mode]
2. **Orientation:** portrait? [portrait]
3. **Day boundaries:** bedtime routine that runs past midnight counts for the day it started; display rolls over at 03:00? [yes]
4. **Network exposure:** LAN-only HTTP behind Unraid, or do you already run a reverse proxy with TLS (NPM/Traefik/SWAG) you want the admin behind? [LAN-only HTTP for Stage 1; design for proxy]
5. **Personal tasks** (answered): native task module with web admin and trends, Stage 2. Obsidian is an optional later source only.
6. **Habits** (answered): health dashboard is the system of record; Family Hub mirrors habits as `task` rows of kind `habit` and writes through (§13). Mock adapter in Stage 1, real adapter + the small health-dashboard PR in Stage 2. Wall shows count only on the shared page. **[Q14]** Confirm you are happy to add a Cloudflare Access service-token policy to the health dashboard's Access app. [yes]
7. **Children** (answered): build for one, UI allows adding more; glyphs on steps and members. Two display modes per member, `picture` for pre-readers and `reader` for fluent readers (§8).
13. **Latency** (answered): minimise. Primary path is webhook + immediate push; §4.4 holds the budget.
8. **Uncomplete on the wall:** should children be able to un-tick, or only adults via admin? [children can toggle, with dedupe]
9. **Calendar sources:** Google, Outlook or iCloud, and would a private ICS URL into Tesserae be acceptable for the wall? [ICS into Tesserae; no app-side calendar in Stage 1]
10. **Tesserae placement** (answered): Mac via Colima for development, Unraid for production, same pinned version. Multi-arch required.
11. **Admin auth:** simple PIN (6+ digits) with lockout, or password? Any existing SSO (Authelia/Authentik)? [PIN]
12. **Name:** "Family Hub" as repo/app name? [yes]
15. **Schedules** (answered): calendar owns recurring events; Family Hub owns day types (§12). Still open: which calendar provider, and is a private ICS URL acceptable as the integration (no OAuth in the app)? [ICS]
17. **Remote access** (answered 2026-10-24: LAN only; **changed 2026-10-31**, ADR-17): **Cloudflare Tunnel + Cloudflare Access with email one-time PIN** in front of the Planner only. Needed for the installable phone PWA (HTTPS) and the shopping list away from home.
18. **Board hardware** (answered 2026-10-24): no device yet. Build the Board landscape-first in a browser; no hardware assumptions.
16. **Skylight parity** (answered 2026-10-24): lists, countdowns, weather, PWA admin in Stage 2; rewards with optional parent approval in Stage 3; meal plan, import, photos, multi-display, extra logins dropped to *Later*. Full triage: `docs/skylight-parity.md`.

---

## 12. Schedules: what lives where

Decided 2026-10-24 after the owner asked whether recurring kids' schedules (daycare days, swimming lessons) belong in the calendar.

**Rule: Family Hub never implements calendar recurrence.** Anything with a date or time, or that other people need to see, is a calendar event in the family's existing calendar (Google/Outlook/iCloud) and reaches the wall through Tesserae's calendar widget. Weekly rules, skipped instances and public holidays are solved there already.

| Thing | Example | Lives in |
|---|---|---|
| Timed/dated, shared | swimming Tue 15:30, daycare Mon/Wed/Fri, dentist | Calendar (Tesserae displays) |
| Repeating job for an adult | bins out Thursday night, service the car yearly | List item with a repeat (§5.1, ADR-24) |
| Repeating checklist for a child | morning routine | Routine |
| Something that changes a routine's contents | "daycare day" adds pack bag | Day type |
| A baby's feeds and naps, timed from when she wakes | milk on waking, nap 3 h after | Baby plan (§12.3) |

### 12.1 Day types
- Table `day_type` (seeded: `home`, `daycare` (rename to `school` later), `swimming`), editable in admin, each with a glyph.
- `weekly_pattern`: per member, weekday → day type. Admin shows a 7-column grid per member.
- `day_override`: per member per date, set by admin (sick day, holiday) or, from Stage 2, by the calendar adapter. Precedence: **admin override → calendar → weekly pattern**.
- `routine_step.day_type_ids_json`: null means every day; otherwise the step appears only on those day types. Filtering happens when the day's occurrence is generated and the resolved day type is stored on it.
- The render JSON carries `today: { dayType, label, glyph, events: [{time, title}] }` per child for the one-line strip. Events are empty until Stage 2.

### 12.2 Calendar-derived day types and the "Today:" line (day types built 2026-11-05, ADR-29)
As built: Family Hub reads the feeds Tesserae already downloads (the ADR-19 reader), so there is no second fetch, no ETag cache and no ICS URL stored in Family Hub. Every 5 min (and when the Schedule page opens) `syncCalendarDays` writes `day_override(source=calendar)` for today and the next 14 days: an event titled exactly a day type's name ("Daycare", "Daycare day") sets that day for every child; "Ari: Home" / "Ari Home" / "Ari's Home", or any matching event in a feed named after a child, sets it for that child only. All-day spans cover every day; a timed event counts on its start day. An adult's pick on Routines (`source=admin`) is never overwritten; clearing it brings the calendar's day back. A changed day that is already generated is regenerated with ticked steps kept (as ADR-21). Schedule shows the next two weeks' calendar days per child; Routines marks the chip "calendar". The per-child "Today:" line was not built: routines left the wall (ADR-28) and the Planner Calendar tab already shows each child's events. The plan as written follows.

- `CalendarSource` adapter, first implementation **ICS over HTTP** (`node-ical` or equivalent, RRULE expansion by the library, 15-minute poll, ETag caching). No OAuth in the app; a private ICS URL per feed is enough and it is already what Tesserae needs.
- A dedicated "Family schedule" feed holds recurring **all-day** events whose title matches a day type name, optionally prefixed with a member label ("Ari: Daycare"). Match → write `day_override(source=calendar)` for that member/date. Per-member feed URLs are also accepted (then no prefix is needed). Unmatched events are ignored, never guessed.
- Timed events for the day (swimming 15:30) are passed through to `today.events` for that member by the same prefix or per-member feed. Full calendar views stay with Tesserae's widget.
- A public-holiday ICS (WA) can map to a day type (`home`) with lower priority than the family feed. Optional.
- ICS URLs are credentials: encrypted at rest in `calendar_source.config_json`, never in the render JSON.
- Only the member's own events reach their line on the shared page; adult calendars are not parsed unless an adult feed is explicitly added.

### 12.3 Baby plan (agreed with the owner 2026-11-01; built 2026-11-01, ADR-23)
A day timetable for a newborn ("Juno · 6–9 months"), ticked on phones only and shown on the wall as its own screen. Example shape: the owner's `baby_plan.pdf` (time · label · icon rows) with timing from the book ("milk when she wakes", "nap three hours after she woke").
- **Member kind `baby`.** Never picked for the wall's home page (that takes the first `child`), cannot have child routines. Added in Settings → Members.
- **Plan = a routine template of kind `plan`** with an all-day window; one active plan per baby (switch plans as she grows). Reuses `routine_step`, `occurrence`, `occurrence_step`, `completion_event`.
- **Step timing** (new nullable columns on `routine_step`): `due_at` (HH:MM) **or** `due_after_step_id` + `due_after_min` (an earlier step in the same plan). "Woke up" is an ordinary step with its own rule (e.g. 90 min after Nap), so the whole day always has times.
- **Time of a step** = when it was ticked, else (time of its anchor step + minutes), else `due_at`. Computed at read time, never stored. Untimed by a tick → an estimate, shown with `~`.
- **Phone** (Planner → Routines, Juno card): tap a row to tick it now, tap again to undo; a ticked row's time can be edited (writes `completed_at` and a history event), which moves every step after it. "Next: …" line on top.
- **Wall:** *(since ADR-25 the plan is Juno's tab on the Routines screen, not a home button; the rest holds.)* A **Juno** button next to Lists opens a full-screen timetable (done rows greyed with ✓ and real time, next step on a dark bar, estimates with `~`); back to home after 3 idle minutes like Lists. **No ticks from the wall**: rows are not tap targets. Repaints only when a phone ticks (times only change then), no timed repaints. Home screen unchanged.
- **English only.** The wall fonts (Outfit, Fraunces) have no Cyrillic; Bulgarian labels would need a second font (e.g. Manrope) for that text — later, if wanted.
- **Out:** countdowns and overdue styling on the wall, varying nap counts within a plan (skipped rows stay unticked), phone notifications, chains across days (night feeds).
- New icons: bottle (hand-drawn), bowl, baby; pencil (interface).
- **Timer steps** (owner, 2026-11-01; migration 0004): any plan step can be "Start → stop" instead of a tick, with an optional "usually lasts N min". Built for naps: one "Sleep" step replaces a Sleep + Woke up pair. Steps after a timer step count from its stop; before it stops they are ~ guesses from its start + usual length (none if no usual length). Phone: a start panel when the timer step is next (now / 5–20 min ago / at a time), a dark card with a live counter while it runs (Awake or Stop, with "woke N min ago" / at a time; fix start; cancel), a 6 s Undo after stopping, start and stop both correctable afterwards, and "Slept 1 h 25 today". Moon or bed icon → "asleep" / "Awake" wording; any other icon → "running" / "Stop". Wall: the row reads "asleep" while it runs and "until 10:40 am · 48 min" after; the home Juno button reads "asleep since 9:52 am" while a timer runs (two repaints per nap, no counting on the wall). Night sleep and charts are out.
- As built: a plan is set up under Settings → Members → (baby) → Day plans; saving a plan "in use" switches the baby's other plans off. Plan steps have no day types. In the editor, the "after" choices are numbered ("5. Woke up") because plans repeat names. The wall's plan button is tap slot 21 (`layout.planSlot`); the date shrinks (80 → ≥ 56 px) to stay on one line beside two buttons. "Next" is the first open step after the last ticked one, so a skipped step is left behind. Waking from a nap is best set to "No time" (nap length varies); steps after it then show what they wait for ("Milk · after Woke up") until it is ticked, then get real times.

## 13. Health dashboard habit sync contract (both repos are the owner's)

**Principle: write-through, not two-way merge.** The health dashboard (`health.example.com`, Cloudflare Worker + D1, Cloudflare Access in front, no app auth) owns habits and their history. Family Hub holds a `task` row of kind `habit` per mirrored habit and a per-day cache. Every completion made in Family Hub is written to the health dashboard immediately; if that fails it is queued in `sync_outbox` and retried, and the wall shows the task as "pending" (hollow tick) until confirmed. The health dashboard's own phone UI, cron-linked habits (Hevy/Strava/Google Health) and Loop history are untouched.

### 13.0 Deployment-neutral
The owner may later move the health dashboard onto the Unraid box (its own docs name better-sqlite3 as the supported path off Cloudflare; that migration is a project in *that* repo and out of scope here). The contract below does not change if that happens: same two routes, same payloads. Only the transport auth differs:

| Health dashboard runs on | Auth Family Hub uses | Notify hook (13.2.3) |
|---|---|---|
| Cloudflare (today) | Access service token headers | needs a tunnel to Unraid; defer, poll instead |
| Unraid (possible later) | shared bearer in `Authorization`, LAN-only, HTTPS optional | trivial, same Docker network |

The adapter takes `authMode: 'cf-access' | 'bearer'` so switching is config, not code.

### 13.1 Authentication: Cloudflare Access service token (no new auth code in the health dashboard)
- Create an Access **service token** for Family Hub and add a *Service Auth* policy to the existing Access application for the custom domain. Family Hub sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` on every call. This keeps SECURITY.md's rule ("never bypass any other `/api/` route") intact and reuses the owner-only trust model, since the token *is* the owner.
- Secrets live in Family Hub's env on Unraid, never in the frame JSON or the widget.
- Rejected alternative: a bearer-gated route under the `/api/webhooks/` bypass scope (the Hevy pattern). It works, but adds a second auth mechanism and widens the bypass surface for no gain.

### 13.2 Health dashboard changes (small PR in that repo, Stage 2)
1. **New read route** `GET /api/habits/day?date=YYYY-MM-DD` (date optional, defaults to owner-zone today). Returns active habits with that day's resolved value and source, built from the existing `loadHabits` + `loadHabitInput` helpers rather than new queries:
   ```json
   { "date": "2026-10-24", "timeZone": "Australia/Perth",
     "habits": [ { "metric": "floss", "label": "Floss", "type": "boolean", "mode": "build", "icon": "tooth",
                   "value": 1, "source": "manual", "linked": false, "goal": { "window": "week", "target": 5, "direction": "at_least", "actual": 3 } } ] }
   ```
   Archived habits excluded. Activity-linked habits are returned with `linked: true` so Family Hub renders them read-only (ticking them manually would fight the cron).
2. **Reuse** `POST /api/habits/entry` `{ date, metric, value | null }` unchanged. It is already an idempotent upsert on `(date, metric, source='manual')` and rejects future dates in the owner zone, which is exactly the safety Family Hub wants.
3. **Optional, Stage 3:** outbound notification. When `/api/habits/entry` or `syncLinkedHabits` changes a day's value, POST `{ date, metric, value }` to `FAMILY_HUB_NOTIFY_URL` with a bearer, fire-and-forget. This requires Family Hub to be reachable from Cloudflare (e.g. a Cloudflare Tunnel to Unraid). Until then Family Hub polls.

### 13.3 Family Hub side
- `HealthHabitsAdapter` implements `TaskSource`: `listForDate(date)`, `setValue(metric, date, value|null)`. Config: base URL, service-token id/secret, poll interval (default 60 s while any adult page is in rotation, 10 min otherwise).
- Admin "Link habits" page: fetches `/api/habits/day`, lets the adult pick which habits become `task` rows (kind `habit`, `external_ref = metric`, icon mapped from the health icon set to the Family Hub glyph set). Unlinking deletes the task row only.
- Toggle flow from wall or admin: read cached value → compute new value (boolean: 1 or null; number: not toggled on the wall, admin only) → write `task_completion` locally with `source` → call `setValue` → on 2xx mark confirmed; on failure enqueue outbox, keep local state, show pending. Outbox retried every 30 s with backoff; after success the next poll reconciles.
- Reconciliation rule: remote wins. On each poll the local cache is overwritten by the remote day state, except rows with an unsent outbox entry, which keep their local value until the outbox drains.
- Date semantics: Family Hub sends the **owner-zone date** as reported by the health dashboard's `timeZone`, not its own, so a trip abroad does not post ticks to the wrong day. Family Hub's own 03:00 rollover (§5) applies only to routines.
- Privacy: habit labels and values appear only on adult pages or as an aggregate count. The shared default page never lists them.

### 13.4 Failure modes
| Case | Behaviour |
|---|---|
| Health dashboard unreachable | Wall shows last cached state with "updated hh:mm"; toggles queue in outbox; no data loss |
| Service token revoked | 403 → adapter marks source unhealthy, admin banner, outbox pauses |
| Same habit ticked on phone and wall within one poll | Both write value 1; idempotent upsert; no conflict |
| Ticked on wall, cleared on phone before outbox drains | Outbox write re-sets it; remote-wins on next poll shows ticked. Documented; rare; an outbox older than 10 min is dropped rather than replayed |
| Number habit | Not toggled on the wall; shown read-only with value; edited in admin or in the health dashboard |

## 14. Skylight Calendar 15 feature map

**Update 2026-10-24:** the full ~200-item Skylight inventory is triaged item by item in `docs/skylight-parity.md` (Build / Later / Never). the owner dropped the former Stage 3 and 4 from the active roadmap, **keeping rewards and stars with optional parent approval as Stage 3**, and confirmed admin as a PWA. The table below is the earlier coarse map and stays for context; where the two differ, the parity document wins.

The owner asked (2026-10-24) to build "lots of" what the Skylight Calendar 15 offers (A$529 + A$124.99/yr Plus; 15" 1920×1080 colour LCD touchscreen). Everything below is self-hosted and subscription-free in Family Hub. The honest constraints: our panel is 10.3" mono e-paper, so no colour coding, no video, no smooth scrolling, and photos are 16-grey dithered. Skylight edits events on the device; we deliberately keep editing on the phone and make the wall mostly read-only with large taps.

| Skylight feature | Family Hub equivalent | Where | Stage | Effort |
|---|---|---|---|---|
| Calendar day/week/month/schedule views | Tesserae `calendar_day/week/month` from ICS feeds; a rotation of pages gives the views | Tesserae | 1 | none |
| Sync Google / Outlook / Apple / Cozi / Yahoo | Private ICS URL per calendar into Tesserae (all five publish ICS); write-back not needed | Tesserae | 1 | config |
| Tasks Manager (routines, chores) | Routines with day types, tap-to-complete; chores = routine steps or recurring tasks | core | 1 | core |
| Rewards (stars) | `reward_ledger` per child: stars per completed routine/step, optional parent approval, star total on the child's page, redeem in admin | app | 3 | small |
| Custom Lists (groceries, to-dos) | `list` + `list_item`; phone-first editing; wall shows a list page with tap-to-tick for adults; shared across the household | app | 2 | small |
| Meal Planning + recipes | `meal_plan` (date × breakfast/lunch/dinner/snack) + `recipe`; week strip on the overview; editing on phone. "Smart recipe creation" = optional Claude-assisted draft from a pasted URL/text, off by default | app | 3 | medium |
| Event Countdowns | Countdown tile: pick calendar events or native dates; "12 days to Ari's birthday" | app + Tesserae | 2 | small |
| Photo Screensaver | Tesserae `picture_gallery` page shown when idle / in quiet hours from a local folder; e-ink dithering looks good for B&W photos | Tesserae | 2 | config |
| Magic Import (email/PDF/photo → events) | Phone admin "Import": paste text or upload a photo/PDF → Claude proposes events/list items → adult confirms → written to a native list/countdown, or to the calendar **only once a CalDAV writer exists**. Privacy: opt-in, nothing sent without the adult pressing Import | app | 4 | medium–large |
| Mobile App | Admin is a PWA (installable, offline shell); push notifications optional later | app | 1 (PWA in 2) | small |
| Share Access (spouse, co-parent) | Multiple adult logins with per-user PIN; same household | app | 3 | small |
| Parental Lock | Already: admin is separate from the wall; wall can only complete steps / switch pages | core | 1 | done |
| Sleep Mode | Tesserae quiet hours + a sleep page (clock or photo); buzzer and touch off | Tesserae | 2 | config |
| Color Coding | Not possible on mono. Glyph + short label + row pattern per member instead | core | 1 | done |
| Weather | Today's weather band on the wall home: Family Hub fetches Open-Meteo (no key) every 30 min; place picked in Planner → Settings (ADR-26) | app | 2 | built |
| Device Linking (multiple screens) | Tesserae supports many devices; Family Hub `device` table already per-device; rooms via Tesserae | both | 3 | small |
| Software Updates | Pinned images; deliberate `docker compose pull` | ops | 1 | n/a |

What we have that Skylight does not: local-first and private, no subscription, e-paper legibility and near-zero power, habit sync with the health dashboard, day-type-driven routines, exportable SQLite.

Design guardrail: every added module must earn a place on the wall by being readable from 2 m in one still frame. Lists and meal plans are strips or single pages, never scrolling panels. Editing stays on the phone.

## 15. Sources checked (2026-10-24)

- Tesserae touch: https://docs.tesserae.ink/install/touch/ — per-element tap/swipe/slider, Touch region, webhook action, provenance rule, buzzer, touch-wake ≥ fw 1.44.0, `render_report.tap_invalid`.
- Protocol v2 touch: https://docs.tesserae.ink/protocol-v2-touch/ — region-id reports, event-id dedupe, tier-0 ~250–450 ms on E1003, device never calls webhooks.
- Client protocol: https://docs.tesserae.ink/dev/client-protocol/ — patches (≤12 rects/256 KB), linger poll 1–2 s, `touch_linger_s` 0–60, `always_on`/`awake_poll_s` 5–300, `POST /api/v1/push`.
- Widget contract: https://docs.tesserae.ink/widgets/ and https://docs.tesserae.ink/dev/writing-a-widget/ — plugin layout, `server.py.fetch()`, `network:` declaration, upload to `data/authored/<id>/`, no motion.
- MCP: https://docs.tesserae.ink/dev/mcp/ — `render_preview`, `render_report`, `push_to_device`, canvas-only writes, `TESSERAE_MCP_TOKEN` for non-loopback.
- Seeed quickstart / hardware: https://docs.tesserae.ink/quickstart/seeed-unified/ , https://docs.tesserae.ink/hardware/seeed/ — web flasher, CH340, pairing, 3 buttons, deep sleep default.
- Releases: v0.475.0 (2026-10-23); v0.363.0 (`webhook_refresh` + stale signal, fw ≥ 1.21.0); v0.415.0 (#274 webhook tap repaint fix); v0.436.1 (Mosaic looks, rotated-panel touch fix).
- Skylight Calendar 15 (AU): https://au.myskylight.com/products/the-skylight-calendar-15/ — features and pricing as of 2026-10-24.
- Kinwall: https://github.com/JohnDuprey/kinwall ; Obsidian Local REST API: https://github.com/coddingtonbear/obsidian-local-rest-api
