import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { deleteIdea, getIdea, ideaDetail, updateIdea } from '$lib/server/domain/gifts';
import { fieldErrors, giftIdeaForm, parseForm } from '$lib/server/forms';
import { publish } from '$lib/server/events';

// One gift idea (SPEC §5.2): name, notes with links, price, occasion and status.

export const load: PageServerLoad = ({ params }) => {
	const d = ideaDetail(db(), Number(params.ideaId));
	if (!d) error(404, 'That idea has gone.');
	return d;
};

const changed = () => publish({ type: 'change', memberId: null, reason: 'gift' });

export const actions: Actions = {
	save: async ({ params, request }) => {
		const form = await request.formData();
		form.set('ideaId', params.ideaId);
		const p = parseForm(giftIdeaForm, form);
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		if (!updateIdea(db(), p.data.ideaId, p.data)) return fail(400, { error: 'That idea has gone.' });
		changed();
		return { notice: 'Saved.' };
	},
	remove: async ({ params }) => {
		const idea = getIdea(db(), Number(params.ideaId));
		if (idea) {
			deleteIdea(db(), idea.id);
			changed();
		}
		redirect(303, idea ? `/planner/gifts/${idea.personId}` : '/planner/gifts');
	}
};
