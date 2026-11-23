import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { createNote, editedLabel, listNotes } from '$lib/server/domain/notes';
import { publish } from '$lib/server/events';

// Shared notes (SPEC §5.3, ADR-37): every note, last edited first.

export const load: PageServerLoad = () => {
	const now = new Date();
	return { notes: listNotes(db()).map((n) => ({ ...n, edited: editedLabel(n.updatedAt, now) })) };
};

export const actions: Actions = {
	/** A new empty note, opened straight away. Left empty, the editor deletes it on the way out. */
	create: () => {
		const id = createNote(db());
		publish({ type: 'change', memberId: null, reason: 'note' });
		redirect(303, `/planner/notes/${id}?new=1`);
	}
};
