# Getting started

Three ways in, from quickest to the full setup. None of them need the e-paper display.

## 1. The demo (2 minutes, no Docker)

Node 22, then:

```sh
npm install
npm run demo
```

This starts a made-up household on http://localhost:5173: two children (Ari and Nora), a
baby (Juno), two adults, morning and bedtime routines, a baby's day plan, lists with due
dates and repeats, gift ideas, notes, and a week of calendar events. Dates are relative to
today, and every run starts fresh.

- **Planner**: http://localhost:5173/planner, PIN `123456`. Best on a phone-sized window.
- **Kid view**: http://localhost:5173/planner/kids, or Planner → Routines → **Kid view**.
  It opens on each child's current or next routine; tap the tabs to switch.
- **Wall**: http://localhost:5173/sim, **Direct** tab. Without Tesserae the Today and Agenda
  panels are placeholders, because Tesserae draws the calendar on the real wall.

The demo ignores `.env` and keeps its data in `data/demo.db` and `data/demo-calendar/`, so it
never touches a real setup. Options: `DEMO_PIN=…`, `TZ_HOUSEHOLD=Europe/London`, and any
`vite dev` flag after `--` (for example `npm run demo -- --host` to open it from a phone).

## 2. The full stack in Docker

This is what runs in a home: the app plus Tesserae, which renders the wall.

```sh
cp .env.example .env     # fill in every value; the comments say how to generate each
docker compose up -d     # app on :3000, Tesserae on :8765
```

On first start the app seeds a small household (one child) and sets up Tesserae itself,
including a simulated display. Then:

1. Planner at http://localhost:3000/planner (PIN = `ADMIN_PIN`): add your family under
   Settings → Members, their routines under Routines, and your weather place in Settings.
2. Calendars: add your ICS feeds in Tesserae (http://localhost:8765), calendar plugin. The
   wall, Planner and Board all read them. An event titled with a day type ("Daycare") sets
   that day; "Ari: Home" sets it for one child.
3. Watch the wall at http://localhost:3000/sim, **Glass** tab: this is the exact image
   Tesserae sends to a display.

## 3. A real display

The wall targets a Seeed reTerminal E1003 (10.3", 1404×1872 portrait). Flashing, pairing
and button setup are in [hardware-setup.md](hardware-setup.md). For an always-on install see
[unraid.md](unraid.md) (one example), and [remote-access.md](remote-access.md) for using the
Planner away from home.

## Where things are assumed

Family Hub grew up in one household in Western Australia, and some of its assumptions may not
fit yours. Each has a GitHub issue, and help is welcome:

- Some code still falls back to Perth time instead of `TZ_HOUSEHOLD` ([#11](https://github.com/N-Soder/family-hub/issues/11)).
- Dates are formatted for Australia and the afternoon is the "Arvo" ([#12](https://github.com/N-Soder/family-hub/issues/12)); temperatures are °C ([#13](https://github.com/N-Soder/family-hub/issues/13)).
- One shared Planner PIN; there are no per-adult accounts yet ([#14](https://github.com/N-Soder/family-hub/issues/14)).
- The wall layout is drawn for the E1003's size ([#16](https://github.com/N-Soder/family-hub/issues/16)).
