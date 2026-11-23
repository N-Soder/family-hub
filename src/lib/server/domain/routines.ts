import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { DB } from '../db';
import {
	dayOverride,
	dayType,
	occurrence,
	occurrenceStep,
	routineStep,
	routineTemplate,
	weeklyPattern,
	completionEvent
} from '../db/schema';
import { weekdayOf } from './time';

export type Template = typeof routineTemplate.$inferSelect;
export type Occurrence = typeof occurrence.$inferSelect;
export type OccStep = typeof occurrenceStep.$inferSelect;

/** Day type for (member, date): admin override → calendar override → weekly pattern. */
export function resolveDayType(db: DB, memberId: number, date: string): number | null {
	const overrides = db
		.select()
		.from(dayOverride)
		.where(and(eq(dayOverride.memberId, memberId), eq(dayOverride.localDate, date)))
		.all();
	// PK is (member, date) so at most one row; source order kept explicit for Stage 2.
	const admin = overrides.find((o) => o.source === 'admin');
	if (admin) return admin.dayTypeId;
	const cal = overrides.find((o) => o.source === 'calendar');
	if (cal) return cal.dayTypeId;
	const pattern = db
		.select()
		.from(weeklyPattern)
		.where(and(eq(weeklyPattern.memberId, memberId), eq(weeklyPattern.weekday, weekdayOf(date))))
		.get();
	return pattern?.dayTypeId ?? null;
}

export function parseDayTypeIds(json: string | null): number[] | null {
	if (json === null) return null;
	const parsed: unknown = JSON.parse(json);
	return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : null;
}

/** A step with no filter appears every day; a filtered step only on its day types. */
export function stepApplies(dayTypeIdsJson: string | null, dayTypeId: number | null): boolean {
	const ids = parseDayTypeIds(dayTypeIdsJson);
	if (ids === null) return true;
	return dayTypeId !== null && ids.includes(dayTypeId);
}

function applicableSteps(db: DB, templateId: number, dayTypeId: number | null) {
	return db
		.select()
		.from(routineStep)
		.where(and(eq(routineStep.templateId, templateId), eq(routineStep.active, true), isNull(routineStep.deletedAt)))
		.orderBy(asc(routineStep.sort), asc(routineStep.id))
		.all()
		.filter((s) => stepApplies(s.dayTypeIdsJson, dayTypeId));
}

/**
 * The occurrence for (template, date), generated on first read. Day type is
 * resolved and stored now, so later overrides do not rewrite a started day.
 * Idempotent: repeated or concurrent calls return the same row.
 */
export function getOrCreateOccurrence(db: DB, template: Template, date: string, now = new Date()): Occurrence {
	const existing = db
		.select()
		.from(occurrence)
		.where(and(eq(occurrence.templateId, template.id), eq(occurrence.localDate, date)))
		.get();
	if (existing) return existing;
	return db.transaction((tx) => {
		const dayTypeId = resolveDayType(tx as unknown as DB, template.memberId, date);
		const inserted = tx
			.insert(occurrence)
			.values({ templateId: template.id, localDate: date, dayTypeId, generatedAt: now.toISOString() })
			.onConflictDoNothing()
			.returning()
			.get();
		if (!inserted) {
			return tx
				.select()
				.from(occurrence)
				.where(and(eq(occurrence.templateId, template.id), eq(occurrence.localDate, date)))
				.get()!;
		}
		const steps = applicableSteps(tx as unknown as DB, template.id, dayTypeId);
		if (steps.length) {
			tx.insert(occurrenceStep)
				.values(
					steps.map((s, i) => ({
						occurrenceId: inserted.id,
						stepId: s.id,
						titleSnapshot: s.title,
						iconSnapshot: s.icon,
						sortSnapshot: i
					}))
				)
				.run();
		}
		return inserted;
	});
}

export function occurrenceSteps(db: DB, occurrenceId: number): OccStep[] {
	return db
		.select()
		.from(occurrenceStep)
		.where(eq(occurrenceStep.occurrenceId, occurrenceId))
		.orderBy(asc(occurrenceStep.sortSnapshot), asc(occurrenceStep.id))
		.all();
}

/**
 * "Regenerate today": re-resolve the day type and bring the step list in line
 * with the current template. Completed steps and steps with history are kept;
 * untouched steps that no longer apply are removed; new ones are appended.
 * The occurrence row itself is never deleted. `keepDayType` syncs steps only (step edits in
 * the Planner), leaving the day type the occurrence started with.
 */
export function regenerateOccurrence(db: DB, occ: Occurrence, template: Template, opts: { keepDayType?: boolean } = {}): Occurrence {
	return db.transaction((tx) => {
		const t = tx as unknown as DB;
		const dayTypeId = opts.keepDayType ? occ.dayTypeId : resolveDayType(t, template.memberId, occ.localDate);
		if (!opts.keepDayType) tx.update(occurrence).set({ dayTypeId }).where(eq(occurrence.id, occ.id)).run();
		const wanted = applicableSteps(t, template.id, dayTypeId);
		const wantedIds = new Set(wanted.map((s) => s.id));
		const current = occurrenceSteps(t, occ.id);
		const withHistory = new Set(
			current.length
				? tx
						.select({ id: completionEvent.occurrenceStepId })
						.from(completionEvent)
						.where(inArray(completionEvent.occurrenceStepId, current.map((c) => c.id)))
						.all()
						.map((r) => r.id)
				: []
		);
		for (const c of current) {
			if (!wantedIds.has(c.stepId) && !c.completedAt && !withHistory.has(c.id)) {
				tx.delete(occurrenceStep).where(eq(occurrenceStep.id, c.id)).run();
			}
		}
		const kept = new Map(occurrenceSteps(t, occ.id).map((c) => [c.stepId, c]));
		wanted.forEach((s, i) => {
			const row = kept.get(s.id);
			if (row) {
				tx.update(occurrenceStep)
					.set({ titleSnapshot: s.title, iconSnapshot: s.icon, sortSnapshot: i })
					.where(eq(occurrenceStep.id, row.id))
					.run();
			} else {
				tx.insert(occurrenceStep)
					.values({ occurrenceId: occ.id, stepId: s.id, titleSnapshot: s.title, iconSnapshot: s.icon, sortSnapshot: i })
					.run();
			}
		});
		// Steps kept only because of history sort after the current list.
		let tail = wanted.length;
		for (const c of occurrenceSteps(t, occ.id)) {
			if (!wantedIds.has(c.stepId)) {
				tx.update(occurrenceStep).set({ sortSnapshot: tail++ }).where(eq(occurrenceStep.id, c.id)).run();
			}
		}
		return tx.select().from(occurrence).where(eq(occurrence.id, occ.id)).get()!;
	});
}

/** A member's active routines (a baby's plans are not routines: see plan.ts). */
export function templatesForMember(db: DB, memberId: number): Template[] {
	return db
		.select()
		.from(routineTemplate)
		.where(and(eq(routineTemplate.memberId, memberId), eq(routineTemplate.active, true), ne(routineTemplate.kind, 'plan')))
		.orderBy(asc(routineTemplate.windowStart))
		.all();
}

export function dayTypeById(db: DB, id: number | null) {
	if (id === null) return null;
	return db.select().from(dayType).where(eq(dayType.id, id)).get() ?? null;
}


/**
 * Delete a step from its routine. A step that was never put on a day is removed; one that was
 * is marked deleted (hidden from the Planner and future days) so past days keep their record.
 * Returns the step's template id, or null if there was no such step.
 */
export function deleteStep(db: DB, stepId: number, now = new Date()): number | null {
	const step = db.select().from(routineStep).where(eq(routineStep.id, stepId)).get();
	if (!step) return null;
	const used = db.select({ id: occurrenceStep.id }).from(occurrenceStep).where(eq(occurrenceStep.stepId, stepId)).get();
	if (used) db.update(routineStep).set({ deletedAt: now.toISOString(), active: false }).where(eq(routineStep.id, stepId)).run();
	else db.delete(routineStep).where(eq(routineStep.id, stepId)).run();
	return step.templateId;
}
