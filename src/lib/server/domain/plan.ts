import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { completionEvent, member, occurrenceStep, routineStep, routineTemplate } from '../db/schema';
import { getOrCreateOccurrence, occurrenceSteps, type Template } from './routines';
import { addDays, hhmm, localParts, DEFAULT_TZ } from './time';

// A baby's day plan (SPEC §12.3): a timetable whose times follow when things actually happened.
// Each step is due at a clock time, or N minutes after an earlier step. A ticked step's time is
// when it was ticked; a step due after an un-ticked step is an estimate. Nothing is stored:
// times are worked out on every read, so unticking or correcting a time never leaves stale values.
// A timer step ("Sleep") is started and stopped instead of ticked; steps after it follow its stop
// (or, while it runs or before it starts, its start plus how long it usually lasts, as an estimate).

export interface PlanStepIn {
	stepId: number;
	completedAt: string | null; // ISO
	dueAt: string | null; // HH:MM
	dueAfterStepId: number | null;
	dueAfterMin: number | null;
	timer?: boolean;
	usualMin?: number | null;
	endedAt?: string | null; // ISO, timer steps
}

export interface PlanTime {
	/** Minutes after local midnight of the plan's date (can pass 24 h), or null when unknown. A timer step: its start. */
	minutes: number | null;
	/** True when the time hangs off a step not ticked yet. */
	estimate: boolean;
	/** Ticked (a timer step: started). */
	done: boolean;
	/** A timer step that has started and not stopped. */
	running: boolean;
	/** A timer step's stop, once stopped. */
	end: number | null;
	/** The time later steps count from: the stop of a timer step, else this step's time. */
	follow: { minutes: number | null; estimate: boolean };
}

/** Minutes after midnight of `date` (local) at `iso`; days after `date` add 24 h each. */
export function minutesOn(date: string, iso: string, tz = DEFAULT_TZ): number {
	const p = localParts(new Date(iso), tz);
	let days = 0;
	if (p.date > date) while (addDays(date, days) < p.date && days < 3) days++;
	else if (p.date < date) while (addDays(date, days) > p.date && days > -3) days--;
	return days * 1440 + p.minutes;
}

/**
 * Times for a plan's steps, in order. A step can only hang off an earlier step, so one pass is
 * enough and a bad rule (later step, missing step) can never loop: it falls back to the clock
 * time if it has one, else no time.
 */
export function planTimes(steps: PlanStepIn[], date: string, tz = DEFAULT_TZ): PlanTime[] {
	const seen = new Map<number, PlanTime>();
	return steps.map((s) => {
		let minutes: number | null;
		let estimate = false;
		const done = Boolean(s.completedAt);
		if (s.completedAt) minutes = minutesOn(date, s.completedAt, tz);
		else {
			const anchor = s.dueAfterStepId !== null ? seen.get(s.dueAfterStepId) : undefined;
			if (anchor && anchor.follow.minutes !== null) {
				minutes = anchor.follow.minutes + (s.dueAfterMin ?? 0);
				estimate = anchor.follow.estimate;
			} else minutes = s.dueAt ? hhmm(s.dueAt) : null;
		}
		const timer = Boolean(s.timer);
		const end = timer && done && s.endedAt ? minutesOn(date, s.endedAt, tz) : null;
		let follow: PlanTime['follow'];
		if (!timer) follow = { minutes, estimate: !done };
		else if (end !== null) follow = { minutes: end, estimate: false };
		else if (minutes !== null && s.usualMin) follow = { minutes: minutes + s.usualMin, estimate: true };
		else follow = { minutes: null, estimate: true };
		const t: PlanTime = { minutes, estimate, done, running: timer && done && end === null, end, follow };
		seen.set(s.stepId, t);
		return t;
	});
}

/** The step to do next: the first open step after the last ticked one (skipped steps stay behind). */
export function nextIndex(times: Array<Pick<PlanTime, 'done'>>): number | null {
	let last = -1;
	times.forEach((t, i) => {
		if (t.done) last = i;
	});
	for (let i = last + 1; i < times.length; i++) if (!times[i].done) return i;
	return null;
}

/** Sleep-like steps (moon or bed icon) say "asleep" / "Awake"; any other timer says "on" / "Stop". */
export function isSleepy(icon: string | null): boolean {
	return icon === 'moon' || icon === 'bed';
}

/** A running timer in a few words: "asleep since 9:52 am" or "Tummy time since 9:52 am". */
export function runningLabel(r: { title: string; icon: string | null; time: string | null }): string {
	return `${isSleepy(r.icon) ? 'asleep' : r.title} since ${r.time ?? '…'}`;
}

/** "9:05 am"; past midnight wraps to the next day's clock. */
export function clockLabel(minutes: number): string {
	const m = ((minutes % 1440) + 1440) % 1440;
	const h = Math.floor(m / 60);
	return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The baby's plan in use: their first active plan. */
export function activePlan(db: DB, memberId: number): Template | null {
	return (
		db
			.select()
			.from(routineTemplate)
			.where(and(eq(routineTemplate.memberId, memberId), eq(routineTemplate.kind, 'plan'), eq(routineTemplate.active, true)))
			.orderBy(asc(routineTemplate.id))
			.get() ?? null
	);
}

/** First active baby (the wall's Plan button opens their plan). */
export function firstBaby(db: DB) {
	return (
		db
			.select()
			.from(member)
			.where(and(eq(member.kind, 'baby'), eq(member.active, true)))
			.orderBy(asc(member.sort), asc(member.id))
			.get() ?? null
	);
}

export interface PlanRow {
	id: number; // occurrence step id
	title: string;
	icon: string | null;
	completedAt: string | null;
	completedBy: string | null;
	minutes: number | null;
	time: string | null; // "9:05 am"
	estimate: boolean;
	/** Ticked; a timer step: started and stopped. */
	done: boolean;
	next: boolean;
	/** A timer step (started and stopped, e.g. "Sleep"). */
	timer: boolean;
	/** A timer step that is running now. */
	running: boolean;
	endedAt: string | null;
	endMinutes: number | null;
	endTime: string | null; // "10:40 am"
	/** Stopped timer: how long it ran, in minutes. */
	durationMin: number | null;
	usualMin: number | null;
	/** How the time is worked out, for the phone: "1 h after Milk". */
	rule: string | null;
	/** No time yet because the step it follows has none ("Woke up" with no guess): what it waits for. */
	waiting: string | null;
}

export interface PlanDay {
	template: Template;
	occurrenceId: number;
	date: string;
	rows: PlanRow[];
	next: PlanRow | null;
	/** The timer step running now, if any. */
	running: PlanRow | null;
	/** Minutes of stopped timers today ("Slept 1 h 25 today"). */
	timedMin: number;
}

/** "90" → "1 h 30", "60" → "1 h", "20" → "20 min". */
export function durationLabel(min: number): string {
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	return min % 60 ? `${h} h ${min % 60}` : `${h} h`;
}

export function ruleLabel(s: { dueAt: string | null; dueAfterStepId: number | null; dueAfterMin: number | null }, titleOf: (id: number) => string | undefined): string | null {
	if (s.dueAfterStepId !== null) {
		const t = titleOf(s.dueAfterStepId);
		if (t) return s.dueAfterMin ? `${durationLabel(s.dueAfterMin)} after ${t}` : `after ${t}`;
	}
	return s.dueAt ? `at ${clockLabel(hhmm(s.dueAt))}` : null;
}

/** The plan's day for `date`: its steps with times and the next one. Creates the day on first read. */
export function planDay(db: DB, template: Template, date: string, now = new Date(), tz = DEFAULT_TZ): PlanDay {
	const occ = getOrCreateOccurrence(db, template, date, now);
	const occSteps = occurrenceSteps(db, occ.id);
	const rules = new Map(
		db
			.select()
			.from(routineStep)
			.where(eq(routineStep.templateId, template.id))
			.all()
			.map((r) => [r.id, r])
	);
	const inputs: PlanStepIn[] = occSteps.map((s) => {
		const r = rules.get(s.stepId);
		return {
			stepId: s.stepId,
			completedAt: s.completedAt,
			dueAt: r?.dueAt ?? null,
			dueAfterStepId: r?.dueAfterStepId ?? null,
			dueAfterMin: r?.dueAfterMin ?? null,
			timer: r?.timer ?? false,
			usualMin: r?.usualMin ?? null,
			endedAt: s.endedAt
		};
	});
	const times = planTimes(inputs, date, tz);
	const next = nextIndex(times);
	const titleOf = (stepId: number) => occSteps.find((s) => s.stepId === stepId)?.titleSnapshot;
	const rows: PlanRow[] = occSteps.map((s, i) => {
		const t = times[i];
		const timer = Boolean(inputs[i].timer);
		return {
			id: s.id,
			title: s.titleSnapshot,
			icon: s.iconSnapshot,
			completedAt: s.completedAt,
			completedBy: s.completedBy,
			minutes: t.minutes,
			time: t.minutes === null ? null : clockLabel(t.minutes),
			estimate: t.estimate,
			done: timer ? t.end !== null : t.done,
			next: i === next,
			timer,
			running: t.running,
			endedAt: timer ? s.endedAt : null,
			endMinutes: t.end,
			endTime: t.end === null ? null : clockLabel(t.end),
			durationMin: t.end !== null && t.minutes !== null ? Math.max(0, t.end - t.minutes) : null,
			usualMin: inputs[i].usualMin ?? null,
			rule: ruleLabel(inputs[i], titleOf),
			waiting: t.minutes === null && inputs[i].dueAfterStepId !== null ? ruleLabel(inputs[i], titleOf) : null
		};
	});
	return {
		template,
		occurrenceId: occ.id,
		date,
		rows,
		next: next === null ? null : rows[next],
		running: rows.find((r) => r.running) ?? null,
		timedMin: rows.reduce((sum, r) => sum + (r.durationMin ?? 0), 0)
	};
}

/** ISO instant for local `HH:MM` on `date` in `tz` (no DST in Perth; handled generally anyway). */
export function localToIso(date: string, time: string, tz = DEFAULT_TZ): string {
	const want = hhmm(time);
	// Start from the time as if UTC, then correct by the zone's offset at that instant (twice for DST edges).
	let t = Date.parse(`${date}T${time}:00Z`);
	for (let i = 0; i < 2; i++) {
		const p = localParts(new Date(t), tz);
		const got = (p.date === date ? 0 : p.date > date ? 1440 : -1440) + p.minutes;
		t -= (got - want) * 60_000;
	}
	return new Date(t).toISOString();
}

/**
 * Correct when a ticked plan step happened (the Planner's time edit). `time` is HH:MM on the
 * plan's date. Writes a 'retime' history event. Returns false if the step is not ticked.
 */
export function retimeStep(db: DB, occurrenceStepId: number, date: string, time: string, tz = DEFAULT_TZ, now = new Date()): boolean {
	return db.transaction((tx) => {
		const s = tx.select().from(occurrenceStep).where(eq(occurrenceStep.id, occurrenceStepId)).get();
		if (!s || !s.completedAt) return false;
		const at = localToIso(date, time, tz);
		if (s.endedAt && Date.parse(at) > Date.parse(s.endedAt)) return false; // a timer can't start after it stopped
		if (Date.parse(at) > now.getTime() + 60_000) return false;
		tx.update(occurrenceStep).set({ completedAt: at }).where(eq(occurrenceStep.id, s.id)).run();
		tx.insert(completionEvent)
			.values({ occurrenceStepId: s.id, action: 'retime', source: 'planner', eventTs: now.toISOString(), dedupeKey: `retime:${randomUUID()}` })
			.run();
		return true;
	});
}

// ---- Timer steps: start, stop, undo a stop, correct the stop (SPEC §12.3) ----

export type TimerResult = { ok: true } | { ok: false; reason: string };

function planStep(db: DB, occurrenceStepId: number) {
	const s = db.select().from(occurrenceStep).where(eq(occurrenceStep.id, occurrenceStepId)).get();
	if (!s) return null;
	const rule = db.select().from(routineStep).where(eq(routineStep.id, s.stepId)).get();
	return { s, timer: Boolean(rule?.timer) };
}

function event(db: DB, id: number, action: 'complete' | 'uncomplete' | 'retime' | 'stop' | 'unstop' | 'retime_end', now: Date): void {
	db.insert(completionEvent).values({ occurrenceStepId: id, action, source: 'planner', eventTs: now.toISOString(), dedupeKey: `${action}:${randomUUID()}` }).run();
}

/** Start a timer step at `at` (now, or earlier when it was forgotten). Starting a started timer is refused. */
export function startTimer(db: DB, occurrenceStepId: number, at: Date, now = new Date()): TimerResult {
	if (at.getTime() > now.getTime() + 60_000) return { ok: false, reason: 'That time is still to come' };
	return db.transaction((tx) => {
		const p = planStep(tx as unknown as DB, occurrenceStepId);
		if (!p || !p.timer) return { ok: false, reason: 'Not a timer step' } as const;
		if (p.s.completedAt) return { ok: false, reason: 'Already started' } as const;
		tx.update(occurrenceStep).set({ completedAt: at.toISOString(), endedAt: null, completedBy: 'planner' }).where(eq(occurrenceStep.id, occurrenceStepId)).run();
		event(tx as unknown as DB, occurrenceStepId, 'complete', now);
		return { ok: true } as const;
	});
}

/** Stop a running timer at `at` (not before it started, not in the future). */
export function stopTimer(db: DB, occurrenceStepId: number, at: Date, now = new Date()): TimerResult {
	if (at.getTime() > now.getTime() + 60_000) return { ok: false, reason: 'That time is still to come' };
	return db.transaction((tx) => {
		const p = planStep(tx as unknown as DB, occurrenceStepId);
		if (!p || !p.timer) return { ok: false, reason: 'Not a timer step' } as const;
		if (!p.s.completedAt) return { ok: false, reason: 'Not started' } as const;
		if (p.s.endedAt) return { ok: false, reason: 'Already stopped' } as const;
		if (at.getTime() < Date.parse(p.s.completedAt)) return { ok: false, reason: 'That is before it started' } as const;
		tx.update(occurrenceStep).set({ endedAt: at.toISOString() }).where(eq(occurrenceStep.id, occurrenceStepId)).run();
		event(tx as unknown as DB, occurrenceStepId, 'stop', now);
		return { ok: true } as const;
	});
}

/** Undo a stop: the timer runs again from its start. */
export function unstopTimer(db: DB, occurrenceStepId: number, now = new Date()): TimerResult {
	return db.transaction((tx) => {
		const p = planStep(tx as unknown as DB, occurrenceStepId);
		if (!p || !p.timer || !p.s.endedAt) return { ok: false, reason: 'Not stopped' } as const;
		tx.update(occurrenceStep).set({ endedAt: null }).where(eq(occurrenceStep.id, occurrenceStepId)).run();
		event(tx as unknown as DB, occurrenceStepId, 'unstop', now);
		return { ok: true } as const;
	});
}

/** Correct a stopped timer's stop time (HH:MM on the plan's date). */
export function retimeEnd(db: DB, occurrenceStepId: number, date: string, time: string, tz = DEFAULT_TZ, now = new Date()): TimerResult {
	return db.transaction((tx) => {
		const p = planStep(tx as unknown as DB, occurrenceStepId);
		if (!p || !p.timer || !p.s.completedAt || !p.s.endedAt) return { ok: false, reason: 'Not stopped' } as const;
		const at = localToIso(date, time, tz);
		if (Date.parse(at) < Date.parse(p.s.completedAt)) return { ok: false, reason: 'That is before it started' } as const;
		if (Date.parse(at) > now.getTime() + 60_000) return { ok: false, reason: 'That time is still to come' } as const;
		tx.update(occurrenceStep).set({ endedAt: at }).where(eq(occurrenceStep.id, occurrenceStepId)).run();
		event(tx as unknown as DB, occurrenceStepId, 'retime_end', now);
		return { ok: true } as const;
	});
}
