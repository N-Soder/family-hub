import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { addedNotice, addIdea, addPerson, listPeople, markOccasionGiven, openOccasions } from '$lib/server/domain/gifts';
import { fieldErrors, giftAddIdeaForm, giftNewPersonForm, giftOccasionForm, parseForm } from '$lib/server/forms';
import { publish } from '$lib/server/events';

// Gifts (SPEC §5.2, ADR-32): everyone with ideas and bought counts, a quick add, and the
// occasions with bought gifts still to give. Planner only.

export const load: PageServerLoad = () => ({ people: listPeople(db()), occasions: openOccasions(db()) });

/** Refresh other open Planner pages. Gifts never reach the wall, so nothing to repaint. */
const changed = () => publish({ type: 'change', memberId: null, reason: 'gift' });

export const actions: Actions = {
	addPerson: async ({ request }) => {
		const p = parseForm(giftNewPersonForm, await request.formData());
		if (!p.success) return fail(400, { personErrors: fieldErrors(p.error) });
		const res = addPerson(db(), p.data.name);
		changed();
		redirect(303, `/planner/gifts/${res.personId}`);
	},
	addIdea: async ({ request }) => {
		const p = parseForm(giftAddIdeaForm, await request.formData());
		if (!p.success) return fail(400, { ideaErrors: fieldErrors(p.error) });
		const res = addIdea(db(), p.data.personId, p.data.title);
		if (res.status === 'gone') return fail(400, { ideaErrors: { personId: 'Pick who it is for.' } });
		changed();
		const name = listPeople(db()).find((x) => x.id === p.data.personId)?.name ?? '';
		return { added: true, notice: addedNotice(res, name) ?? `Added to ${name}'s ideas.` };
	},
	given: async ({ request }) => {
		const p = parseForm(giftOccasionForm, await request.formData());
		if (!p.success) return fail(400, { error: 'That occasion has gone.' });
		const n = markOccasionGiven(db(), p.data.occasion);
		changed();
		return { notice: `${p.data.occasion}: ${n} gift${n === 1 ? '' : 's'} marked given.` };
	}
};
