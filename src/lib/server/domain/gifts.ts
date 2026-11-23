import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { giftIdea, giftPerson } from '../db/schema';
import { localToday } from './lists';

// Gift ideas (SPEC §5.2, ADR-32). People kept all year; each idea goes idea → bought → given.
// Writes set a state, so repeating one changes nothing.

export type GiftStatus = 'idea' | 'bought' | 'given';
export type PersonRow = typeof giftPerson.$inferSelect;
export type IdeaRow = typeof giftIdea.$inferSelect;

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const norm = (s: string) => clean(s).toLowerCase();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar" for a stored MM-DD birthday. */
export function birthdayLabel(birthday: string | null): string | null {
	if (!birthday) return null;
	const [m, d] = birthday.split('-').map(Number);
	return `${d} ${MONTHS[m - 1]}`;
}

/**
 * The occasion a gift bought today is most likely for: the person's next birthday or the next
 * Christmas, whichever comes first (today counts). "Birthday 2027", "Christmas 2026".
 */
export function defaultOccasion(birthday: string | null, today: string): string {
	const year = Number(today.slice(0, 4));
	const next = (mmdd: string) => (`${year}-${mmdd}` >= today ? year : year + 1);
	const xmas = { date: `${next('12-25')}-12-25`, label: `Christmas ${next('12-25')}` };
	if (!birthday) return xmas.label;
	const bday = { date: `${next(birthday)}-${birthday}`, label: `Birthday ${next(birthday)}` };
	return bday.date < xmas.date ? bday.label : xmas.label;
}

export interface PersonSummary extends PersonRow {
	ideas: number;
	bought: number;
	birthdayLabel: string | null;
}

/** Everyone, A–Z, with how many ideas and bought (not yet given) gifts they have. */
export function listPeople(db: DB): PersonSummary[] {
	const people = db.select().from(giftPerson).all();
	const ideas = db.select({ personId: giftIdea.personId, status: giftIdea.status }).from(giftIdea).all();
	return people
		.map((p) => ({
			...p,
			ideas: ideas.filter((i) => i.personId === p.id && i.status === 'idea').length,
			bought: ideas.filter((i) => i.personId === p.id && i.status === 'bought').length,
			birthdayLabel: birthdayLabel(p.birthday)
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export const getPerson = (db: DB, id: number) => db.select().from(giftPerson).where(eq(giftPerson.id, id)).get() ?? null;
export const getIdea = (db: DB, id: number) => db.select().from(giftIdea).where(eq(giftIdea.id, id)).get() ?? null;

const sameName = (db: DB, name: string, except?: number) =>
	db
		.select()
		.from(giftPerson)
		.all()
		.find((p) => p.id !== except && norm(p.name) === norm(name)) ?? null;

/** Add a person; a name already there (case and spacing ignored) returns that person. */
export function addPerson(db: DB, name: string, now = new Date()) {
	const same = sameName(db, name);
	if (same) return { status: 'exists', personId: same.id, name: same.name } as const;
	const id = db.insert(giftPerson).values({ name: clean(name), createdAt: now.toISOString() }).run().lastInsertRowid;
	return { status: 'added', personId: Number(id), name: clean(name) } as const;
}

/** Rename, set birthday (MM-DD) and notes. 'taken' when another person has that name. */
export function updatePerson(db: DB, id: number, v: { name: string; birthday: string | null; notes: string | null }): 'ok' | 'taken' | 'gone' {
	if (!getPerson(db, id)) return 'gone';
	if (sameName(db, v.name, id)) return 'taken';
	db.update(giftPerson).set({ name: clean(v.name), birthday: v.birthday, notes: v.notes }).where(eq(giftPerson.id, id)).run();
	return 'ok';
}

/** Delete a person and every idea and gift recorded for them. */
export function deletePerson(db: DB, id: number): boolean {
	return db.delete(giftPerson).where(eq(giftPerson.id, id)).run().changes > 0;
}

export interface GivenGroup {
	occasion: string;
	items: IdeaRow[];
}

/** A person's page: open ideas, bought gifts, and given gifts by occasion (newest first). */
export function personDetail(db: DB, id: number) {
	const person = getPerson(db, id);
	if (!person) return null;
	const all = db.select().from(giftIdea).where(eq(giftIdea.personId, id)).orderBy(asc(giftIdea.id)).all();
	const groups = new Map<string, IdeaRow[]>();
	for (const i of all.filter((i) => i.status === 'given')) {
		const key = i.occasion ?? 'No occasion';
		groups.set(key, [...(groups.get(key) ?? []), i]);
	}
	const latest = (items: IdeaRow[]) => items.reduce((m, i) => ((i.givenAt ?? '') > m ? (i.givenAt ?? '') : m), '');
	const given: GivenGroup[] = [...groups].map(([occasion, items]) => ({ occasion, items })).sort((a, b) => latest(b.items).localeCompare(latest(a.items)));
	return {
		person: { ...person, birthdayLabel: birthdayLabel(person.birthday) },
		ideas: all.filter((i) => i.status === 'idea'),
		bought: all.filter((i) => i.status === 'bought'),
		given
	};
}

export type AddIdeaResult =
	| { status: 'added'; ideaId: number; title: string; gaveBefore: string | null }
	| { status: 'exists'; ideaId: number; title: string }
	| { status: 'gone' };

/**
 * Add an idea for a person. One they already have as an idea or bought adds nothing. One they
 * were given before is added, and `gaveBefore` names the occasion so the page can say so.
 */
export function addIdea(db: DB, personId: number, title: string, now = new Date()): AddIdeaResult {
	if (!getPerson(db, personId)) return { status: 'gone' };
	const t = clean(title);
	const same = db
		.select()
		.from(giftIdea)
		.where(eq(giftIdea.personId, personId))
		.all()
		.filter((i) => norm(i.title) === norm(t));
	const open = same.find((i) => i.status !== 'given');
	if (open) return { status: 'exists', ideaId: open.id, title: open.title };
	const before = same.sort((a, b) => (b.givenAt ?? '').localeCompare(a.givenAt ?? ''))[0];
	const id = db.insert(giftIdea).values({ personId, title: t, createdAt: now.toISOString() }).run().lastInsertRowid;
	return { status: 'added', ideaId: Number(id), title: t, gaveBefore: before ? (before.occasion ?? 'some time') : null };
}

/** The notice after adding an idea; null when it was simply added. */
export function addedNotice(res: AddIdeaResult, name: string): string | null {
	if (res.status === 'exists') return `${res.title} is already on ${name}'s ideas.`;
	if (res.status === 'added' && res.gaveBefore) return `Added. You gave ${name} ${res.title} at ${res.gaveBefore}.`;
	return null;
}

/**
 * Move an idea to a status. Bought or given fills in the occasion if empty (see
 * defaultOccasion). Back to an idea clears the dates but keeps the occasion. Returns false when
 * it was already there or is gone.
 */
export function setStatus(db: DB, ideaId: number, status: GiftStatus, now = new Date()): boolean {
	const idea = getIdea(db, ideaId);
	if (!idea || idea.status === status) return false;
	const at = now.toISOString();
	const occasion = () => idea.occasion ?? defaultOccasion(getPerson(db, idea.personId)?.birthday ?? null, localToday(now));
	const set =
		status === 'idea'
			? { status, boughtAt: null, givenAt: null }
			: status === 'bought'
				? { status, boughtAt: idea.boughtAt ?? at, givenAt: null, occasion: occasion() }
				: { status, boughtAt: idea.boughtAt ?? at, givenAt: at, occasion: occasion() };
	db.update(giftIdea).set(set).where(eq(giftIdea.id, ideaId)).run();
	return true;
}

/** The idea page's save: name, notes, price, occasion and status. */
export function updateIdea(
	db: DB,
	ideaId: number,
	v: { title: string; notes: string | null; price: number | null; occasion: string | null; status: GiftStatus },
	now = new Date()
): boolean {
	const idea = getIdea(db, ideaId);
	if (!idea) return false;
	// Bought and given gifts always have an occasion (history is grouped by it).
	const occasion = v.occasion ? clean(v.occasion) : v.status === 'idea' ? null : defaultOccasion(getPerson(db, idea.personId)?.birthday ?? null, localToday(now));
	db.update(giftIdea)
		.set({ title: clean(v.title), notes: v.notes, price: v.price, occasion })
		.where(eq(giftIdea.id, ideaId))
		.run();
	setStatus(db, ideaId, v.status, now);
	return true;
}

export function deleteIdea(db: DB, ideaId: number): boolean {
	return db.delete(giftIdea).where(eq(giftIdea.id, ideaId)).run().changes > 0;
}

export interface OpenOccasion {
	occasion: string;
	bought: number;
	people: number;
}

const yearOf = (o: string) => Number(/\b(\d{4})\b/.exec(o)?.[1] ?? 9999);

/** Occasions with gifts bought but not yet given, by year then name. */
export function openOccasions(db: DB): OpenOccasion[] {
	const rows = db.select().from(giftIdea).where(eq(giftIdea.status, 'bought')).all();
	const by = new Map<string, IdeaRow[]>();
	for (const r of rows) {
		const key = r.occasion ?? 'No occasion';
		by.set(key, [...(by.get(key) ?? []), r]);
	}
	return [...by]
		.map(([occasion, items]) => ({ occasion, bought: items.length, people: new Set(items.map((i) => i.personId)).size }))
		.sort((a, b) => yearOf(a.occasion) - yearOf(b.occasion) || a.occasion.localeCompare(b.occasion));
}

/** Mark every bought gift for an occasion as given. Returns how many. */
export function markOccasionGiven(db: DB, occasion: string, now = new Date()): number {
	return db
		.update(giftIdea)
		.set({ status: 'given', givenAt: now.toISOString() })
		.where(and(eq(giftIdea.status, 'bought'), eq(giftIdea.occasion, occasion)))
		.run().changes;
}

/** One idea with its person (the idea page). */
export function ideaDetail(db: DB, ideaId: number) {
	const idea = getIdea(db, ideaId);
	if (!idea) return null;
	const person = getPerson(db, idea.personId)!;
	return { idea, person, suggested: defaultOccasion(person.birthday, localToday()) };
}
