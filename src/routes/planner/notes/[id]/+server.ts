import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { deleteIfEmpty, saveNote } from '$lib/server/domain/notes';
import { noteSave } from '$lib/server/forms';
import { publish } from '$lib/server/events';

// Autosave for one note (ADR-37). JSON, so the hooks' CSRF check (form posts only) does not
// apply; a cross-site JSON request needs a CORS preflight, which this app never grants.
//   PUT    { title, body, version } → 200 { note } | 409 { note } (someone saved first) | 404 | 400
//   DELETE → removes the note only if it is empty (a new note left untouched)

const changed = (noteId: number) => publish({ type: 'change', memberId: null, reason: 'note', noteId });

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const p = noteSave.safeParse(await request.json().catch(() => null));
	if (!p.success) return json({ error: p.error.issues[0]?.message ?? 'Bad save' }, { status: 400 });
	const res = saveNote(db(), id, p.data);
	if (res.status === 'gone') return json({ error: 'That note has been deleted.' }, { status: 404 });
	if (res.status === 'conflict') return json({ note: res.note }, { status: 409 });
	if (res.wrote) changed(id);
	return json({ note: res.note });
};

export const DELETE: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	if (deleteIfEmpty(db(), id)) changed(id);
	return new Response(null, { status: 204 });
};
