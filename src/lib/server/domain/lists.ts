import { and, asc, desc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { list, listItem, listItemLog } from '../db/schema';
import { addDays, localParts, DEFAULT_TZ } from './time';
import {
	addInterval,
	autoLeadDays,
	dueLabel,
	dueState,
	nextDue,
	ONE_OFF_LEAD_DAYS,
	progress,
	repeatLabel,
	skipDue,
	wallDueLabel,
	type DueState,
	type Repeat,
	type RepeatMode,
	type RepeatUnit
} from './repeat';

// Shared lists (SPEC §5, Stage 2). Every write is idempotent: ticking sets a state rather than
// flipping it, and adding an item that is already on the list does not duplicate it.

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export type ListKind = 'grocery' | 'todo' | 'other';
export type TickSource = 'wall' | 'board' | 'planner';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The household's calendar date (due dates and "done on" use it). */
export const localToday = (now = new Date(), tz = DEFAULT_TZ) => localParts(now, tz).date;

export type ItemRow = typeof listItem.$inferSelect;

export interface ItemMeta {
	due: string;
	state: DueState;
	/** "3 days overdue", "Due in 12 days", "Due 14 Mar". */
	label: string;
	/** "Every 12 months"; null for a one-off. */
	repeat: string | null;
	/** 0–1 through the interval (repeating items only). */
	progress: number | null;
}
export type ViewItem = ItemRow & { meta: ItemMeta | null };

/** The item's repeat, if it has a complete one (a due date is required). */
export function repeatOf(i: ItemRow): Repeat | null {
	if (!i.repeatEvery || !i.repeatUnit || !i.repeatMode || !i.dueDate) return null;
	return { every: i.repeatEvery, unit: i.repeatUnit, mode: i.repeatMode, anchor: i.repeatAnchor ?? i.dueDate };
}

/** Days before the due date that it starts showing: its own setting, or the automatic one. */
export function leadFor(i: ItemRow): number {
	if (i.leadDays !== null && i.leadDays !== undefined) return i.leadDays;
	const r = repeatOf(i);
	return r ? autoLeadDays(r.every, r.unit) : ONE_OFF_LEAD_DAYS;
}

export function itemMeta(i: ItemRow, today: string): ItemMeta | null {
	if (!i.dueDate) return null;
	const r = repeatOf(i);
	const state = dueState(i.dueDate, today, leadFor(i));
	return {
		due: i.dueDate,
		state,
		label: dueLabel(i.dueDate, today, state),
		repeat: r ? repeatLabel(r) : null,
		progress: r ? progress(i.dueDate, today, r.every, r.unit) : null
	};
}

/** Due-soon items first (by due date), then items flagged Now, then the rest in list order. */
function showOrder(today: string, dueOf: (i: ItemRow) => string | null = (i) => i.dueDate) {
	return (a: ItemRow, b: ItemRow) => {
		const key = (i: ItemRow) => {
			const due = dueOf(i);
			if (due && dueState(due, today, leadFor(i)) !== 'later') return `0${due}`;
			return i.nowSince ? '1' : '2';
		};
		const ka = key(a);
		const kb = key(b);
		return ka !== kb ? (ka < kb ? -1 : 1) : a.sort - b.sort || a.id - b.id;
	};
}

/**
 * A list's items as the Planner shows them: `open` (what is on the list now), `later`
 * (repeating items not due yet, by due date) and `done` (ticked one-offs).
 */
export function arrange(items: ItemRow[], today: string) {
	const view = (i: ItemRow): ViewItem => ({ ...i, meta: itemMeta(i, today) });
	const done = items.filter((i) => i.doneAt).sort((a, b) => (b.doneAt! > a.doneAt! ? 1 : b.doneAt! < a.doneAt! ? -1 : b.id - a.id));
	const notDone = items.filter((i) => !i.doneAt);
	const isLater = (i: ItemRow) => repeatOf(i) !== null && dueState(i.dueDate!, today, leadFor(i)) === 'later';
	return {
		open: notDone.filter((i) => !isLater(i)).sort(showOrder(today)).map(view),
		later: notDone.filter(isLater).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.id - b.id)).map(view),
		done: done.map(view),
		/** Every item not ticked, in list order (edit mode). */
		all: [...notDone].sort((a, b) => a.sort - b.sort || a.id - b.id).map(view)
	};
}

export function allLists(db: DB, now = new Date()) {
	const today = localToday(now);
	const items = db.select().from(listItem).all();
	return db
		.select()
		.from(list)
		.orderBy(asc(list.sort), asc(list.id))
		.all()
		.map((l) => {
			const a = arrange(
				items.filter((i) => i.listId === l.id),
				today
			);
			return { ...l, open: a.open.length, done: a.done.length, later: a.later.length };
		});
}

export function listDetail(db: DB, id: number, now = new Date()) {
	const l = db.select().from(list).where(eq(list.id, id)).get();
	if (!l) return null;
	return { list: l, ...arrange(db.select().from(listItem).where(eq(listItem.listId, id)).all(), localToday(now)) };
}

/** Is anything on any list dated or flagged Now? (Shows the Coming up view.) */
export function anyDated(db: DB): boolean {
	return db.select({ id: listItem.id }).from(listItem).where(sql`${listItem.dueDate} is not null or ${listItem.nowSince} is not null`).get() !== undefined;
}

/** Across every list: everything due soon, due or overdue (by due date), then items flagged Now (oldest first). */
export function comingUp(db: DB, now = new Date()) {
	const today = localToday(now);
	const names = new Map(db.select().from(list).all().map((l) => [l.id, l]));
	const rows = db
		.select()
		.from(listItem)
		.where(and(isNull(listItem.doneAt), sql`(${listItem.dueDate} is not null or ${listItem.nowSince} is not null)`))
		.all()
		.map((i) => ({ ...i, meta: itemMeta(i, today), listName: names.get(i.listId)?.name ?? '' }));
	const dated = rows.filter((i) => i.meta && i.meta.state !== 'later').sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.id - b.id));
	const flagged = rows.filter((i) => !i.meta && i.nowSince).sort((a, b) => (a.nowSince! < b.nowSince! ? -1 : a.nowSince! > b.nowSince! ? 1 : a.id - b.id));
	return [...dated, ...flagged];
}

export function createList(db: DB, v: { name: string; kind: ListKind; icon: string }, now = new Date()): number {
	const sort = db.select({ n: sql<number>`count(*)` }).from(list).get()?.n ?? 0;
	return Number(db.insert(list).values({ ...v, sort, createdAt: now.toISOString() }).run().lastInsertRowid);
}

export function updateList(db: DB, id: number, v: { name: string; kind: ListKind; icon: string }): void {
	db.update(list).set(v).where(eq(list.id, id)).run();
}

export function deleteList(db: DB, id: number): void {
	db.delete(list).where(eq(list.id, id)).run(); // items cascade
}

function nextSort(db: DB | Tx, listId: number): number {
	const max = db
		.select({ m: sql<number | null>`max(${listItem.sort})` })
		.from(listItem)
		.where(and(eq(listItem.listId, listId), isNull(listItem.doneAt)))
		.get()?.m;
	return max === null || max === undefined ? 0 : Number(max) + 1;
}

export type AddResult = { status: 'added' | 'unticked' | 'exists'; itemId: number; title: string };

/**
 * Add an item to the bottom of the list. If the same item (ignoring case and spacing) is
 * already there it is not duplicated: an open one is left alone, a ticked one comes back.
 */
export function addItem(db: DB, listId: number, title: string, now = new Date()): AddResult {
	const clean = title.trim().replace(/\s+/g, ' ');
	return db.transaction((tx) => {
		const same = tx
			.select()
			.from(listItem)
			.where(eq(listItem.listId, listId))
			.all()
			.find((i) => norm(i.title) === norm(clean));
		if (same && !same.doneAt) return { status: 'exists', itemId: same.id, title: same.title } as const;
		if (same) {
			tx.update(listItem).set({ doneAt: null, doneBy: null, nowSince: null, sort: nextSort(tx, listId) }).where(eq(listItem.id, same.id)).run();
			return { status: 'unticked', itemId: same.id, title: same.title } as const;
		}
		const id = tx
			.insert(listItem)
			.values({ listId, title: clean, sort: nextSort(tx, listId), createdAt: now.toISOString() })
			.run().lastInsertRowid;
		return { status: 'added', itemId: Number(id), title: clean } as const;
	});
}

/**
 * Set an item's ticked state. Returns false when it was already in that state (or is gone).
 * Unticking moves the item to the bottom, except with `keepPlace` (the wall, where a mis-tap
 * is undone in the row it was made in).
 */
export function setItemDone(db: DB, itemId: number, done: boolean, source: TickSource, now = new Date(), opts: { keepPlace?: boolean } = {}): boolean {
	const item = db.select().from(listItem).where(eq(listItem.id, itemId)).get();
	// Repeating items are never ticked off; see completeRepeating.
	if (!item || Boolean(item.doneAt) === done || (done && repeatOf(item))) return false;
	db.update(listItem)
		.set(
			done
				? { doneAt: now.toISOString(), doneBy: source }
				: { doneAt: null, doneBy: null, ...(opts.keepPlace ? {} : { sort: nextSort(db, item.listId) }) }
		)
		.where(eq(listItem.id, itemId))
		.run();
	return true;
}

// ---- Due dates and repeats ----

export interface Schedule {
	due: string | null;
	repeat: null | { every: number; unit: RepeatUnit; mode: RepeatMode };
	/** null = automatic. */
	leadDays: number | null;
	/** Flag it Now (only without a date or repeat). */
	now?: boolean;
}

/**
 * Set an item's due date and repeat. A repeat needs a due date: with none given it is due one
 * interval from today. A fixed schedule counts from its due date.
 */
export function setSchedule(db: DB, itemId: number, v: Schedule, now = new Date()): void {
	const due = v.due ?? (v.repeat ? addInterval(localToday(now), v.repeat.every, v.repeat.unit) : null);
	const was = getItem(db, itemId)?.nowSince ?? null;
	db.update(listItem)
		.set({
			dueDate: due,
			nowSince: v.now && !due ? (was ?? now.toISOString()) : null,
			repeatEvery: v.repeat?.every ?? null,
			repeatUnit: v.repeat?.unit ?? null,
			repeatMode: v.repeat?.mode ?? null,
			repeatAnchor: v.repeat?.mode === 'fixed' ? due : null,
			leadDays: v.leadDays
		})
		.where(eq(listItem.id, itemId))
		.run();
}

/**
 * Flag an item Now (to pick up soon, no date) or clear the flag. Flagging clears a one-off
 * due date; a repeating item cannot be flagged. Returns false when nothing changed.
 */
export function setNow(db: DB, itemId: number, on: boolean, now = new Date()): boolean {
	const item = getItem(db, itemId);
	if (!item || Boolean(item.nowSince) === on || (on && repeatOf(item))) return false;
	db.update(listItem)
		.set(on ? { nowSince: now.toISOString(), dueDate: null, leadDays: null } : { nowSince: null })
		.where(eq(listItem.id, itemId))
		.run();
	return true;
}

export type DoneResult = { logId: number; next: string } | null;

/**
 * Record a repeating item as done on `doneOn` (default today; may be backdated) and move its
 * due date on. Returns null for an item that does not repeat.
 */
export function completeRepeating(
	db: DB,
	itemId: number,
	opts: { source: TickSource; doneOn?: string; note?: string | null; now?: Date }
): DoneResult {
	const now = opts.now ?? new Date();
	return db.transaction((tx) => {
		const item = tx.select().from(listItem).where(eq(listItem.id, itemId)).get();
		const r = item && repeatOf(item);
		if (!item || !r) return null;
		const doneOn = opts.doneOn ?? localToday(now);
		const next = nextDue(r, item.dueDate!, doneOn);
		const logId = Number(
			tx.insert(listItemLog).values({ itemId, kind: 'done', doneOn, doneAt: now.toISOString(), doneBy: opts.source, note: opts.note || null, dueBefore: item.dueDate! }).run()
				.lastInsertRowid
		);
		tx.update(listItem).set({ dueDate: next }).where(eq(listItem.id, itemId)).run();
		return { logId, next };
	});
}

/** Skip this one without doing it (logged as skipped, so it can be undone). */
export function skipRepeating(db: DB, itemId: number, source: TickSource, now = new Date()): DoneResult {
	return db.transaction((tx) => {
		const item = tx.select().from(listItem).where(eq(listItem.id, itemId)).get();
		const r = item && repeatOf(item);
		if (!item || !r) return null;
		const next = skipDue(r, item.dueDate!);
		const logId = Number(
			tx.insert(listItemLog).values({ itemId, kind: 'skipped', doneOn: localToday(now), doneAt: now.toISOString(), doneBy: source, dueBefore: item.dueDate! }).run().lastInsertRowid
		);
		tx.update(listItem).set({ dueDate: next }).where(eq(listItem.id, itemId)).run();
		return { logId, next };
	});
}

/** Push the due date back `days` (from today if it is already overdue). Returns the new date. */
export function snoozeItem(db: DB, itemId: number, days: number, now = new Date()): string | null {
	const item = db.select().from(listItem).where(eq(listItem.id, itemId)).get();
	if (!item?.dueDate) return null;
	const today = localToday(now);
	const due = addDays(item.dueDate < today ? today : item.dueDate, days);
	db.update(listItem).set({ dueDate: due }).where(eq(listItem.id, itemId)).run();
	return due;
}

/**
 * Remove a history entry. Removing the latest one is an undo: the due date goes back to what
 * it was. Older entries just leave the history. Returns false when the entry has gone.
 */
export function removeLog(db: DB, logId: number): boolean {
	return db.transaction((tx) => {
		const log = tx.select().from(listItemLog).where(eq(listItemLog.id, logId)).get();
		if (!log) return false;
		const latest = tx.select().from(listItemLog).where(eq(listItemLog.itemId, log.itemId)).orderBy(desc(listItemLog.id)).limit(1).get();
		tx.delete(listItemLog).where(eq(listItemLog.id, logId)).run();
		if (latest?.id === logId) tx.update(listItem).set({ dueDate: log.dueBefore }).where(eq(listItem.id, log.itemId)).run();
		return true;
	});
}

export function itemLog(db: DB, itemId: number) {
	return db.select().from(listItemLog).where(eq(listItemLog.itemId, itemId)).orderBy(desc(listItemLog.doneOn), desc(listItemLog.id)).all();
}

/** One item with its list, for the item page. */
export function itemDetail(db: DB, itemId: number, now = new Date()) {
	const item = db.select().from(listItem).where(eq(listItem.id, itemId)).get();
	if (!item) return null;
	const l = db.select().from(list).where(eq(list.id, item.listId)).get()!;
	return { item: { ...item, meta: itemMeta(item, localToday(now)) }, list: l, log: itemLog(db, itemId), lead: leadFor(item), today: localToday(now) };
}

/** A repeating item's latest log entry, if it is a "done" made in the last `withinMs`. */
export function recentDone(db: DB, itemId: number, now: Date, withinMs: number) {
	const log = db.select().from(listItemLog).where(eq(listItemLog.itemId, itemId)).orderBy(desc(listItemLog.id)).limit(1).get();
	return log && log.kind === 'done' && now.getTime() - Date.parse(log.doneAt) < withinMs ? log : null;
}

// ---- Starter jobs for a house list ----

export interface Suggestion {
	key: string;
	title: string;
	repeat: { every: number; unit: RepeatUnit; mode: RepeatMode };
	/** A fixed date in the year (MM-DD) for the first due date; otherwise one interval from today. */
	on?: string;
}

export const SUGGESTIONS: Suggestion[] = [
	{ key: 'car-service', title: 'Service the car', repeat: { every: 12, unit: 'month', mode: 'after' } },
	{ key: 'car-rego', title: 'Renew car rego', repeat: { every: 1, unit: 'year', mode: 'fixed' } },
	{ key: 'smoke-test', title: 'Test smoke alarms', repeat: { every: 1, unit: 'month', mode: 'fixed' } },
	{ key: 'smoke-batteries', title: 'Smoke alarm batteries', repeat: { every: 1, unit: 'year', mode: 'fixed' }, on: '04-01' },
	{ key: 'aircon', title: 'Clean aircon filters', repeat: { every: 3, unit: 'month', mode: 'after' } },
	{ key: 'gutters', title: 'Clean the gutters', repeat: { every: 6, unit: 'month', mode: 'after' } },
	{ key: 'pool', title: 'Check pool chlorine', repeat: { every: 1, unit: 'week', mode: 'after' } }
];

/** Suggestions not already on the list (by name). */
export function suggestionsFor(db: DB, listId: number): Suggestion[] {
	const have = new Set(db.select({ t: listItem.title }).from(listItem).where(eq(listItem.listId, listId)).all().map((r) => norm(r.t)));
	return SUGGESTIONS.filter((s) => !have.has(norm(s.title)));
}

/** Add a suggestion with its repeat. The first due date is a guess; the item page asks to check it. */
export function addSuggestion(db: DB, listId: number, key: string, now = new Date()): number | null {
	const s = SUGGESTIONS.find((x) => x.key === key);
	if (!s) return null;
	const res = addItem(db, listId, s.title, now);
	if (res.status === 'exists') return res.itemId;
	const today = localToday(now);
	let due: string | null = null;
	if (s.on) {
		due = `${today.slice(0, 4)}-${s.on}`;
		if (due <= today) due = addInterval(due, 1, 'year');
	}
	setSchedule(db, res.itemId, { due, repeat: s.repeat, leadDays: null }, now);
	return res.itemId;
}

/** Set an item's notes (null or blank clears them). Line breaks are kept. */
export function setNotes(db: DB, itemId: number, notes: string | null): void {
	const clean = notes?.replace(/\r\n?/g, '\n').trim() || null;
	db.update(listItem).set({ notes: clean }).where(eq(listItem.id, itemId)).run();
}

export function renameItem(db: DB, itemId: number, title: string): void {
	db.update(listItem).set({ title: title.trim().replace(/\s+/g, ' ') }).where(eq(listItem.id, itemId)).run();
}

export function deleteItem(db: DB, itemId: number): void {
	db.delete(listItem).where(eq(listItem.id, itemId)).run();
}

/** Remove every ticked item from a list. Returns how many went. */
export function clearDone(db: DB, listId: number): number {
	return db.delete(listItem).where(and(eq(listItem.listId, listId), isNotNull(listItem.doneAt))).run().changes;
}

/** Move an open item up or down by swapping places (renumbers so sorts stay dense). */
export function moveItem(db: DB, itemId: number, dir: -1 | 1): void {
	const item = db.select().from(listItem).where(eq(listItem.id, itemId)).get();
	if (!item || item.doneAt) return;
	db.transaction((tx) => {
		const open = tx.select().from(listItem).where(and(eq(listItem.listId, item.listId), isNull(listItem.doneAt))).orderBy(asc(listItem.sort), asc(listItem.id)).all();
		const i = open.findIndex((x) => x.id === itemId);
		const j = i + dir;
		if (j < 0 || j >= open.length) return;
		[open[i], open[j]] = [open[j], open[i]];
		open.forEach((x, sort) => tx.update(listItem).set({ sort }).where(eq(listItem.id, x.id)).run());
	});
}

export function getItem(db: DB, itemId: number): ItemRow | undefined {
	return db.select().from(listItem).where(eq(listItem.id, itemId)).get();
}

/** Which list an item belongs to (for checking a form's item id against the page's list). */
export function itemListId(db: DB, itemId: number): number | null {
	return db.select({ listId: listItem.listId }).from(listItem).where(eq(listItem.id, itemId)).get()?.listId ?? null;
}

// ---- The wall's lists screen ----

/** How many lists the wall shows (the first ones in Planner order). */
export const WALL_LISTS = 2;
/** A ticked item stays on the wall (struck through, still tappable) this long, then drops off. */
export const WALL_TICK_GRACE_MS = 2 * 60_000;

export interface WallList {
	id: number;
	name: string;
	icon: string;
	kind: ListKind;
	open: number;
	/** Open and recently ticked items in list order. Dated items carry a short due label. */
	items: Array<{ id: number; title: string; done: boolean; due: string | null; late: boolean }>;
}

/**
 * The first lists with what the wall shows of each: open items, plus items ticked in the last
 * two minutes. Repeating items show only once they are due soon (or were just done).
 */
export function wallLists(db: DB, now = new Date()): WallList[] {
	const since = new Date(now.getTime() - WALL_TICK_GRACE_MS).toISOString();
	const today = localToday(now);
	return db
		.select()
		.from(list)
		.orderBy(asc(list.sort), asc(list.id))
		.limit(WALL_LISTS)
		.all()
		.map((l) => {
			const rows = db
				.select()
				.from(listItem)
				.where(and(eq(listItem.listId, l.id), sql`(${listItem.doneAt} is null or ${listItem.doneAt} > ${since})`))
				.all();
			// A repeating item done a moment ago keeps its row (sorted by the date it was due) so a mis-tap can be undone in place.
			const justDone = new Map(rows.filter((i) => repeatOf(i)).flatMap((i) => {
				const log = recentDone(db, i.id, now, WALL_TICK_GRACE_MS);
				return log ? [[i.id, log.dueBefore] as const] : [];
			}));
			const items = rows
				.filter((i) => justDone.has(i.id) || !repeatOf(i) || dueState(i.dueDate!, today, leadFor(i)) !== 'later')
				.sort(showOrder(today, (i) => justDone.get(i.id) ?? i.dueDate));
			const done = (i: ItemRow) => Boolean(i.doneAt) || justDone.has(i.id);
			return {
				id: l.id,
				name: l.name,
				icon: l.icon,
				kind: l.kind,
				open: items.filter((i) => !done(i)).length,
				items: items.map((i) => {
					const state = i.dueDate && !done(i) ? dueState(i.dueDate, today, leadFor(i)) : null;
					return {
						id: i.id,
						title: i.title,
						done: done(i),
						due: state && state !== 'later' ? wallDueLabel(i.dueDate!, today, state) : null,
						late: state === 'overdue'
					};
				})
			};
		});
}

/** How far ahead a dated item counts as urgent on the wall's home screen. */
export const WALL_TODO_DAYS = 7;

export interface WallTodo {
	id: number;
	title: string;
	done: boolean;
	/** "3 days late", "Today", "In 5 days"; null for an item flagged Now. */
	due: string | null;
	late: boolean;
}

/**
 * The wall's home screen TO DO: from every to-do and other list, what is overdue, due today,
 * due within a week, or flagged Now: dated ones by due date, then Now ones (oldest flag first).
 * Items ticked in the last two minutes stay (struck through) so a mis-tap can be undone.
 * Shopping lists stay on the lists screen.
 */
export function wallTodo(db: DB, now = new Date()): WallTodo[] {
	const since = new Date(now.getTime() - WALL_TICK_GRACE_MS).toISOString();
	const today = localToday(now);
	const horizon = addDays(today, WALL_TODO_DAYS);
	const kinds = new Map(db.select({ id: list.id, kind: list.kind }).from(list).all().map((l) => [l.id, l.kind]));
	const rows = db
		.select()
		.from(listItem)
		.where(and(sql`(${listItem.doneAt} is null or ${listItem.doneAt} > ${since})`, sql`(${listItem.dueDate} is not null or ${listItem.nowSince} is not null)`))
		.all()
		.filter((i) => kinds.get(i.listId) !== 'grocery');
	const justDone = new Map(
		rows.filter((i) => repeatOf(i)).flatMap((i) => {
			const log = recentDone(db, i.id, now, WALL_TICK_GRACE_MS);
			return log ? [[i.id, log.dueBefore] as const] : [];
		})
	);
	const dueOf = (i: ItemRow) => justDone.get(i.id) ?? i.dueDate;
	const dated = rows.filter((i) => dueOf(i) && dueOf(i)! <= horizon).sort((a, b) => (dueOf(a)! < dueOf(b)! ? -1 : dueOf(a)! > dueOf(b)! ? 1 : a.id - b.id));
	const flagged = rows.filter((i) => !i.dueDate && i.nowSince).sort((a, b) => (a.nowSince! < b.nowSince! ? -1 : a.nowSince! > b.nowSince! ? 1 : a.id - b.id));
	return [...dated, ...flagged].map((i) => {
		const done = Boolean(i.doneAt) || justDone.has(i.id);
		const due = dueOf(i);
		const state = due && !done ? dueState(due, today, WALL_TODO_DAYS) : null;
		return { id: i.id, title: i.title, done, due: state ? wallDueLabel(due!, today, state) : null, late: state === 'overdue' };
	});
}

/** How far ahead the wall's agenda shows dated list items (its calendar reads 3 weeks). */
export const AGENDA_DAYS = 21;

/**
 * Dated list items (not shopping) due after the To do window and within the agenda, by date:
 * the wall's agenda shows them on their day.
 */
export function agendaDue(db: DB, now = new Date()): Array<{ date: string; title: string }> {
	const today = localToday(now);
	const from = addDays(today, WALL_TODO_DAYS);
	const to = addDays(today, AGENDA_DAYS);
	const kinds = new Map(db.select({ id: list.id, kind: list.kind }).from(list).all().map((l) => [l.id, l.kind]));
	return db
		.select({ title: listItem.title, date: listItem.dueDate, listId: listItem.listId, id: listItem.id })
		.from(listItem)
		.where(and(isNull(listItem.doneAt), gt(listItem.dueDate, from), lte(listItem.dueDate, to)))
		.all()
		.filter((i) => kinds.get(i.listId) !== 'grocery')
		.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.id - b.id))
		.map((i) => ({ date: i.date!, title: i.title }));
}

/**
 * Share `rows` lines between lists that want `wants[i]` lines each (an empty list still
 * wants one, for "Nothing on the list"). Rows go one at a time to the list with the fewest
 * so far, so a short list keeps all its items and a long one gets the rest.
 */
export function shareRows(wants: number[], rows: number): number[] {
	const got = wants.map(() => 0);
	let left = rows;
	while (left > 0) {
		let pick = -1;
		for (let i = 0; i < wants.length; i++) if (got[i] < Math.max(1, wants[i]) && (pick < 0 || got[i] < got[pick])) pick = i;
		if (pick < 0) break;
		got[pick]++;
		left--;
	}
	return got;
}
