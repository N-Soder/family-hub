import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { device, list, member, servedSnapshot } from '../db/schema';
import layout from '../../../../tesserae/pages/layout.json';
import { activeRunDate, selectActive, selectNext } from './windows';
import { getOrCreateOccurrence, occurrenceSteps, templatesForMember, dayTypeById, resolveDayType, type OccStep } from './routines';
import { displayDate, hhmm, localParts, DEFAULT_TZ } from './time';
import { agendaDue, shareRows, wallLists, wallTodo } from './lists';
import { weatherCache, type WallWeather } from '../weather';
import { LISTS_IDLE_MS, wallScreens, type Screen } from './screens';
import { activePlan, durationLabel, firstBaby, isSleepy, planDay, runningLabel } from './plan';

export type Mode = 'picture' | 'reader';
export const SLOT_COUNT: Record<Mode, number> = {
	picture: layout.variants.picture.slots,
	reader: layout.variants.reader.slots
};

/** Rows on the lists screen, shared between the lists. */
export const LIST_SLOTS: number = layout.lists.slots;
/** The Lists / Back button's tap slot (same on both screens). */
export const NAV_SLOT: number = layout.navSlot;
/** The baby's plan button's tap slot (older frames only: the plan is now a tab on the routines screen). */
export const PLAN_SLOT: number = layout.planSlot;
/** The Routines button's tap slot (home screen). */
export const ROUTINES_SLOT: number = layout.routinesSlot;
/** The routines screen's tabs, one per child or baby, in member order. */
export const MEMBER_SLOTS: number[] = layout.memberSlots;
/** Urgent to-do rows on the home screen. */
export const TODO_SLOTS: number = layout.home.todoSlots;
/** Highest tap slot a wall can send (the buttons sit above the row slots). */
export const MAX_TAP_SLOT = Math.max(NAV_SLOT, PLAN_SLOT, ROUTINES_SLOT, ...MEMBER_SLOTS);

/** What a tap slot meant in a served frame. Snapshots from before the lists screen have no `kind` (= step). */
export type SlotEntry =
	| {
			slot: number; // 1-based, matches the tap URL
			kind?: 'step';
			occurrenceStepId: number;
			occurrenceId: number;
			state: 'done' | 'todo';
	  }
	| { slot: number; kind: 'item'; itemId: number; state: 'done' | 'todo' }
	| { slot: number; kind: 'nav'; to: Screen; /** routines tab: the child it shows */ member?: number };

/** The baby's plan screen (SPEC §12.3): read only on the wall; ticked from phones. */
export interface WallPlanPayload {
	name: string; // the baby's name
	plan: string; // the plan's name, e.g. "6–9 months"
	icon: string;
	rows: Array<{
		time: string | null;
		title: string;
		icon: string | null;
		done: boolean;
		estimate: boolean;
		next: boolean;
		waiting: string | null;
		/** A timer step: "asleep" while it runs, "until 10:40 am · 48 min" once stopped, else null. */
		note: string | null;
		running: boolean;
	}>;
}

export type StepSlot = Extract<SlotEntry, { occurrenceStepId: number }>;
export const isStepSlot = (e: SlotEntry): e is StepSlot => (e.kind ?? 'step') === 'step';

export interface WallListPayload {
	id: number;
	name: string;
	icon: string;
	open: number;
	items: Array<{ slot: number; title: string; done: boolean; touch_id: string; /** "In 12 days", "3 days late"; null when undated. */ due: string | null; late: boolean }>;
	/** Open items that did not fit. */
	more: number;
}

export interface RenderPayload {
	generated_at: string;
	snapshot_id: number | null;
	page: string;
	date_label: string;
	updated_label: string;
	/** Name of the device being served. Painted in the footer so two devices never share
	 * identical pixels: Tesserae keys tap maps by a hash of the pixels (see architecture §8). */
	device_label: string;
	/** IANA zone for formatting calendar times on the wall. */
	tz: string;
	/** Which screen: home, the routines, the lists, or (older frames) the baby's plan. */
	screen: Screen;
	/** The Lists button (on the home screen) or Back (on the other screens); null on home when there are no lists. */
	nav: null | { to: Screen; touch_id: string };
	/** The Routines button (home screen, when there is a child or baby). `sub`: what is on, e.g. "Juno asleep since 9:52 am". */
	routines_nav: null | { touch_id: string; sub: string | null };
	/** Home: urgent list items (overdue, due within a week, flagged Now), each row a tap slot. */
	todo: null | { items: Array<{ title: string; done: boolean; due: string | null; late: boolean }>; more: number };
	/** Home: today's weather (null: no place set, or no forecast yet). */
	weather: WallWeather | null;
	/** Home's agenda: dated list items due after the To do window, on their day (YYYY-MM-DD). */
	agenda_due: Array<{ date: string; title: string }>;
	/** Routines screen: one tab per child or baby; `on` = the one shown. */
	tabs: Array<{ id: number; name: string; icon: string; touch_id: string; on: boolean; sub: string | null }>;
	/** The lists screen's lists (empty on the home screen). */
	lists: WallListPayload[];
	/** The baby's timetable (plan screen, or a baby's tab on the routines screen; else null). */
	plan: WallPlanPayload | null;
	/** Routines screen: the checklist, or 'week' when none is running (or it finished a while ago). */
	view: 'routine' | 'week';
	mode: Mode;
	children: Array<{
		id: number;
		name: string;
		short_label: string;
		icon: string;
		display_mode: Mode;
		today: { day_type: string | null; label: string; glyph: string | null; events: Array<{ time: string; title: string }> };
		routine: null | {
			occurrence_id: number;
			name: string;
			kind: string;
			window: string;
			done: number;
			total: number;
			all_done: boolean;
		};
		next: null | { name: string; start: string };
	}>;
	slots: Array<{ slot: number; title: string; icon: string | null; done: boolean; touch_id: string }>;
	overflow: number;
	/** The screens the wall's buttons cycle through, in order; `on` = the one shown (ADR-28). */
	pages: Array<{ label: string; on: boolean }>;
}

/** How long a finished checklist stays on the wall before the week view replaces it. */
export const DONE_GRACE_MS = 2 * 60_000;

export interface BuildOptions {
	tz?: string;
	rolloverMinutes?: number;
	now?: Date;
	screen?: Screen;
	/** Routines screen: the child picked (null = the page chooses). */
	member?: number | null;
	/** Home's weather; default: the in-memory forecast (`weatherCache`). */
	weather?: WallWeather | null;
}

/** Which member a wall page shows. Stage 1: `home` = first active child; `member-<id>` = that member. */
export function memberForPage(db: DB, page: string) {
	const m = /^member-(\d+)$/.exec(page);
	if (m) return db.select().from(member).where(and(eq(member.id, Number(m[1])), eq(member.active, true))).get() ?? null;
	if (page === 'home') {
		return (
			db
				.select()
				.from(member)
				.where(and(eq(member.kind, 'child'), eq(member.active, true)))
				.orderBy(asc(member.sort), asc(member.id))
				.get() ?? null
		);
	}
	return null;
}

export function isKnownPage(page: string): boolean {
	return page === 'home' || /^member-\d+$/.test(page);
}

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function dateLabel(date: string): string {
	let f = dateFmt.get('d');
	if (!f) {
		f = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
		dateFmt.set('d', f);
	}
	return f.format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Touch ids carry the occurrence so a routine switch changes the tap layout (see architecture §8 S3). */
export function touchId(occurrenceId: number, slot: number): string {
	return `o${occurrenceId}-s${slot}`;
}
export function parseTouchId(regionId: string): { occurrenceId: number; slot: number } | null {
	const m = /o(\d+)-s(\d+)/.exec(regionId);
	return m ? { occurrenceId: Number(m[1]), slot: Number(m[2]) } : null;
}

/** What a slot points at, as it appears in touch ids: `o12` (routine run), `i5` (list item), `nlists` (button). */
export function slotKey(e: SlotEntry): string {
	if (e.kind === 'item') return `i${e.itemId}`;
	if (e.kind === 'nav') return `n${e.to}`;
	return `o${e.occurrenceId}`;
}
export function slotTouchId(e: SlotEntry): string {
	return `${slotKey(e)}-s${e.slot}`;
}
/** Read a tap's region id back (Tesserae wraps touch ids, e.g. `el:i5-s3:tap`). */
export function parseRegion(regionId: string): { key: string; slot: number } | null {
	const m = /(?:^|[^a-z0-9])((?:o|i)\d+|n(?:home|lists|plan|routines))-s(\d+)/.exec(regionId);
	return m ? { key: m[1], slot: Number(m[2]) } : null;
}

/** The lists screen: the first lists, rows shared between them, each row a tap slot. */
function listsScreen(db: DB, now: Date, payload: RenderPayload, slots: SlotEntry[]): void {
	const lists = wallLists(db, now);
	const rows = shareRows(lists.map((l) => l.items.length), LIST_SLOTS);
	let slot = 0;
	lists.forEach((l, i) => {
		// A list that does not fit gives its last row to "+N more".
		const shown = l.items.length <= rows[i] ? l.items : l.items.slice(0, Math.max(0, rows[i] - 1));
		const out: WallListPayload = { id: l.id, name: l.name, icon: l.icon, open: l.open, items: [], more: l.items.filter((x) => !x.done).length - shown.filter((x) => !x.done).length };
		for (const item of shown) {
			const e: SlotEntry = { slot: ++slot, kind: 'item', itemId: item.id, state: item.done ? 'done' : 'todo' };
			slots.push(e);
			out.items.push({ slot: e.slot, title: item.title, done: item.done, touch_id: slotTouchId(e), due: item.due, late: item.late });
		}
		payload.lists.push(out);
	});
}

function addNav(payload: RenderPayload, slots: SlotEntry[], to: Screen): void {
	const e: SlotEntry = { slot: NAV_SLOT, kind: 'nav', to };
	slots.push(e);
	payload.nav = { to, touch_id: slotTouchId(e) };
}

/** The first baby with an active plan, if any. */
function babyPlan(db: DB) {
	const baby = firstBaby(db);
	const plan = baby ? activePlan(db, baby.id) : null;
	return baby && plan ? { baby, plan } : null;
}

/** The plan screen: the baby's timetable for the display date, with Back. */
function planScreen(db: DB, date: string, now: Date, tz: string, payload: RenderPayload): void {
	const bp = babyPlan(db);
	if (!bp) return;
	const day = planDay(db, bp.plan, date, now, tz);
	payload.plan = {
		name: bp.baby.name,
		plan: bp.plan.name,
		icon: bp.baby.icon,
		rows: day.rows.map((r) => ({
			time: r.time,
			title: r.title,
			icon: r.icon,
			done: r.done,
			estimate: r.estimate,
			next: r.next,
			waiting: r.waiting,
			note: r.running
				? isSleepy(r.icon) ? 'asleep' : 'now'
				: r.timer && r.endTime ? `until ${r.endTime}${r.durationMin !== null ? ` · ${durationLabel(r.durationMin)}` : ''}` : null,
			running: r.running
		}))
	};
}

/** Build the payload for a page without side effects. */
export function buildPayload(db: DB, page: string, opts: BuildOptions = {}): { payload: RenderPayload; slots: SlotEntry[] } {
	const tz = opts.tz ?? DEFAULT_TZ;
	const now = opts.now ?? new Date();
	const shownDate = displayDate(now, tz, opts.rolloverMinutes ?? 180);
	const who = memberForPage(db, page);
	const payload: RenderPayload = {
		generated_at: now.toISOString(),
		snapshot_id: null,
		page,
		date_label: dateLabel(shownDate),
		updated_label: timeLabel(localParts(now, tz).minutes),
		device_label: '',
		tz,
		screen: opts.screen ?? 'home',
		nav: null,
		routines_nav: null,
		todo: null,
		weather: null,
		agenda_due: [],
		tabs: [],
		lists: [],
		plan: null,
		view: 'week',
		mode: who?.displayMode ?? 'reader',
		children: [],
		slots: [],
		overflow: 0,
		pages: []
	};
	const slots: SlotEntry[] = [];
	const hasLists = db.select({ id: list.id }).from(list).get() !== undefined;
	if (payload.screen === 'lists') {
		listsScreen(db, now, payload, slots);
		addNav(payload, slots, 'home');
		return { payload: withPages(db, payload), slots };
	}
	if (payload.screen === 'plan') {
		planScreen(db, shownDate, now, tz, payload);
		addNav(payload, slots, 'home');
		return { payload: withPages(db, payload), slots };
	}
	if (payload.screen === 'routines') {
		// A per-member wall page opens on its own member's tab.
		routinesScreen(db, opts.member ?? (page === 'home' ? null : (who?.id ?? null)), shownDate, now, tz, payload, slots);
		addNav(payload, slots, 'home');
		return { payload: withPages(db, payload), slots };
	}

	// Home: the date (and the page member's day type), TODAY, TO DO, the coming week.
	if (hasLists) addNav(payload, slots, 'lists');
	const kids = routineMembers(db);
	if (kids.length) {
		const e: SlotEntry = { slot: ROUTINES_SLOT, kind: 'nav', to: 'routines' };
		slots.push(e);
		payload.routines_nav = { touch_id: slotTouchId(e), sub: routinesSub(db, kids, shownDate, now, tz) };
	}
	todoSection(db, now, payload);
	payload.weather = opts.weather !== undefined ? opts.weather : weatherCache.get(now, tz);
	payload.agenda_due = agendaDue(db, now);
	if (who) {
		const active = selectActive(templatesForMember(db, who.id), now, tz);
		const dayTypeId = active ? getOrCreateOccurrence(db, active.template, active.date, now).dayTypeId : resolveDayType(db, who.id, shownDate);
		const dt = dayTypeById(db, dayTypeId);
		payload.children.push({
			id: who.id,
			name: who.name,
			short_label: who.shortLabel,
			icon: who.icon,
			display_mode: who.displayMode,
			today: { day_type: dt?.name ?? null, label: dt ? `Today: ${dt.name}` : 'Today', glyph: dt?.glyph ?? null, events: [] },
			routine: null,
			next: null
		});
	}
	return { payload: withPages(db, payload), slots };
}

/** One stop in the wall's button cycle (ADR-28). */
export interface WallStop {
	screen: Screen;
	member: number | null;
	label: string;
}

/**
 * The screens the wall's buttons step through: Home only (ADR-35). Routines left the wall on
 * 2026-11-03 (they are on the iPad kid view, ADR-27) and Lists on 2026-11-12: the wall wakes
 * once a day on battery (ADR-34), so a second screen would sit there until the next morning.
 * Any button repaints Home. The lists screen's code stays, unreachable from the buttons.
 */
export function wallStops(_db: DB): WallStop[] {
	return [{ screen: 'home', member: null, label: 'Home' }];
}

/**
 * Where a screen sits in the cycle. The routines screen is the stop of the child it shows
 * (`shown`); the older plan screen is the baby's stop.
 */
export function stopIndex(stops: WallStop[], screen: Screen, shown: number | null): number {
	const at = screen === 'plan' ? 'routines' : screen;
	const i = stops.findIndex((s) => s.screen === at && (at !== 'routines' || shown === null || s.member === shown));
	return i < 0 ? 0 : i;
}

function withPages(db: DB, payload: RenderPayload): RenderPayload {
	const stops = wallStops(db);
	const shown = payload.screen === 'plan' ? (babyPlan(db)?.baby.id ?? null) : (payload.tabs.find((t) => t.on)?.id ?? null);
	const at = stopIndex(stops, payload.screen, shown);
	payload.pages = stops.map((s, i) => ({ label: s.label, on: i === at }));
	return payload;
}

/** Children and babies, in member order: the routines screen's tabs. */
function routineMembers(db: DB) {
	return db
		.select()
		.from(member)
		.where(and(inArray(member.kind, ['child', 'baby']), eq(member.active, true)))
		.orderBy(asc(member.sort), asc(member.id))
		.limit(MEMBER_SLOTS.length)
		.all();
}
type RoutineMember = ReturnType<typeof routineMembers>[number];

/**
 * When the routines screen may close (ms): the latest end among the children's routines that
 * are on now or start within the idle time, else 0. Opened in the morning, it stays until the
 * morning routine's window closes, however long the gaps between taps.
 */
export function routinesHoldUntil(db: DB, now: Date, tz = DEFAULT_TZ): number {
	const soon = new Date(now.getTime() + LISTS_IDLE_MS);
	const { minutes } = localParts(now, tz);
	const minuteStart = now.getTime() - (now.getTime() % 60_000);
	let until = 0;
	for (const k of routineMembers(db)) {
		for (const t of templatesForMember(db, k.id)) {
			if (!activeRunDate(t, now, tz) && !activeRunDate(t, soon, tz)) continue;
			const left = (hhmm(t.windowEnd) - minutes + 1440) % 1440;
			until = Math.max(until, minuteStart + left * 60_000);
		}
	}
	return until;
}

/** A child's running routine, if any: how far through it is. */
function runningRoutine(db: DB, who: RoutineMember, now: Date, tz: string) {
	const active = selectActive(templatesForMember(db, who.id), now, tz);
	if (!active) return null;
	const occ = getOrCreateOccurrence(db, active.template, active.date, now);
	const steps = occurrenceSteps(db, occ.id);
	return { active, occ, steps, done: steps.filter((s) => s.completedAt).length };
}

/** What the Routines button says under its label: a nap running, else routines not finished yet. */
function routinesSub(db: DB, kids: RoutineMember[], date: string, now: Date, tz: string): string | null {
	const bp = babyPlan(db);
	if (bp) {
		const running = planDay(db, bp.plan, date, now, tz).running;
		if (running) return `${bp.baby.name} ${runningLabel(running)}`;
	}
	const open = kids.filter((k) => {
		const r = runningRoutine(db, k, now, tz);
		return r && r.steps.length > 0 && r.done < r.steps.length;
	});
	return open.length ? `${open.map((k) => k.name).join(' & ')} to do` : null;
}

/** Home's TO DO: urgent list items to read, not tap (ticking is on the Lists screen); a list too long ends in "+N more". */
function todoSection(db: DB, now: Date, payload: RenderPayload): void {
	const all = wallTodo(db, now);
	const shown = all.length <= TODO_SLOTS ? all : all.slice(0, TODO_SLOTS - 1);
	payload.todo = {
		items: shown.map((item) => ({ title: item.title, done: item.done, due: item.due, late: item.late })),
		more: all.filter((i) => !i.done).length - shown.filter((i) => !i.done).length
	};
}

/**
 * The routines screen: a tab per child or baby, and the chosen one's checklist (or a baby's
 * day plan). With none chosen it opens on the first child with a routine to finish.
 */
function routinesScreen(db: DB, chosen: number | null, date: string, now: Date, tz: string, payload: RenderPayload, slots: SlotEntry[]): void {
	const kids = routineMembers(db);
	if (!kids.length) return;
	const running = new Map(kids.map((k) => [k.id, runningRoutine(db, k, now, tz)]));
	const bp = babyPlan(db);
	const who =
		kids.find((k) => k.id === chosen) ??
		kids.find((k) => {
			const r = running.get(k.id);
			return r && r.steps.length > 0 && r.done < r.steps.length;
		}) ??
		kids[0];
	kids.forEach((k, i) => {
		const e: SlotEntry = { slot: MEMBER_SLOTS[i], kind: 'nav', to: 'routines', member: k.id };
		slots.push(e);
		const r = running.get(k.id);
		const sub = bp && bp.baby.id === k.id ? 'Day plan' : r && r.steps.length ? `${r.done} of ${r.steps.length}` : null;
		payload.tabs.push({ id: k.id, name: k.name, icon: k.icon, touch_id: slotTouchId(e), on: k.id === who.id, sub });
	});
	payload.mode = who.displayMode;
	// A baby with a day plan: the plan's timetable (read only).
	if (bp && bp.baby.id === who.id) {
		planScreen(db, date, now, tz, payload);
		return;
	}
	const r = running.get(who.id) ?? null;
	const next = selectNext(templatesForMember(db, who.id), now, tz);
	let routine: RenderPayload['children'][number]['routine'] = null;
	if (r) {
		const { active, occ, steps } = r;
		routine = {
			occurrence_id: occ.id,
			name: active.template.name,
			kind: active.template.kind,
			window: `${timeLabel(hhmm(active.template.windowStart))} – ${timeLabel(hhmm(active.template.windowEnd))}`,
			done: r.done,
			total: steps.length,
			all_done: steps.length > 0 && steps.every((s) => s.completedAt)
		};
		// A finished checklist stays up (with "All done!") for a short while, so a mis-tap can be
		// undone and the finish is seen; then it says when the next one is.
		const doneAt = routine.all_done ? Math.max(...steps.map((s) => Date.parse(s.completedAt!))) : null;
		payload.view = doneAt !== null && now.getTime() - doneAt >= DONE_GRACE_MS ? 'week' : 'routine';
		if (payload.view === 'routine') {
			const max = SLOT_COUNT[who.displayMode];
			steps.slice(0, max).forEach((st, i) => {
				const slot = i + 1;
				slots.push({ slot, occurrenceStepId: st.id, occurrenceId: occ.id, state: st.completedAt ? 'done' : 'todo' });
				payload.slots.push({ slot, title: st.titleSnapshot, icon: st.iconSnapshot, done: Boolean(st.completedAt), touch_id: touchId(occ.id, slot) });
			});
			payload.overflow = Math.max(0, steps.length - max);
		}
	}
	const dt = dayTypeById(db, r ? r.occ.dayTypeId : resolveDayType(db, who.id, date));
	payload.children.push({
		id: who.id,
		name: who.name,
		short_label: who.shortLabel,
		icon: who.icon,
		display_mode: who.displayMode,
		today: { day_type: dt?.name ?? null, label: dt ? `Today: ${dt.name}` : 'Today', glyph: dt?.glyph ?? null, events: [] },
		routine,
		next: next ? { name: next.name, start: timeLabel(hhmm(next.windowStart)) } : null
	});
}

const KEEP_SNAPSHOTS = 50;

/** Build the payload and record what was served for (device, page). */
export function renderForDevice(db: DB, deviceId: string, page: string, opts: BuildOptions = {}): RenderPayload {
	const screen = opts.screen ?? wallScreens.get(deviceId, opts.now);
	const member = opts.member !== undefined ? opts.member : wallScreens.member(deviceId, opts.now);
	const { payload, slots } = buildPayload(db, page, { ...opts, screen, member });
	payload.device_label = db.select({ name: device.name }).from(device).where(eq(device.id, deviceId)).get()?.name || deviceId;
	const row = db
		.insert(servedSnapshot)
		.values({
			deviceId,
			pageId: page,
			renderedAt: payload.generated_at,
			slotsJson: JSON.stringify(slots)
		})
		.returning({ id: servedSnapshot.id })
		.get();
	payload.snapshot_id = row.id;
	// Prune old snapshots for this device/page.
	const cutoff = db
		.select({ id: servedSnapshot.id })
		.from(servedSnapshot)
		.where(and(eq(servedSnapshot.deviceId, deviceId), eq(servedSnapshot.pageId, page)))
		.orderBy(desc(servedSnapshot.id))
		.limit(1)
		.offset(KEEP_SNAPSHOTS)
		.get();
	if (cutoff) {
		db.delete(servedSnapshot)
			.where(and(eq(servedSnapshot.deviceId, deviceId), eq(servedSnapshot.pageId, page), lt(servedSnapshot.id, cutoff.id + 1)))
			.run();
	}
	return payload;
}

export function latestSnapshot(db: DB, deviceId: string, page: string) {
	const row = db
		.select()
		.from(servedSnapshot)
		.where(and(eq(servedSnapshot.deviceId, deviceId), eq(servedSnapshot.pageId, page)))
		.orderBy(desc(servedSnapshot.id))
		.get();
	if (!row) return null;
	return { ...row, slots: JSON.parse(row.slotsJson) as SlotEntry[] };
}

/**
 * What the wall shows, as a key that changes exactly when the layout does: the routine
 * (occurrence) and whether its checklist or the week view is up; on the lists screen, which
 * items have rows. The repainter sends a full frame when it changes.
 */
export function wallViewKey(db: DB, page: string, opts: BuildOptions = {}): string {
	const { payload } = buildPayload(db, page, opts);
	if (payload.screen === 'lists') {
		return `lists:${payload.lists.map((l) => `${l.id}=${l.items.map((i) => i.touch_id).join(',')}+${l.more}`).join(';')}`;
	}
	if (payload.screen === 'plan') {
		// Any tick on a phone moves times on several rows: repaint the whole timetable.
		return `plan:${JSON.stringify(payload.plan)}`;
	}
	if (payload.screen === 'routines') {
		const tabs = payload.tabs.map((t) => `${t.id}${t.on ? '*' : ''}`).join(',');
		if (payload.plan) return `routines:${tabs}:plan:${JSON.stringify(payload.plan)}`;
		return `routines:${tabs}:${payload.children[0]?.routine?.occurrence_id ?? 'none'}:${payload.view}`;
	}
	// Home: which rows TO DO has (a tick patches its row; a row coming or going moves the rest).
	// What the weather band and the agenda's list items say: a change repaints the frame.
	return `home:${JSON.stringify(payload.weather)}:${payload.agenda_due.map((d) => d.date + d.title).join('|')}:${payload.nav ? 'nav' : ''}:${payload.routines_nav?.sub ?? ''}:${payload.children[0]?.today.day_type ?? ''}:${payload.todo?.items.map((i) => `${i.title}${i.done ? '✓' : ''}${i.due ?? ''}`).join('|') ?? ''}+${payload.todo?.more ?? 0}`;
}
