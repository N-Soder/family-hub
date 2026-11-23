import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { note } from '../db/schema';
import { DEFAULT_TZ } from './time';

// Shared notes (SPEC §5.3, ADR-37): a heading and plain text. Saves carry the version they
// started from; a save on an older version is refused and the caller is handed the current note.
// Repeating a save that already went through is not a conflict.

export type NoteRow = typeof note.$inferSelect;

export const NOTE_TITLE_MAX = 80;
export const NOTE_BODY_MAX = 20_000;

export interface NoteSummary {
	id: number;
	title: string;
	/** The first line with text in it, cut to 120 characters. */
	preview: string;
	updatedAt: string;
}

const firstLine = (body: string) => (body.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 120);

/** Every note, last edited first. */
export function listNotes(db: DB): NoteSummary[] {
	return db
		.select()
		.from(note)
		.orderBy(desc(note.updatedAt), desc(note.id))
		.all()
		.map((n) => ({ id: n.id, title: n.title, preview: firstLine(n.body), updatedAt: n.updatedAt }));
}

export const getNote = (db: DB, id: number): NoteRow | null => db.select().from(note).where(eq(note.id, id)).get() ?? null;

export function createNote(db: DB, now = new Date()): number {
	const at = now.toISOString();
	return db.insert(note).values({ createdAt: at, updatedAt: at }).returning({ id: note.id }).get().id;
}

export type SaveResult = { status: 'saved'; note: NoteRow; wrote: boolean } | { status: 'conflict'; note: NoteRow } | { status: 'gone' };

/**
 * Save a note's heading and text if nobody else has saved since `version`. If they have, and the
 * text is not already what is being saved, nothing changes and the current note comes back.
 */
export function saveNote(db: DB, id: number, input: { title: string; body: string; version: number }, now = new Date()): SaveResult {
	return db.transaction((tx) => {
		const current = tx.select().from(note).where(eq(note.id, id)).get();
		if (!current) return { status: 'gone' } as const;
		if (current.title === input.title && current.body === input.body) return { status: 'saved', note: current, wrote: false } as const;
		if (current.version !== input.version) return { status: 'conflict', note: current } as const;
		const saved = tx
			.update(note)
			.set({ title: input.title, body: input.body, version: current.version + 1, updatedAt: now.toISOString() })
			.where(and(eq(note.id, id), eq(note.version, input.version)))
			.returning()
			.get();
		return { status: 'saved', note: saved, wrote: true } as const;
	});
}

/** Delete a note. Deleting one that has gone already is fine. */
export function deleteNote(db: DB, id: number): void {
	db.delete(note).where(eq(note.id, id)).run();
}

/** Delete a note only if it has no heading and no text (a new note left untouched). */
export function deleteIfEmpty(db: DB, id: number): boolean {
	const n = getNote(db, id);
	if (!n || n.title.trim() || n.body.trim()) return false;
	deleteNote(db, id);
	return true;
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", then "14 Mar" / "14 Mar 2025". */
export function editedLabel(updatedAt: string, now = new Date()): string {
	const then = new Date(updatedAt);
	const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
	if (mins < 1) return 'Just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: DEFAULT_TZ };
	if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
	return then.toLocaleDateString('en-AU', opts);
}
