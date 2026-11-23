import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { addedNotice, addIdea, deletePerson, getIdea, personDetail, setStatus, updatePerson } from '$lib/server/domain/gifts';
import { fieldErrors, giftAddIdeaForm, giftPersonForm, giftStatusForm, parseForm } from '$lib/server/forms';
import { publish } from '$lib/server/events';

// One person's gifts (SPEC §5.2): ideas, bought, and what was given by occasion.

export const load: PageServerLoad = ({ params }) => {
	const d = personDetail(db(), Number(params.personId));
	if (!d) error(404, 'That person has gone.');
	return d;
};

const changed = () => publish({ type: 'change', memberId: null, reason: 'gift' });

export const actions: Actions = {
	addIdea: async ({ params, request }) => {
		const form = await request.formData();
		form.set('personId', params.personId);
		const p = parseForm(giftAddIdeaForm, form);
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		const res = addIdea(db(), p.data.personId, p.data.title);
		if (res.status === 'gone') return fail(400, { error: 'That person has gone.' });
		changed();
		return { added: true, notice: addedNotice(res, personDetail(db(), p.data.personId)!.person.name) };
	},
	/** Idea → bought → given, or back. The idea must be this person's. */
	status: async ({ params, request }) => {
		const p = parseForm(giftStatusForm, await request.formData());
		if (!p.success || getIdea(db(), p.data.ideaId)?.personId !== Number(params.personId)) return fail(400, { error: 'That idea has gone.' });
		if (setStatus(db(), p.data.ideaId, p.data.status)) changed();
	},
	save: async ({ params, request }) => {
		const form = await request.formData();
		form.set('personId', params.personId);
		const p = parseForm(giftPersonForm, form);
		if (!p.success) return fail(400, { personErrors: fieldErrors(p.error) });
		const res = updatePerson(db(), p.data.personId, p.data);
		if (res === 'taken') return fail(400, { personErrors: { name: 'Someone already has that name.' } });
		if (res === 'gone') return fail(400, { error: 'That person has gone.' });
		changed();
		return { notice: 'Saved.' };
	},
	remove: async ({ params, request }) => {
		if ((await request.formData()).get('confirm') !== 'on') return fail(400, { personErrors: { confirm: 'Tick the box to confirm.' } });
		deletePerson(db(), Number(params.personId));
		changed();
		redirect(303, '/planner/gifts');
	}
};
