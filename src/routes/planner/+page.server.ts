import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import { hhmm } from '$lib/server/domain/time';
import { homeView } from '$lib/server/domain/home';
import { tapItem, timerFromPlanner, toggleFromPlanner } from '$lib/server/planner';
import { itemIdForm, parseForm, stepToggleForm, timerForm } from '$lib/server/forms';

// Home (ADR-38): the day at a glance, the page the app opens on. Ticks and the baby's timer
// only; everything else opens its own tab.
export const load: PageServerLoad = () => ({
	home: homeView(db(), { dir: env().CALENDAR_DIR, tz: env().TZ_HOUSEHOLD, rollover: hhmm(env().DAY_ROLLOVER) })
});

export const actions: Actions = {
	/** A child's routine step or a baby's plan step, ticked or unticked. */
	step: async ({ request }) => {
		const p = parseForm(stepToggleForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad step' });
		if (!toggleFromPlanner(db(), p.data.stepId, p.data.done)) return fail(400, { error: 'That step is gone. Reload the page.' });
	},
	/** A To do row: done ↔ open; a repeating job is done for this time. */
	item: async ({ request }) => {
		const p = parseForm(itemIdForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad item' });
		if (!tapItem(db(), p.data.itemId, 'planner')) return fail(400, { error: 'That item has gone. Reload the page.' });
	},
	/** The baby's timer step (a nap): start or stop, now. Times in the past are set on Routines. */
	timer: async ({ request }) => {
		const p = parseForm(timerForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad timer' });
		const err = timerFromPlanner(db(), p.data.op, p.data.stepId, { ago: p.data.ago, time: p.data.time });
		if (err) return fail(400, { error: err });
	}
};
