import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { member, routineTemplate } from '$lib/server/db/schema';
import { dayTypes, memberDetail, patternDayAction, today, changed, shortLabelTakenBy } from '$lib/server/planner';
import { weekdayOf } from '$lib/server/domain/time';
import { fieldErrors, memberForm, parseForm, planForm, templateForm } from '$lib/server/forms';

export const load: PageServerLoad = ({ params }) => {
	const detail = memberDetail(db(), Number(params.id));
	if (!detail) error(404, 'No such member');
	return { ...detail, dayTypes: dayTypes(db()), todayWeekday: weekdayOf(today()) };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const p = parseForm(memberForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		const taken = shortLabelTakenBy(db(), p.data.shortLabel, Number(params.id));
		if (taken) return fail(400, { errors: { shortLabel: `${taken} already has “${p.data.shortLabel}”; labels must differ on the wall` } });
		db().update(member).set(p.data).where(eq(member.id, Number(params.id))).run();
		changed(Number(params.id), [], true); // mode or label may change the wall layout
		return { saved: 'Member saved.' };
	},
	patternDay: patternDayAction,
	addTemplate: async ({ request, params }) => {
		const p = parseForm(templateForm, await request.formData(), ['days']);
		if (!p.success) return fail(400, { templateErrors: fieldErrors(p.error) });
		const t = db()
			.insert(routineTemplate)
			.values({ ...p.data, memberId: Number(params.id) })
			.returning()
			.get();
		redirect(303, `/planner/routines/${t.id}`);
	},
	/** A baby's day plan: a template of kind 'plan' (its window and days are not used). */
	addPlan: async ({ request, params }) => {
		const p = parseForm(planForm, await request.formData());
		if (!p.success) return fail(400, { templateErrors: fieldErrors(p.error) });
		const t = db()
			.insert(routineTemplate)
			.values({ name: p.data.name, active: true, kind: 'plan', windowStart: '00:00', windowEnd: '23:59', memberId: Number(params.id) })
			.returning()
			.get();
		changed(Number(params.id), [], true);
		redirect(303, `/planner/routines/${t.id}`);
	}
};
