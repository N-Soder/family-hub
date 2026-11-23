import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { DB } from '../db';
import { completionEvent, listItem, occurrenceStep } from '../db/schema';
import { isStepSlot, latestSnapshot, parseRegion, parseTouchId, routinesHoldUntil, slotKey } from './render';
import { completeRepeating, recentDone, removeLog, repeatOf, setItemDone, WALL_TICK_GRACE_MS } from './lists';
import { wallScreens, type Screen, type WallScreens } from './screens';

export const DEDUPE_MS = 4000;

export type TapResult =
	| { status: 200; applied: true; step: number; state: 'done' | 'todo' }
	| { status: 200; applied: false; reason: 'empty_slot' | 'deduped'; step?: number; state?: 'done' | 'todo' }
	| { status: 409; applied: false; reason: 'no_snapshot' | 'stale_region' };

export interface TapInput {
	deviceId: string;
	page: string;
	slot: number;
	regionId?: string | null; // from Tesserae's webhook body, when present
	now?: Date;
	source?: 'wall' | 'board';
}

function dedupeKey(parts: (string | number)[]): string {
	return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Toggle the step a wall slot showed. Applied against the last snapshot served
 * to (device, page). The same step tapped again from the same device within
 * 4 s is ignored, so a double tap never reverts (ADR-14).
 */
export function applyTap(db: DB, input: TapInput): TapResult {
	const now = input.now ?? new Date();
	const snap = latestSnapshot(db, input.deviceId, input.page);
	if (!snap) return { status: 409, applied: false, reason: 'no_snapshot' };
	const entry = snap.slots.filter(isStepSlot).find((s) => s.slot === input.slot);
	if (input.regionId) {
		const region = parseTouchId(input.regionId);
		if (region && (region.slot !== input.slot || (entry && region.occurrenceId !== entry.occurrenceId))) {
			return { status: 409, applied: false, reason: 'stale_region' };
		}
	}
	if (!entry) return { status: 200, applied: false, reason: 'empty_slot' };

	return db.transaction((tx) => {
		const step = tx.select().from(occurrenceStep).where(eq(occurrenceStep.id, entry.occurrenceStepId)).get();
		if (!step) return { status: 200, applied: false, reason: 'empty_slot' } as const;
		const since = new Date(now.getTime() - DEDUPE_MS).toISOString();
		const recent = tx
			.select()
			.from(completionEvent)
			.where(
				and(
					eq(completionEvent.occurrenceStepId, step.id),
					eq(completionEvent.deviceId, input.deviceId),
					gt(completionEvent.eventTs, since)
				)
			)
			.orderBy(desc(completionEvent.id))
			.get();
		const currentState = step.completedAt ? 'done' : 'todo';
		if (recent) return { status: 200, applied: false, reason: 'deduped', step: step.id, state: currentState } as const;

		const action = step.completedAt ? 'uncomplete' : 'complete';
		const key = dedupeKey([input.deviceId, input.page, input.slot, step.id, Math.floor(now.getTime() / DEDUPE_MS)]);
		const inserted = tx
			.insert(completionEvent)
			.values({
				occurrenceStepId: step.id,
				action,
				source: input.source ?? 'wall',
				deviceId: input.deviceId,
				snapshotId: snap.id,
				slot: input.slot,
				eventTs: now.toISOString(),
				dedupeKey: key
			})
			.onConflictDoNothing()
			.returning({ id: completionEvent.id })
			.get();
		if (!inserted) return { status: 200, applied: false, reason: 'deduped', step: step.id, state: currentState } as const;
		tx.update(occurrenceStep)
			.set(
				action === 'complete'
					? { completedAt: now.toISOString(), completedBy: input.source ?? 'wall' }
					: { completedAt: null, completedBy: null }
			)
			.where(eq(occurrenceStep.id, step.id))
			.run();
		return { status: 200, applied: true, step: step.id, state: action === 'complete' ? 'done' : 'todo' } as const;
	});
}

/** Explicit set from the Planner (no dedupe window; no-op if already in that state). */
export function setStepState(
	db: DB,
	occurrenceStepId: number,
	done: boolean,
	source: 'planner' | 'board' | 'api' = 'planner',
	now = new Date()
): { changed: boolean } {
	return db.transaction((tx) => {
		const step = tx.select().from(occurrenceStep).where(eq(occurrenceStep.id, occurrenceStepId)).get();
		if (!step) throw new Error('unknown step');
		if (Boolean(step.completedAt) === done) return { changed: false };
		tx.insert(completionEvent)
			.values({
				occurrenceStepId,
				action: done ? 'complete' : 'uncomplete',
				source,
				eventTs: now.toISOString(),
				dedupeKey: `${source}:${randomUUID()}`
			})
			.run();
		tx.update(occurrenceStep)
			.set(done ? { completedAt: now.toISOString(), completedBy: source } : { completedAt: null, endedAt: null, completedBy: null })
			.where(eq(occurrenceStep.id, occurrenceStepId))
			.run();
		return { changed: true };
	});
}

// ---- Every wall tap: routine steps, list items and the Lists / Back button ----

export type WallTapResult =
	| TapResult
	| { status: 200; applied: true; item: number; state: 'done' | 'todo' }
	| { status: 200; applied: false; reason: 'deduped' | 'empty_slot'; item: number; state?: 'done' | 'todo' }
	| { status: 200; applied: true; screen: Screen };

/** Recent wall ticks per (device, item), for the same 4 s double-tap window as routine steps. */
const recentItemTaps = new Map<string, number>();

/**
 * Apply a wall tap against the last frame served to (device, page). The region id names what
 * the tapped row showed, so a tap made on a frame that has since changed is refused.
 */
export function applyWallTap(db: DB, input: TapInput, screens: WallScreens = wallScreens): WallTapResult {
	const now = input.now ?? new Date();
	const snap = latestSnapshot(db, input.deviceId, input.page);
	if (!snap) return { status: 409, applied: false, reason: 'no_snapshot' };
	const entry = snap.slots.find((s) => s.slot === input.slot);
	if (input.regionId) {
		const region = parseRegion(input.regionId);
		if (region && (region.slot !== input.slot || (entry && region.key !== slotKey(entry)))) {
			return { status: 409, applied: false, reason: 'stale_region' };
		}
	}
	if (!entry) return { status: 200, applied: false, reason: 'empty_slot' };
	if (entry.kind === 'nav') {
		const hold = entry.to === 'routines' ? routinesHoldUntil(db, now) : 0;
		screens.set(input.deviceId, entry.to, now, entry.member ?? null, hold);
		return { status: 200, applied: true, screen: entry.to };
	}
	if (entry.kind === 'item') {
		screens.touch(input.deviceId, now);
		const item = db.select().from(listItem).where(eq(listItem.id, entry.itemId)).get();
		if (!item) return { status: 200, applied: false, reason: 'empty_slot', item: entry.itemId };
		// A repeating item is "done" on the wall for the couple of minutes after it was done.
		const repeating = repeatOf(item) !== null;
		const recent = repeating ? recentDone(db, item.id, now, WALL_TICK_GRACE_MS) : null;
		const state = item.doneAt || recent ? 'done' : 'todo';
		const key = `${input.deviceId}|${item.id}`;
		const last = recentItemTaps.get(key);
		if (last !== undefined && now.getTime() - last < DEDUPE_MS && now.getTime() >= last) {
			return { status: 200, applied: false, reason: 'deduped', item: item.id, state };
		}
		recentItemTaps.set(key, now.getTime());
		if (recentItemTaps.size > 500) recentItemTaps.delete(recentItemTaps.keys().next().value!);
		if (repeating) {
			if (recent) removeLog(db, recent.id);
			else completeRepeating(db, item.id, { source: 'wall', now });
			return { status: 200, applied: true, item: item.id, state: recent ? 'todo' : 'done' };
		}
		setItemDone(db, item.id, !item.doneAt, 'wall', now, { keepPlace: true });
		return { status: 200, applied: true, item: item.id, state: item.doneAt ? 'todo' : 'done' };
	}
	screens.touch(input.deviceId, now, routinesHoldUntil(db, now)); // a tick on the routines screen keeps it open
	return applyTap(db, input);
}

/** Forget the item double-tap window (tests). */
export function resetItemTaps(): void {
	recentItemTaps.clear();
}
