# Skylight Calendar feature triage

Source: Skylight AU site, user guide and 2026 changelog, inventory dated 2026-10-24.
Verdicts are for Family Hub on a 10.3" mono e-paper touch panel with a phone admin PWA.

- **Build** = in Stage 1 or 2 of `roadmap.md`.
- **Later** = agreed in principle, not on the active roadmap (except Rewards, which is Stage 3).
- **Never** = does not fit the hardware, the privacy stance, or the "calm, read-mostly wall" principle. Many of these move to the phone instead.

Rule applied throughout: the **wall** (e-ink) shows and completes; the **Planner** (PWA on phones/desktop) creates and edits; the **Board** (browser on a spare screen) shows in colour, live, and may complete. A *Never* below means "never on the e-ink wall" unless the note says the feature is out entirely.

## 1. Family calendars and scheduling

| Feature | Verdict | Note |
|---|---|---|
| Shared household calendar | Build | Tesserae calendar widgets from ICS feeds |
| Google / Outlook / Apple / Cozi / Yahoo integration | Build | Each publishes a private ICS URL. Read-only |
| Automatic sync | Build | Tesserae polls the feeds |
| Two-way sync | Never | Family Hub does not write calendars. Edit in the phone's own calendar app |
| Multiple calendars in one display | Build | Multiple feeds into one widget |
| Colour-coded events by member | Never | Mono panel. Member glyph/label prefix instead |
| Individual family profiles | Build | `member` |
| Events assigned to one or more members | Build (display) | Via per-member feed or "Ari:" prefix (SPEC §12.2) |
| Day / week / month / agenda views | Build | Tesserae widgets on rotation pages |
| Swipe navigation between dates | Later | Tesserae has swipe actions; wire to next/prev page once views exist |
| Jump back to today | Build | Auto-return to the default page after idle |
| Create events on the touchscreen | Never (wall) | Calendar events are created in the phone's calendar app; the Planner could gain CalDAV write *Later* |
| Edit / delete events | Never (wall) | Phone calendar app; Planner *Later* via CalDAV |
| All-day and multi-day events | Build | Displayed by widget |
| Recurring events, end dates | Build (display) | Recurrence lives in the calendar provider, never in Family Hub |
| Event descriptions / notes | Board / Planner only | Clutter on e-ink |
| Start/end times | Build | |
| Event reminders | Later | Phone push via PWA; wall buzzer is for taps only |
| Participant information | Never | Privacy, clutter |
| Filter events by person | Build | Per-child "Today:" line; per-member pages |
| Event countdowns | Build (Stage 2) | Countdown tile |
| Weather, incl. indicators in calendar | Build (Stage 2) | Tesserae weather widgets (Open-Meteo) |
| Show/hide planned meals on calendar | Later | Meal planning not on roadmap |
| Task progress alongside calendar | Build | Overview strip |
| Calendar preview/management in the mobile app | Build (preview) | Planner shows the week from the ICS adapter; editing stays in the calendar app |

## 2. Chores and family tasks

| Feature | Verdict | Note |
|---|---|---|
| Interactive chore chart | Build | Routines (kids) + tasks (adults) |
| One-off chores | Build (Stage 2) | `task`, kind local |
| Recurring chores | Build (Stage 2) | RRULE subset: daily, weekly by weekday, monthly by day |
| Assign to one member | Build | |
| Same chore to multiple members | Later | Needs linked tasks; start with duplicating |
| Linked tasks edited together or individually | Later | |
| "Up for Grabs" unassigned chores anyone can claim | Later | Tap-to-claim on the wall is a good e-ink fit; after lists |
| Mark complete by tapping | Build | Core |
| Undo a completed task | Build | Toggle with dedupe |
| Skip recurring chores / undo skip | Later | Small; add with task module v2 |
| Due dates and times | Build (Stage 2) | |
| Recurrence from scheduled date | Build (Stage 2) | |
| Recurrence from previous completion / repeat after delay / immediately | Later | Interval-after-completion mode |
| Recurrence end dates | Build (Stage 2) | |
| Task descriptions / instructions | Build (admin only) | Not shown on wall |
| Emoji/glyph icons | Build | Glyph set, picture mode |
| Daily view with per-member columns | Build | Overview when >1 member |
| Weekly task view per member | Build (Planner, Stage 2) | |
| Combined view of all tasks | Build (admin) | |
| Task search | Build (Planner, Stage 2) | |
| Progress indicators | Build | |
| Show/hide completed, overdue, skipped | Build (admin), partial on wall | Wall shows completed greyed, never hides mid-routine |
| Filter by member | Build | |
| Task due reminders / completion notifications | Later | PWA push; opt-in per adult |
| Edit/delete this and future recurring | Build (Stage 2) | Occurrence snapshotting already supports it |

## 3. Children's routines and habits

| Feature | Verdict | Note |
|---|---|---|
| Routines separate from chores | Build | Core |
| Morning / afternoon / evening routines | Build | Time windows |
| Daily and weekly repeat; choose days | Build | Day-of-week mask + day types |
| Assign routine to multiple times of day | Build | Multiple templates |
| Personal routines per child | Build | |
| Automatic display by time of day | Build | Active-routine selection |
| Manually switch morning/afternoon/evening | Build | Hotspot on the child page |
| Tap to complete steps | Build | Core |
| Progress indicators | Build | Circles (picture) or bar (reader) |
| Drag-and-drop reorder | Build (admin) | Phone; never on wall |
| Emoji-based routines for pre-readers | Build | Picture mode |
| Habit-tracking mode for routines | Later | Kids' streaks; adults' habits already via health dashboard |
| Habit streak tracking | Later (kids), Build (adults via health dashboard) | |
| Skip a routine without breaking the streak | Later | With streaks |
| Celebratory effects on completion | Build (static) | Full-page "All done, Ari!" frame with a big glyph; no animation |

## 4. Lists

| Feature | Verdict | Note |
|---|---|---|
| Grocery list, to-do list, unlimited custom lists | Build (Stage 2) | `list`, `list_item`, kind grocery/todo/other |
| Custom names | Build | |
| Colour-code lists | Never | Glyph per list |
| Add / edit / delete items | Build (phone) | |
| Tick items on the touchscreen | Build (adult list page) | Fixed slots like routines |
| Show/hide completed | Build | |
| Drag-and-drop reorder | Build (phone) | |
| Sections within lists | Later | |
| Clear all completed | Build | |
| Shared lists in the mobile app | Build | PWA |
| Lists on the home screen | Build | A short "top 5 groceries" strip, optional |
| Add items from the home screen | Never (wall); Build (Board, Planner) | |
| Transfer to Instacart | Never | Not relevant in AU, and no third-party commerce |
| Task templates / Task Box | Later | Routine templates already cover kids; adult templates later |

## 5. Profiles and personalisation

| Feature | Verdict | Note |
|---|---|---|
| Profile per member | Build | |
| Group profiles (whole family) | Later | "Everyone" pseudo-member for shared tasks |
| Colour per profile | Never | Glyph + 2–3 letter label + row pattern |
| Avatars / customise with hats | Never | Glyph set only; keep it calm |
| Names and birthdays | Build | Birthday feeds the countdown tile |
| Link external calendars to profiles | Build (Stage 2) | Per-member ICS feed |
| Labels (school, holidays, sport) with colours/emojis | Build (as day types) | Day types with glyphs are our version |
| Associate labels with synced calendars | Build (Stage 2) | Calendar-derived day types |
| Filter by profile | Build | |
| Edit / merge / delete profiles | Build (edit, archive); Never (merge) | |
| Share access with relatives/carers | Build (Stage 2, adults) | Per-adult accounts for the Planner; carers/relatives *Later* |

## 6. Home screen and display controls

| Feature | Verdict | Note |
|---|---|---|
| Combined home screen | Build | Default page |
| Calendar, tasks and lists together | Build | Strips |
| Show/hide sections | Build (admin) | |
| Home-screen calendar as day/week/month/schedule | Build | Choose widget |
| Complete tasks from the home screen | Build | Single-child mode does exactly this |
| Add events/tasks from the home screen | Never (wall); Build tasks on Board/Planner | |
| Swipe between members | Later (wall); Build (Board) | Tesserae swipe → Go-to-page |
| Customise navigation tabs | Never (wall); Later (Board) | |
| Font size small/medium/large | Build (two modes) | Picture / reader; a third "large reader" if needed |
| Information density | Build (coarse) | Same two modes |
| Scheduled sleep/wake | Build (Stage 2) | Tesserae quiet hours + sleep page |
| Touchscreen navigation | Build | Hotspots and buttons |
| On-screen keyboard | Never (wall) | Board/Planner use the device keyboard |
| Time zone and language | Build (TZ), Never (i18n) | English only |
| Parental lock with 4-digit PIN | Build (≥ 6 digits) | Admin is off-wall entirely |
| Restrict children from creating/editing | Build | By design |
| Auto re-lock after inactivity | Build | Admin session timeout |
| Reminder and keyboard sounds | Build (tap beep only) | Tesserae buzzer; silent in quiet hours |
| Automatic software updates | Never | Pinned images, deliberate upgrades |
| New-feature announcements | Never | |

## 7. Stars and rewards (Plus) — **Stage 3, kept**

| Feature | Verdict | Note |
|---|---|---|
| Star values on chores/routines | Build (Stage 3) | Per step or per whole routine |
| Earn stars on completion | Build (Stage 3) | `reward_ledger` |
| Separate balance per child | Build (Stage 3) | |
| Custom rewards with star cost | Build (Stage 3) | |
| Progress towards a reward | Build (Stage 3) | Bar on the child page |
| Redeem on the device | Build (Planner, Board); Later (wall) | Wall redemption needs a confirm step |
| Auto-deduct on redeem | Build (Stage 3) | |
| Bonus stars outside chores | Build (Stage 3) | Admin |
| Manually add/remove stars in app | Build (Stage 3) | |
| Manage reward definitions in app | Build (Stage 3) | |
| Show rewards and progress on the family screen | Build (Stage 3) | |
| Optional parent approval before stars are awarded | Build (Stage 3) | Our addition: "pending approval" state, approve from phone |

## 8. Meal planning and recipes (Plus)

| Feature | Verdict | Note |
|---|---|---|
| Entire category | Later | Dropped from the roadmap 2026-10-24. Design notes kept in SPEC §14 if revisited |
| AI recipe/meal generation, fridge photos | Never | |

## 9. Sidekick AI (Plus)

| Feature | Verdict | Note |
|---|---|---|
| Magic Import (email, PDF, photo, newsletters) | Later | Dropped from the roadmap; would need a CalDAV writer and explicit opt-in |
| Voice dictation (events, lists, recipes) | Never | |
| AI meal suggestions and plans | Never | |
| Local event discovery | Never | |

## 10. Photos and screensaver (Plus)

| Feature | Verdict | Note |
|---|---|---|
| Photo-frame mode / slideshow | Later | Tesserae `picture_gallery` from a local folder; cheap, but not on the roadmap |
| Video in screensaver | Never | E-ink |
| Upload from app, captions, albums, album selection | Later | Folder-per-album on the Unraid share |
| Time/date/weather/events/countdowns over photos | Later | Tesserae page composition |
| Idle delay, schedules, weekday/weekend schedules, manual toggle | Later | Tesserae rotation/schedules |
| New-photo notifications | Never | |

## 11. Mobile, desktop and device integration

| Feature | Verdict | Note |
|---|---|---|
| Companion mobile app | Build | Planner as installable PWA (Stage 2 manifest + offline shell) |
| Web desktop app | Build | Same Planner, responsive |
| Manage calendar remotely | Never | Phone calendar app |
| Manage chores, routines, profiles, lists remotely | Build | |
| Task completion notifications / due reminders | Later | PWA push |
| Preview upcoming events on mobile | Build (Stage 2) | From the ICS adapter |
| Manage multiple devices / link displays / share across rooms | Build (Board, Stage 2); Later (second e-ink) | Any browser can be a Board; Tesserae supports more panels |
| Invite additional people | Build (Stage 2, adults) | |
| Subscription URLs (ICS) | Build | The integration |
| TeamSnap | Never | Publishes ICS anyway |
| Automatic external sync | Build | |

## 12. Disney mode

| Feature | Verdict | Note |
|---|---|---|
| All of it | Never | |

## Summary counts

| Verdict | Approx. items |
|---|---|
| Build (Stage 1–2) | ~105 |
| Build (Stage 3, rewards) | 12 |
| Later | ~40 |
| Never (wall, or entirely) | ~40 |

What Skylight has that we deliberately do not: colour, on-device editing, animation, video, AI import, two-way calendar sync, subscriptions. What we have that Skylight does not: local-first, no cloud, e-paper legibility, day-type-driven routines, habit sync with the owner's health record, exportable data.

## Learnings from photos of a Skylight in use (2026-10-31)

Owner's photos of a Skylight in a kitchen. Mostly they confirm decisions already in the spec.
Family Hub's routine page is already stronger; the Skylight's week view and progress counters
are worth borrowing for the Board.

### Borrow
1. **Week grid on the Board** (not the e-ink wall). Two rows of four cells: seven days plus a
   "Next week" cell. Each day shows date, weather, an "N events" count and event cards; today
   gets a badge; past days are greyed.
2. **"+N more" on overflow.** The Skylight cuts a day's fourth event off mid-card with no hint
   that more exist. The ICS adapter output and the "Today:" line cap the list and say "+2 more".
3. **Name-prefixed events** ("Name – Dancing", "Dad – Appointment") are what families already
   type. Backs SPEC §12.2: show "Ari: …" instead of colour. Parse the prefix; no per-event setup.
4. **Per-child progress pill** ("7/20") on the overview strip.

### Do not copy
1. **Members told apart only by colour.** Both kids show an "R" badge. Mono panel can't do
   this. Family Hub: member short labels must be unique (Planner refuses a duplicate since
   2026-11-05).
2. **Decorative emoji.** "Breakfast" is a winking face, "Brush teeth" a party face; a
   pre-reader can't act on that. Keep the rule: glyphs show the action (toothbrush, shoes, bowl).
3. **Whole-day counts on routines.** "0/20" at 10:30 am counts afternoon and evening steps and
   reads as failure. Keep per-routine counts ("3 of 6 this morning"); day total only on the
   overview strip, if at all.
4. **Scrolling routine cards.** Only ~2½ steps fit; "Got dressed" falls off the bottom. Keep
   fixed 6-slot picture mode, no scrolling.
5. **Editing controls on a shared screen.** "+ Add Event" per day, a + button, ten nav tabs,
   "Magic Import", permanent "Long press to reorder" tips. Backs the rule: wall never edits,
   Board only completes.
6. **Tick box far from its item.** Grocery checkbox sits mid-screen away from the text. Stage 2
   lists: the whole row is the tap target, as routine steps already are.
7. **Glare.** Glossy LCD shows heavy reflections and moiré in a kitchen; matte e-paper is an
   advantage.

### Where each stands

| | Skylight | Family Hub |
|---|---|---|
| Kids' routine | Colour, emoji, scrolling, several kids side by side | Fixed slots, action glyphs, no scrolling, routine by time and day type; one child so far |
| Calendar | Strong week view, weather per day | Weak: cramped strip; "Today:" line in Stage 2 |
| Lists, weather, countdowns | Built | Stage 2 |
| Several kids | Columns per child, "Up for Grabs" | Overview strip planned; "Up for Grabs" Later |
| Editing | On the device (cluttered) | Phone only, by design |
| Screen | Glossy LCD, colour | Matte e-paper, mono; colour is the Board's job |

The Skylight shows the whole family's week at a glance; Family Hub does not yet. Stage 2
(calendar, overview, lists, Board week grid) closes that gap.
