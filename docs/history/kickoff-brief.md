# Handoff — Family Hub kickoff (2026-10-24)

> **Historical:** the brief that started the project, kept for context. For current state see
> `README.md`, `docs/architecture.md` and `docs/roadmap.md`.

> **Done 2026-10-24:** Stage 0 (S0–S6) and Stage 1 are built and verified; see
> `docs/roadmap.md` for status and next tasks. The brief below is kept as written.

You are the implementing engineer for Family Hub. Planning is done; this brief tells you what
to build first. Read `AGENTS.md`, then `docs/SPEC.md` in full, before writing code.

## Context in five lines
- Hardware purchased: Seeed reTerminal E1003, 10.3" mono 16-grey e-paper, 1872×1404, ESP32-S3,
  capacitive touch. Not yet arrived. Everything in Stage 0–1 must work without it.
- Tesserae (v0.475.0) renders and pushes frames and owns touch hit-testing; it POSTs a webhook
  to our app on a tap. Our SvelteKit + SQLite app owns routines, completions, the Planner PWA, the Board, the simulator (SPEC §2.0: three surfaces, one app).
- Lowest tap-to-repaint latency is a first-class requirement. Primary path: `webhook` action →
  app commits → app calls Tesserae `POST /api/v1/push` → device (always-on, USB) picks up a
  patch within its 1 s linger poll. Target ≈ 2–3 s to glass, ≤ 0.5 s on-device feedback.
- One child seeded; the data model and Planner support more. Two display modes per member
  (`picture` for pre-readers, `reader`).
- Habits sync to the owner's health dashboard by write-through (SPEC §13). Stage 1 uses a mock.
- Day types (daycare / home / swimming) drive which routine steps appear; the calendar owns
  all recurring events and Family Hub never implements recurrence (SPEC §12).
- The long-term feature set is a triage of the Skylight Calendar 15 (`docs/skylight-parity.md`):
  lists, countdowns, weather, Planner PWA in Stage 2; rewards with optional parent approval in
  Stage 3; nothing else is scheduled. Stage 1 is the core only.

## Do now, in order
1. **Stage 0 spikes S0–S6** (`docs/roadmap.md`). Run Tesserae in Docker on Colima. Prove each
   item, record results and chosen mechanism in `docs/architecture.md` under *Spike results*.
   Stop and report if S2 or S3 fails outright; otherwise continue.
2. **Stage 1 vertical slice** exactly as listed in `docs/roadmap.md`.
3. Report per `AGENTS.md` → Reporting.

## Non-negotiables
- No forks of Tesserae, no custom firmware.
- Webhook writes authenticated with a per-device bearer; LAN is not trusted.
- Planner behind a PIN with lockout (per-adult accounts in Stage 2); the wall never edits; the Board never creates.
- No health detail or calendar credentials on shared pages.
- Idempotent toggles with a 4 s per-slot dedupe window applied against the last-served snapshot.
- Keep it small: no queues, no extra services, no ORM beyond Drizzle, no component library.

## Things already decided (do not ask again)
USB-powered always-on; portrait; 03:00 display rollover; LAN HTTP plus Cloudflare Tunnel + Access for the Planner (ADR-17);
ICS into Tesserae's calendar widget rather than app-side calendar; native task module (Stage 2),
Obsidian not planned; PIN-protected Planner on the LAN, Cloudflare Access login instead of the PIN on hub.example.com (ADR-18); name "Family Hub"; Colima locally, Unraid in production.

## Open items you may need the owner for
See `docs/SPEC.md` §11: Q14 (Access service-token policy on the health dashboard, Stage 2 only)
and the child's age for text sizing. Use the defaults and proceed.

Settled 2026-10-24: the Board has no target hardware yet, so build it landscape-first in a browser.
Changed 2026-10-31: remote access is **Cloudflare Tunnel + Access (email one-time PIN)** on the
Planner only (ADR-17), replacing "LAN only". Address `hub.example.com`; setup in
`docs/remote-access.md`.
