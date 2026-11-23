import { describe, expect, it } from 'vitest';
import { seededDb } from '../helpers';
import {
	addIdea,
	addPerson,
	defaultOccasion,
	deletePerson,
	getIdea,
	listPeople,
	markOccasionGiven,
	openOccasions,
	personDetail,
	setStatus,
	updateIdea,
	updatePerson
} from '../../src/lib/server/domain/gifts';
import { giftIdeaForm, giftPersonForm, parseForm } from '../../src/lib/server/forms';
import { perth } from '../helpers';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};

async function mum() {
	const db = await seededDb();
	const { personId } = addPerson(db, 'Mum');
	return { db, personId };
}

describe('gift occasions', () => {
	it('defaults to Christmas, or the birthday when it comes first (today counts)', () => {
		expect(defaultOccasion(null, '2026-11-07')).toBe('Christmas 2026');
		expect(defaultOccasion(null, '2026-12-25')).toBe('Christmas 2026');
		expect(defaultOccasion(null, '2026-12-26')).toBe('Christmas 2027');
		expect(defaultOccasion('11-20', '2026-11-07')).toBe('Birthday 2026');
		expect(defaultOccasion('11-07', '2026-11-07')).toBe('Birthday 2026');
		expect(defaultOccasion('03-14', '2026-11-07')).toBe('Christmas 2026');
		expect(defaultOccasion('01-10', '2026-12-27')).toBe('Birthday 2027');
	});
});

describe('gift people', () => {
	it('lists people A–Z with idea and bought counts; names are unique ignoring case', async () => {
		const { db, personId } = await mum();
		expect(addPerson(db, '  mum ').status).toBe('exists');
		addPerson(db, 'dad');
		addIdea(db, personId, 'Slippers');
		const scarf = addIdea(db, personId, 'Scarf');
		if (scarf.status !== 'added') throw new Error();
		setStatus(db, scarf.ideaId, 'bought');
		expect(listPeople(db).map((p) => [p.name, p.ideas, p.bought])).toEqual([
			['dad', 0, 0],
			['Mum', 1, 1]
		]);
		expect(updatePerson(db, personId, { name: 'DAD', birthday: null, notes: null })).toBe('taken');
		expect(updatePerson(db, personId, { name: 'Mum', birthday: '03-14', notes: 'Size M' })).toBe('ok');
		expect(listPeople(db).find((p) => p.id === personId)?.birthdayLabel).toBe('14 Mar');
	});

	it('deleting a person deletes their ideas', async () => {
		const { db, personId } = await mum();
		const r = addIdea(db, personId, 'Slippers');
		deletePerson(db, personId);
		expect(r.status === 'added' && getIdea(db, r.ideaId)).toBeNull();
	});
});

describe('gift ideas', () => {
	it('does not duplicate an open idea (case and spacing ignored)', async () => {
		const { db, personId } = await mum();
		expect(addIdea(db, personId, 'Slippers').status).toBe('added');
		expect(addIdea(db, personId, ' slippers  ').status).toBe('exists');
		expect(addIdea(db, 999, 'Anything').status).toBe('gone');
	});

	it('idea → bought fills the occasion; back to idea keeps it; repeats change nothing', async () => {
		const { db, personId } = await mum();
		const r = addIdea(db, personId, 'Slippers');
		if (r.status !== 'added') throw new Error();
		const now = perth('2026-11-07', '09:00');
		expect(setStatus(db, r.ideaId, 'bought', now)).toBe(true);
		expect(setStatus(db, r.ideaId, 'bought', now)).toBe(false);
		expect(getIdea(db, r.ideaId)).toMatchObject({ status: 'bought', occasion: 'Christmas 2026', boughtAt: now.toISOString() });
		expect(setStatus(db, r.ideaId, 'idea', now)).toBe(true);
		expect(getIdea(db, r.ideaId)).toMatchObject({ status: 'idea', occasion: 'Christmas 2026', boughtAt: null });
	});

	it('given gifts are history by occasion, and adding one again says when it was given', async () => {
		const { db, personId } = await mum();
		const r = addIdea(db, personId, 'Slippers');
		if (r.status !== 'added') throw new Error();
		setStatus(db, r.ideaId, 'bought', perth('2025-12-01', '09:00'));
		setStatus(db, r.ideaId, 'given', perth('2025-12-25', '09:00'));
		const d = personDetail(db, personId)!;
		expect(d.given).toEqual([{ occasion: 'Christmas 2025', items: [expect.objectContaining({ title: 'Slippers' })] }]);
		expect(addIdea(db, personId, 'slippers')).toMatchObject({ status: 'added', gaveBefore: 'Christmas 2025' });
		expect(personDetail(db, personId)!.ideas).toHaveLength(1);
	});

	it('marks every bought gift for an occasion given at once', async () => {
		const { db, personId } = await mum();
		const dad = addPerson(db, 'Dad').personId;
		const now = perth('2026-11-07', '09:00');
		for (const [p, t] of [[personId, 'Slippers'], [dad, 'Drill'], [dad, 'Socks']] as const) {
			const r = addIdea(db, p, t);
			if (r.status === 'added') setStatus(db, r.ideaId, 'bought', now);
		}
		const bday = addIdea(db, dad, 'Book');
		if (bday.status === 'added') updateIdea(db, bday.ideaId, { title: 'Book', notes: null, price: 30, occasion: 'Birthday 2027', status: 'bought' });
		expect(openOccasions(db)).toEqual([
			{ occasion: 'Christmas 2026', bought: 3, people: 2 },
			{ occasion: 'Birthday 2027', bought: 1, people: 1 }
		]);
		expect(markOccasionGiven(db, 'Christmas 2026')).toBe(3);
		expect(markOccasionGiven(db, 'Christmas 2026')).toBe(0);
		expect(openOccasions(db)).toEqual([{ occasion: 'Birthday 2027', bought: 1, people: 1 }]);
	});

	it('a bought gift saved with no occasion gets the default one', async () => {
		const { db, personId } = await mum();
		const r = addIdea(db, personId, 'Slippers');
		if (r.status !== 'added') throw new Error();
		updateIdea(db, r.ideaId, { title: 'Slippers', notes: null, price: null, occasion: null, status: 'given' }, perth('2026-11-07', '09:00'));
		expect(getIdea(db, r.ideaId)).toMatchObject({ status: 'given', occasion: 'Christmas 2026' });
	});
});

describe('gift forms', () => {
	it('birthday is day + month, both or neither, and must exist', () => {
		const ok = parseForm(giftPersonForm, fd({ personId: '1', name: 'Mum', day: '29', month: '2' }));
		expect(ok.success && ok.data.birthday).toBe('02-29');
		const none = parseForm(giftPersonForm, fd({ personId: '1', name: 'Mum', day: '', month: '' }));
		expect(none.success && none.data.birthday).toBeNull();
		expect(parseForm(giftPersonForm, fd({ personId: '1', name: 'Mum', day: '31', month: '4' })).success).toBe(false);
		expect(parseForm(giftPersonForm, fd({ personId: '1', name: 'Mum', day: '3', month: '' })).success).toBe(false);
	});

	it('price takes "$1,200" and blank', () => {
		const base = { ideaId: '1', title: 'Bike', notes: '', occasion: '', status: 'idea' };
		const p = parseForm(giftIdeaForm, fd({ ...base, price: '$1,200' }));
		expect(p.success && p.data.price).toBe(1200);
		const b = parseForm(giftIdeaForm, fd({ ...base, price: '' }));
		expect(b.success && b.data.price).toBeNull();
		expect(parseForm(giftIdeaForm, fd({ ...base, price: 'lots' })).success).toBe(false);
	});
});
