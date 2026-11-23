import { describe, expect, it } from 'vitest';
import { seededDb } from '../helpers';
import { createNote, deleteIfEmpty, deleteNote, editedLabel, getNote, listNotes, saveNote } from '../../src/lib/server/domain/notes';
import { noteSave } from '../../src/lib/server/forms';

const at = (iso: string) => new Date(iso);

describe('notes', () => {
	it('creates an empty note at version 1 and lists last edited first', async () => {
		const db = await seededDb();
		const a = createNote(db, at('2026-11-01T00:00:00Z'));
		const b = createNote(db, at('2026-11-02T00:00:00Z'));
		expect(getNote(db, a)).toMatchObject({ title: '', body: '', version: 1 });
		expect(listNotes(db).map((n) => n.id)).toEqual([b, a]);
		saveNote(db, a, { title: 'Wifi', body: '\n\n  Password: hunter2\nmore', version: 1 }, at('2026-11-03T00:00:00Z'));
		const list = listNotes(db);
		expect(list.map((n) => n.id)).toEqual([a, b]);
		expect(list[0].preview).toBe('Password: hunter2');
	});

	it('saves on the current version and bumps it', async () => {
		const db = await seededDb();
		const id = createNote(db);
		const r = saveNote(db, id, { title: 'Pool', body: 'Chlorine Sat', version: 1 });
		expect(r).toMatchObject({ status: 'saved', wrote: true, note: { version: 2, title: 'Pool' } });
	});

	it('refuses a save on an older version and returns the current note', async () => {
		const db = await seededDb();
		const id = createNote(db);
		saveNote(db, id, { title: 'Phone A', body: 'first', version: 1 });
		const r = saveNote(db, id, { title: 'Phone B', body: 'second', version: 1 });
		expect(r).toMatchObject({ status: 'conflict', note: { title: 'Phone A', version: 2 } });
		expect(getNote(db, id)?.body).toBe('first');
	});

	it('treats a repeated save as done, not a conflict (idempotent)', async () => {
		const db = await seededDb();
		const id = createNote(db);
		saveNote(db, id, { title: 'T', body: 'B', version: 1 });
		const again = saveNote(db, id, { title: 'T', body: 'B', version: 1 });
		expect(again).toMatchObject({ status: 'saved', wrote: false, note: { version: 2 } });
	});

	it('reports a deleted note as gone', async () => {
		const db = await seededDb();
		const id = createNote(db);
		deleteNote(db, id);
		deleteNote(db, id); // twice is fine
		expect(saveNote(db, id, { title: 'x', body: '', version: 1 })).toEqual({ status: 'gone' });
	});

	it('deletes a note only when it is empty', async () => {
		const db = await seededDb();
		const empty = createNote(db);
		const kept = createNote(db);
		saveNote(db, kept, { title: '', body: 'text', version: 1 });
		expect(deleteIfEmpty(db, empty)).toBe(true);
		expect(deleteIfEmpty(db, kept)).toBe(false);
		expect(getNote(db, kept)).not.toBeNull();
	});

	it('validates saves: trims the heading, keeps text spacing, limits lengths', () => {
		expect(noteSave.parse({ title: '  Hi  ', body: 'a\r\n  b', version: 3 })).toEqual({ title: 'Hi', body: 'a\n  b', version: 3 });
		expect(noteSave.safeParse({ title: 'x'.repeat(81), body: '', version: 1 }).success).toBe(false);
		expect(noteSave.safeParse({ title: '', body: 'x'.repeat(20_001), version: 1 }).success).toBe(false);
		expect(noteSave.safeParse({ title: '', body: '', version: 0 }).success).toBe(false);
	});

	it('labels when a note was edited', () => {
		const now = at('2026-11-15T04:00:00Z');
		expect(editedLabel('2026-11-15T03:59:40Z', now)).toBe('Just now');
		expect(editedLabel('2026-11-15T03:55:00Z', now)).toBe('5 min ago');
		expect(editedLabel('2026-11-15T01:00:00Z', now)).toBe('3 h ago');
		expect(editedLabel('2026-11-14T02:00:00Z', now)).toBe('Yesterday');
		expect(editedLabel('2026-11-11T04:00:00Z', now)).toBe('4 days ago');
		expect(editedLabel('2026-03-14T04:00:00Z', now)).toBe('14 Mar');
		expect(editedLabel('2025-03-14T04:00:00Z', now)).toBe('14 Mar 2025');
	});
});
