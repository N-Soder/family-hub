import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { todayBoard, toggleFromPlanner } from '$lib/server/planner';
import { parseForm, stepToggleForm } from '$lib/server/forms';
import { env } from '$lib/server/env';

// Kid view: a full-screen page for a tablet the children use to tick their own routines.
// Same data and toggle as the Routines tab; no editing, no day-type changes, no babies.
export const load: PageServerLoad = () => {
	const now = new Date();
	const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: env().TZ_HOUSEHOLD }).format(now);
	const board = todayBoard(db(), now).filter((b) => b.member.kind === 'child');
	return {
		kids: board.map((b) => {
			const routines = b.routines.map((r) => ({
				id: r.occurrence.id,
				name: r.template.name,
				start: r.template.windowStart,
				running: r.running,
				steps: r.steps.map((s) => ({ id: s.id, title: s.titleSnapshot, icon: s.iconSnapshot, done: Boolean(s.completedAt) }))
			}));
			// Open on the routine on the wall now, else the next one today, else the last one.
			const pick = routines.find((r) => r.running) ?? routines.find((r) => r.start > hhmm) ?? routines.at(-1) ?? null;
			return {
				id: b.member.id,
				name: b.member.name,
				icon: b.member.icon,
				picture: b.member.displayMode === 'picture',
				routines,
				defaultRoutine: pick?.id ?? null
			};
		})
	};
};

export const actions: Actions = {
	toggle: async ({ request }) => {
		const p = parseForm(stepToggleForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Bad step' });
		if (!toggleFromPlanner(db(), p.data.stepId, p.data.done)) return fail(400, { error: 'That step is gone. Reload the page.' });
		return { ok: true };
	}
};
