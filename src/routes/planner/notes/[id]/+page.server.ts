import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { deleteNote, editedLabel, getNote } from '$lib/server/domain/notes';
import { publish } from '$lib/server/events';

// One note (SPEC §5.3). Typing saves through PUT on this address (+server.ts); deleting is a form.

export const load: PageServerLoad = ({ params }) => {
	const note = getNote(db(), Number(params.id));
	if (!note) error(404, 'That note has gone.');
	return { note, edited: editedLabel(note.updatedAt) };
};

export const actions: Actions = {
	remove: async ({ params, request }) => {
		if ((await request.formData()).get('confirm') !== 'on') return fail(400, { confirmError: 'Tick the box to confirm.' });
		deleteNote(db(), Number(params.id));
		publish({ type: 'change', memberId: null, reason: 'note' });
		redirect(303, '/planner/notes');
	}
};
