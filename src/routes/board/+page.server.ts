import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import { hhmm } from '$lib/server/domain/time';
import { boardView } from '$lib/server/domain/board';
import { setStepState } from '$lib/server/domain/toggle';
import { changed, tapItem } from '$lib/server/planner';
import { itemIdForm, parseForm, stepToggleForm } from '$lib/server/forms';

// The Board (ADR-30): a paired screen or a signed-in adult. Ticks only; nothing is created here.
export const load: PageServerLoad = ({ locals }) => ({
	board: boardView(db(), { dir: env().CALENDAR_DIR, tz: env().TZ_HOUSEHOLD, rollover: hhmm(env().DAY_ROLLOVER) }),
	screen: locals.board
});

export const actions: Actions = {
	step: async ({ request }) => {
		const p = parseForm(stepToggleForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad step' });
		if (setStepState(db(), p.data.stepId, p.data.done, 'board').changed) changed(null, [p.data.stepId]);
		return { ok: true };
	},
	/** Tap a list row: done ↔ open; a repeating job is done for this time (tap again soon to undo). */
	item: async ({ request }) => {
		const p = parseForm(itemIdForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad item' });
		if (!tapItem(db(), p.data.itemId, 'board')) return fail(400, { error: 'That item has gone' });
		return { ok: true };
	}
};
