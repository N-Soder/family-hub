import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { dayTypes, regenerateToday, retimeFromPlanner, setOverride, syncCalendarDays, timerFromPlanner, today, todayBoard, toggleFromPlanner } from '$lib/server/planner';
import { overrideForm, parseForm, retimeForm, stepToggleForm, timerForm } from '$lib/server/forms';
import { env } from '$lib/server/env';

// Routines tab: today's routines per child, tick from the phone. The calendar has its own tab.
export const load: PageServerLoad = () => {
	const now = new Date();
	const tz = env().TZ_HOUSEHOLD;
	return {
		board: todayBoard(db(), now),
		dayTypes: dayTypes(db()),
		dateLabel: new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now)
	};
};

export const actions: Actions = {
	toggle: async ({ request }) => {
		const p = parseForm(stepToggleForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad step' });
		if (!toggleFromPlanner(db(), p.data.stepId, p.data.done)) return fail(400, { error: 'That step is gone. Reload the page.' });
	},
	/** A baby's plan: correct when a ticked step happened. */
	retime: async ({ request }) => {
		const p = parseForm(retimeForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Pick a time' });
		if (!retimeFromPlanner(db(), p.data.stepId, p.data.time)) return fail(400, { error: 'That time doesn’t fit (still to come, or after it stopped)' });
		return { notice: 'Time changed. Later times have moved.' };
	},
	/** A baby's plan timer step (e.g. Sleep): start, stop, undo a stop, correct the stop. */
	timer: async ({ request }) => {
		const p = parseForm(timerForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Pick a time' });
		const err = timerFromPlanner(db(), p.data.op, p.data.stepId, { ago: p.data.ago, time: p.data.time });
		if (err) return fail(400, { error: err });
		return { timer: p.data.op, stepId: p.data.stepId };
	},
	override: async ({ request }) => {
		const p = parseForm(overrideForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad day type' });
		setOverride(db(), p.data.memberId, today(), p.data.dayTypeId === '' ? null : p.data.dayTypeId);
		// Clearing a pick puts the calendar's day type back (ADR-29) before today is regenerated.
		if (p.data.dayTypeId === '') syncCalendarDays(db());
		// An adult's explicit pick applies at once (ADR-21); ticked steps are kept.
		regenerateToday(db(), p.data.memberId);
		return { notice: 'Today updated. Ticked steps are kept.' };
	}
};
