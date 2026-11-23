import { and, asc, eq, isNull } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db, type DB } from './db';
import { parseForm, patternDayForm } from './forms';
import { dayOverride, dayType, device, member, occurrence, routineStep, routineTemplate, servedSnapshot, weeklyPattern, occurrenceStep } from './db/schema';
import { env } from './env';
import { displayDate, hhmm } from './domain/time';
import { activeRunDate } from './domain/windows';
import { getOrCreateOccurrence, occurrenceSteps, parseDayTypeIds, regenerateOccurrence, resolveDayType, templatesForMember } from './domain/routines';
import { weekdayOf } from './domain/time';
import { setStepState } from './domain/toggle';
import { activePlan, localToIso, planDay, retimeEnd, retimeStep, startTimer, stopTimer, unstopTimer } from './domain/plan';
import { DIRECT_SIM_DEVICE, hub } from './hub';
import { publish } from './events';
import { syncCalendarDays as syncCalendarDaysDomain, type CalendarSync } from './domain/calendar-days';
import { completeRepeating, getItem, recentDone, removeLog, repeatOf, setItemDone, WALL_TICK_GRACE_MS } from './domain/lists';

export function today(now = new Date()): string {
	return displayDate(now, env().TZ_HOUSEHOLD, hhmm(env().DAY_ROLLOVER));
}

export function changed(memberId: number | null, stepIds: number[], full = false): void {
	publish({ type: 'change', memberId, reason: 'planner' });
	void hub().repainter.notify(stepIds, { full });
}

/** A list item ticked or unticked anywhere: phones refresh, the wall's lists and home repaint. */
export function listChanged(tickedItem?: number): void {
	publish({ type: 'change', memberId: null, reason: 'list' });
	void hub().repainter.notify(tickedItem ? [`i${tickedItem}`] : [], tickedItem ? { screen: ['lists', 'home'] } : { full: true, screen: ['lists', 'home'] });
}

/**
 * One tap on a list row from the Board or Home: done ↔ open, in place. A repeating job is done
 * for this time; a second tap within the grace window undoes that. False when the item has gone.
 */
export function tapItem(db: DB, itemId: number, source: 'board' | 'planner', now = new Date()): boolean {
	const item = getItem(db, itemId);
	if (!item) return false;
	if (repeatOf(item)) {
		const recent = recentDone(db, item.id, now, WALL_TICK_GRACE_MS);
		if (recent) removeLog(db, recent.id);
		else completeRepeating(db, item.id, { source, now });
		listChanged(item.id);
		return true;
	}
	if (setItemDone(db, item.id, !item.doneAt, source, now, { keepPlace: true })) listChanged(item.id);
	return true;
}

export function members(db: DB) {
	return db.select().from(member).orderBy(asc(member.sort), asc(member.id)).all();
}

/**
 * Short labels tell members apart on a mono panel (no colour), so two members may not share one.
 * Returns the other member's name when `label` is taken, else null.
 */
export function shortLabelTakenBy(db: DB, label: string, exceptId: number | null = null): string | null {
	const hit = members(db).find((m) => m.shortLabel.toUpperCase() === label.toUpperCase() && m.id !== exceptId);
	return hit?.name ?? null;
}

export function dayTypes(db: DB) {
	return db.select().from(dayType).orderBy(asc(dayType.sort), asc(dayType.id)).all();
}

/**
 * Day types from the calendar (ADR-29): write today's and the next two weeks' calendar day types,
 * and repaint if a day that is already on the wall changed. Runs every few minutes from the hub
 * and before the Schedule page renders. No calendar folder = nothing happens.
 */
export function syncCalendarDays(db: DB, now = new Date()): CalendarSync {
	const res = syncCalendarDaysDomain(db, env().CALENDAR_DIR, env().TZ_HOUSEHOLD, today(now));
	if (res.changed.some((c) => c.date === today(now))) changed(null, [], true);
	return res;
}

/** Today board: every active member, today's day type and every routine for today. */
export function todayBoard(db: DB, now = new Date()) {
	const date = today(now);
	const types = new Map(dayTypes(db).map((d) => [d.id, d]));
	return members(db)
		.filter((m) => m.active)
		.map((m) => {
			const row = db
				.select()
				.from(dayOverride)
				.where(and(eq(dayOverride.memberId, m.id), eq(dayOverride.localDate, date)))
				.get();
			// An adult's pick is an override; a calendar day is what today "usually" is (ADR-29).
			const override = row?.source === 'admin' ? row : null;
			const calendarDay = row?.source === 'calendar' ? row : null;
			const resolved = resolveDayType(db, m.id, date);
			const pattern = db
				.select()
				.from(weeklyPattern)
				.where(and(eq(weeklyPattern.memberId, m.id), eq(weeklyPattern.weekday, weekdayOf(date))))
				.get();
			const usual = calendarDay ?? pattern;
			const routines = templatesForMember(db, m.id)
				.filter((t) => (t.daysOfWeek & (1 << new Date(`${date}T00:00:00Z`).getUTCDay())) !== 0)
				.map((t) => {
					const occ = getOrCreateOccurrence(db, t, date, now);
					return {
						template: t,
						occurrence: occ,
						dayType: occ.dayTypeId ? (types.get(occ.dayTypeId) ?? null) : null,
						running: activeRunDate(t, now, env().TZ_HOUSEHOLD) === date,
						steps: occurrenceSteps(db, occ.id)
					};
				});
			// A baby has a day plan instead of routines (SPEC §12.3).
			const planT = m.kind === 'baby' ? activePlan(db, m.id) : null;
			return {
				member: m,
				date,
				plan: planT ? planDay(db, planT, date, now, env().TZ_HOUSEHOLD) : null,
				override,
				calendarDay: calendarDay ? { title: calendarDay.note ?? '', dayTypeId: calendarDay.dayTypeId } : null,
				usualDayTypeId: usual?.dayTypeId ?? null,
				dayType: resolved ? (types.get(resolved) ?? null) : null,
				routines
			};
		});
}

export function setOverride(db: DB, memberId: number, date: string, dayTypeId: number | null): void {
	db.delete(dayOverride)
		.where(and(eq(dayOverride.memberId, memberId), eq(dayOverride.localDate, date), eq(dayOverride.source, 'admin')))
		.run();
	if (dayTypeId !== null) {
		db.insert(dayOverride)
			.values({ memberId, localDate: date, dayTypeId, source: 'admin' })
			.onConflictDoUpdate({ target: [dayOverride.memberId, dayOverride.localDate], set: { dayTypeId, source: 'admin' } })
			.run();
	}
}

export function regenerateToday(db: DB, memberId: number, now = new Date()): void {
	const date = today(now);
	for (const t of templatesForMember(db, memberId)) {
		const occ = getOrCreateOccurrence(db, t, date, now);
		regenerateOccurrence(db, occ, t);
	}
	changed(memberId, [], true);
}

/**
 * After a step edit, bring today's checklist for that routine in line with it (if today's has
 * been generated; otherwise it picks the edit up when it is). Ticked steps stay; the day type
 * the day started with stays.
 */
export function syncTemplateToday(db: DB, templateId: number, now = new Date()): void {
	const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, templateId)).get();
	if (!t) return;
	const occ = db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.templateId, templateId), eq(occurrence.localDate, today(now))))
		.get();
	if (!occ) return;
	regenerateOccurrence(db, occ, t, { keepDayType: true });
	changed(t.memberId, [], true);
}

/** Tick or untick from the Planner. False when there is no such step (a stale or crafted form). */
export function toggleFromPlanner(db: DB, stepId: number, done: boolean): boolean {
	if (!db.select({ id: occurrenceStep.id }).from(occurrenceStep).where(eq(occurrenceStep.id, stepId)).get()) return false;
	const res = setStepState(db, stepId, done, 'planner');
	if (res.changed) {
		if (isPlanStep(db, stepId)) planChanged();
		else changed(null, [stepId]);
	}
	return true;
}

/** Is this occurrence step part of a baby's plan? */
function isPlanStep(db: DB, occurrenceStepId: number): boolean {
	const row = db
		.select({ kind: routineTemplate.kind })
		.from(occurrenceStep)
		.innerJoin(occurrence, eq(occurrence.id, occurrenceStep.occurrenceId))
		.innerJoin(routineTemplate, eq(routineTemplate.id, occurrence.templateId))
		.where(eq(occurrenceStep.id, occurrenceStepId))
		.get();
	return row?.kind === 'plan';
}

/**
 * A plan change moves times on several rows. Every wall is told; its view key decides: the plan
 * screen holds the whole timetable (full frame on any change) and the home screen's plan button
 * says "asleep since…" (changes only when a timer starts or stops).
 */
function planChanged(): void {
	publish({ type: 'change', memberId: null, reason: 'planner' });
	void hub().repainter.notify([]);
}

/** The plan date of an occurrence step (for HH:MM times). */
function stepDate(db: DB, occurrenceStepId: number): string | null {
	return (
		db
			.select({ date: occurrence.localDate })
			.from(occurrenceStep)
			.innerJoin(occurrence, eq(occurrence.id, occurrenceStep.occurrenceId))
			.where(eq(occurrenceStep.id, occurrenceStepId))
			.get()?.date ?? null
	);
}

/** When a timer was started or stopped: now, N minutes ago, or a clock time on the plan's date. */
export function whenFrom(db: DB, occurrenceStepId: number, w: { ago?: number; time?: string }, now = new Date()): Date | null {
	if (w.time) {
		const date = stepDate(db, occurrenceStepId);
		return date ? new Date(localToIso(date, w.time, env().TZ_HOUSEHOLD)) : null;
	}
	return new Date(now.getTime() - (w.ago ?? 0) * 60_000);
}

/** Start / stop / undo-stop a plan timer step, or correct its stop time. Returns an error message or null. */
export function timerFromPlanner(
	db: DB,
	op: 'start' | 'stop' | 'unstop' | 'end',
	stepId: number,
	w: { ago?: number; time?: string },
	now = new Date()
): string | null {
	let res;
	if (op === 'unstop') res = unstopTimer(db, stepId, now);
	else if (op === 'end') {
		const date = stepDate(db, stepId);
		res = date && w.time ? retimeEnd(db, stepId, date, w.time, env().TZ_HOUSEHOLD, now) : { ok: false as const, reason: 'Pick a time' };
	} else {
		const at = whenFrom(db, stepId, w, now);
		if (!at) return 'No such step';
		res = op === 'start' ? startTimer(db, stepId, at, now) : stopTimer(db, stepId, at, now);
	}
	if (!res.ok) return res.reason;
	planChanged();
	return null;
}

/** Correct when a ticked plan step happened ("she woke at 10:40"). */
export function retimeFromPlanner(db: DB, stepId: number, time: string, now = new Date()): boolean {
	if (!isPlanStep(db, stepId)) return false;
	const occ = db
		.select({ date: occurrence.localDate })
		.from(occurrenceStep)
		.innerJoin(occurrence, eq(occurrence.id, occurrenceStep.occurrenceId))
		.where(eq(occurrenceStep.id, stepId))
		.get();
	if (!occ || !retimeStep(db, stepId, occ.date, time, env().TZ_HOUSEHOLD, now)) return false;
	planChanged();
	return true;
}

export function memberDetail(db: DB, id: number) {
	const m = db.select().from(member).where(eq(member.id, id)).get();
	if (!m) return null;
	const pattern = db.select().from(weeklyPattern).where(eq(weeklyPattern.memberId, id)).all();
	const templates = db.select().from(routineTemplate).where(eq(routineTemplate.memberId, id)).orderBy(asc(routineTemplate.windowStart)).all();
	return { member: m, pattern: Object.fromEntries(pattern.map((p) => [p.weekday, p.dayTypeId])) as Record<number, number>, templates };
}

/** Set (or clear, with null) one weekday of a member's weekly pattern. */
export function setPatternDay(db: DB, memberId: number, weekday: number, dayTypeId: number | null): void {
	db.delete(weeklyPattern).where(and(eq(weeklyPattern.memberId, memberId), eq(weeklyPattern.weekday, weekday))).run();
	if (dayTypeId !== null) db.insert(weeklyPattern).values({ memberId, weekday, dayTypeId }).run();
}

/** Schedule page: every child's week, and per routine the steps that depend on the day type. */
export function scheduleOverview(db: DB) {
	const kids = members(db).filter((m) => m.active && m.kind === 'child');
	return kids.map((m) => {
		const detail = memberDetail(db, m.id)!;
		const routines = detail.templates.map((t) => ({
			template: t,
			filtered: db
				.select()
				.from(routineStep)
				.where(and(eq(routineStep.templateId, t.id), eq(routineStep.active, true)))
				.orderBy(asc(routineStep.sort), asc(routineStep.id))
				.all()
				.filter((s) => s.dayTypeIdsJson !== null)
				.map((s) => ({ id: s.id, title: s.title, icon: s.icon, dayTypeIds: parseDayTypeIds(s.dayTypeIdsJson) ?? [] }))
		}));
		return { member: m, pattern: detail.pattern, routines };
	});
}

/** Active-step count per day type, so the Schedule page can say what each type is used for. */
export function stepCountsByDayType(db: DB): Record<number, number> {
	const out: Record<number, number> = {};
	for (const s of db.select().from(routineStep).where(eq(routineStep.active, true)).all()) {
		for (const id of parseDayTypeIds(s.dayTypeIdsJson) ?? []) out[id] = (out[id] ?? 0) + 1;
	}
	return out;
}

export function templateDetail(db: DB, id: number) {
	const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, id)).get();
	if (!t) return null;
	const steps = db.select().from(routineStep).where(and(eq(routineStep.templateId, id), isNull(routineStep.deletedAt))).orderBy(asc(routineStep.sort), asc(routineStep.id)).all();
	const m = db.select().from(member).where(eq(member.id, t.memberId)).get()!;
	return { template: t, steps, member: m };
}

/** Move a step up or down by swapping sort values (renumbers first so sorts are dense). */
export function moveStep(db: DB, stepId: number, dir: -1 | 1): void {
	const step = db.select().from(routineStep).where(eq(routineStep.id, stepId)).get();
	if (!step) return;
	db.transaction((tx) => {
		const list = tx.select().from(routineStep).where(and(eq(routineStep.templateId, step.templateId), isNull(routineStep.deletedAt))).orderBy(asc(routineStep.sort), asc(routineStep.id)).all();
		const i = list.findIndex((s) => s.id === stepId);
		const j = i + dir;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		list.forEach((s, sort) => tx.update(routineStep).set({ sort }).where(eq(routineStep.id, s.id)).run());
	});
}

export function devices(db: DB) {
	return db
		.select()
		.from(device)
		.orderBy(asc(device.id))
		.all()
		.map((d) => {
			const settings = JSON.parse(d.settingsJson) as { tesseraePageId?: string; page?: string; sim?: boolean };
			return { ...d, settings, removable: d.id !== DIRECT_SIM_DEVICE && !settings.sim };
		});
}

/**
 * Remove a retired wall (audit L10): its token stops working and its served frames go. The
 * simulator's devices are recreated on start, so they stay. False when there is no such device.
 */
export function removeDevice(db: DB, id: string): boolean {
	const d = db.select().from(device).where(eq(device.id, id)).get();
	if (!d || !devices(db).find((x) => x.id === id)?.removable) return false;
	db.transaction((tx) => {
		tx.delete(servedSnapshot).where(eq(servedSnapshot.deviceId, id)).run();
		tx.delete(device).where(eq(device.id, id)).run();
	});
	return true;
}

/** Form action shared by the Schedule and member pages: set one weekday of the weekly pattern. */
export async function patternDayAction({ request }: { request: Request }) {
	const p = parseForm(patternDayForm, await request.formData());
	if (!p.success) return fail(400, { errors: { pattern: 'Bad day type' } });
	setPatternDay(db(), p.data.memberId, p.data.weekday, p.data.dayTypeId === '' ? null : p.data.dayTypeId);
	changed(p.data.memberId, [], false);
	return { saved: 'Week saved. It applies from the next day that has not started.' };
}
