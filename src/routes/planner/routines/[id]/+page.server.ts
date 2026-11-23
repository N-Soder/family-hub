import { error, fail } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { routineStep, routineTemplate } from '$lib/server/db/schema';
import { dayTypes, moveStep, templateDetail, changed, syncTemplateToday } from '$lib/server/planner';
import { deleteStep } from '$lib/server/domain/routines';
import { fieldErrors, parseForm, planForm, stepForm, stepTimerForm, stepWhenForm, templateForm } from '$lib/server/forms';

export const load: PageServerLoad = ({ params }) => {
	const detail = templateDetail(db(), Number(params.id));
	if (!detail) error(404, 'No such routine');
	return { ...detail, dayTypes: dayTypes(db()) };
};

const stepId = z.object({ stepId: z.coerce.number().int().positive() });

function stepValues(d: z.infer<typeof stepForm>) {
	return { title: d.title, icon: d.icon, active: d.active, dayTypeIdsJson: d.dayTypes.length ? JSON.stringify(d.dayTypes) : null };
}

/** The posted step id, if it is a live step of the routine in the URL (audit L1). */
function ownStep(form: FormData, templateId: number): number | null {
	const id = parseForm(stepId, form);
	if (!id.success) return null;
	const step = db().select().from(routineStep).where(and(eq(routineStep.id, id.data.stepId), eq(routineStep.templateId, templateId))).get();
	return step && !step.deletedAt ? step.id : null;
}

function isPlan(templateId: number): boolean {
	return db().select().from(routineTemplate).where(eq(routineTemplate.id, templateId)).get()?.kind === 'plan';
}

/**
 * A plan step's "When" (SPEC §12.3). A step can only hang off an earlier step of the same plan
 * (`selfId` is the step being saved; null when adding, where every existing step is earlier).
 * Returns the columns to write, or an error message.
 */
function whenValues(form: FormData, templateId: number, selfId: number | null) {
	const w = parseForm(stepWhenForm, form);
	if (!w.success) return { error: Object.values(fieldErrors(w.error))[0] ?? 'Bad time' };
	if (w.data.dueAfterStepId !== null) {
		const steps = db().select().from(routineStep).where(eq(routineStep.templateId, templateId)).all();
		const anchor = steps.find((s) => s.id === w.data.dueAfterStepId && !s.deletedAt);
		const self = selfId === null ? null : steps.find((s) => s.id === selfId);
		if (selfId !== null && !self) return { error: 'Pick a step that comes earlier in the plan' };
		if (!anchor || anchor.id === selfId || (self && (anchor.sort > self.sort || (anchor.sort === self.sort && anchor.id > self.id)))) {
			return { error: 'Pick a step that comes earlier in the plan' };
		}
	}
	const t = parseForm(stepTimerForm, form);
	if (!t.success) return { error: Object.values(fieldErrors(t.error))[0] ?? 'Bad timer' };
	return { values: { ...w.data, timer: t.data.timer, usualMin: t.data.timer ? t.data.usualMin : null } };
}

export const actions: Actions = {
	save: async ({ request, params }) => {
		const tid = Number(params.id);
		if (isPlan(tid)) {
			const p = parseForm(planForm, await request.formData());
			if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
			const t = db().select().from(routineTemplate).where(eq(routineTemplate.id, tid)).get()!;
			db().update(routineTemplate).set(p.data).where(eq(routineTemplate.id, tid)).run();
			// One plan in use per baby: switching one on switches the others off.
			if (p.data.active) {
				db().update(routineTemplate)
					.set({ active: false })
					.where(and(eq(routineTemplate.memberId, t.memberId), eq(routineTemplate.kind, 'plan'), ne(routineTemplate.id, tid)))
					.run();
			}
			changed(null, [], true);
			return { saved: 'Plan saved.' };
		}
		const p = parseForm(templateForm, await request.formData(), ['days']);
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		db().update(routineTemplate).set(p.data).where(eq(routineTemplate.id, Number(params.id))).run();
		changed(null, [], true); // window changes can switch what the wall shows
		return { saved: 'Routine saved.' };
	},
	addStep: async ({ request, params }) => {
		const form = await request.formData();
		const p = parseForm(stepForm, form, ['dayTypes']);
		if (!p.success) return fail(400, { stepErrors: fieldErrors(p.error) });
		const tid = Number(params.id);
		const when = isPlan(tid) ? whenValues(form, tid, null) : { values: {} };
		if ('error' in when) return fail(400, { stepErrors: { when: when.error } });
		const existing = db().select().from(routineStep).where(eq(routineStep.templateId, tid)).all();
		const sort = existing.reduce((m, s) => Math.max(m, s.sort + 1), existing.length);
		db().insert(routineStep).values({ templateId: tid, sort, ...stepValues(p.data), ...when.values }).run();
		syncTemplateToday(db(), Number(params.id));
		return { saved: 'Step added.' };
	},
	saveStep: async ({ request, params }) => {
		const form = await request.formData();
		const tid = Number(params.id);
		const sid = ownStep(form, tid);
		const p = parseForm(stepForm, form, ['dayTypes']);
		if (sid === null || !p.success) return fail(400, { stepErrors: p.success ? { form: 'Bad step' } : fieldErrors(p.error) });
		const when = isPlan(tid) ? whenValues(form, tid, sid) : { values: {} };
		if ('error' in when) return fail(400, { stepErrors: { when: when.error } });
		db().update(routineStep).set({ ...stepValues(p.data), ...when.values }).where(eq(routineStep.id, sid)).run();
		syncTemplateToday(db(), Number(params.id));
		return { saved: 'Step saved.' };
	},
	up: async ({ request, params }) => {
		const sid = ownStep(await request.formData(), Number(params.id));
		if (sid === null) return fail(400, { stepErrors: { form: 'Bad step' } });
		moveStep(db(), sid, -1);
		syncTemplateToday(db(), Number(params.id));
	},
	down: async ({ request, params }) => {
		const sid = ownStep(await request.formData(), Number(params.id));
		if (sid === null) return fail(400, { stepErrors: { form: 'Bad step' } });
		moveStep(db(), sid, 1);
		syncTemplateToday(db(), Number(params.id));
	},
	delete: async ({ request, params }) => {
		const sid = ownStep(await request.formData(), Number(params.id));
		if (sid === null) return fail(400, { stepErrors: { form: 'Bad step' } });
		deleteStep(db(), sid);
		syncTemplateToday(db(), Number(params.id));
		return { saved: 'Step deleted.' };
	}
};
