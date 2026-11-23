import { describe, expect, it } from 'vitest';
import { seededDb } from '../helpers';
import { member } from '../../src/lib/server/db/schema';
import { shortLabelTakenBy } from '../../src/lib/server/planner';
import { memberForm, templateForm, stepForm, parseForm, pinForm, deviceForm, patternDayForm, fieldErrors, itemScheduleForm } from '../../src/lib/server/forms';

const fd = (entries: Array<[string, string]>) => {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
};

describe('member short labels', () => {
	it('must be unique across members, ignoring case, except for the member being edited', async () => {
		const db = await seededDb();
		const ari = db.select().from(member).get()!;
		expect(shortLabelTakenBy(db, 'ari')).toBe('Ari');
		expect(shortLabelTakenBy(db, 'ARI', ari.id)).toBeNull();
		expect(shortLabelTakenBy(db, 'ZOE')).toBeNull();
	});
});

describe('Planner form validation', () => {
	it('rejects empty titles and bad short labels', () => {
		const r = parseForm(memberForm, fd([['name', '  '], ['shortLabel', 'E'], ['kind', 'child'], ['icon', 'star'], ['displayMode', 'reader']]));
		expect(r.success).toBe(false);
		if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(['name', 'shortLabel']);
	});
	it('uppercases the short label and reads checkboxes', () => {
		const r = parseForm(memberForm, fd([['name', 'Zoe'], ['shortLabel', 'zoe'], ['kind', 'child'], ['icon', 'heart'], ['displayMode', 'picture'], ['active', 'on']]));
		expect(r.success && r.data).toMatchObject({ shortLabel: 'ZOE', active: true });
	});
	it('rejects bad times and an empty day mask; builds the bitmask', () => {
		expect(parseForm(templateForm, fd([['name', 'M'], ['kind', 'morning'], ['windowStart', '25:00'], ['windowEnd', '09:00'], ['days', '1']]), ['days']).success).toBe(false);
		expect(parseForm(templateForm, fd([['name', 'M'], ['kind', 'morning'], ['windowStart', '06:30'], ['windowEnd', '09:00']]), ['days']).success).toBe(false);
		const ok = parseForm(templateForm, fd([['name', 'M'], ['kind', 'morning'], ['windowStart', '19:00'], ['windowEnd', '01:00'], ['days', '1'], ['days', '5']]), ['days']);
		expect(ok.success && ok.data.daysOfWeek).toBe(0b100010);
	});
	it('rejects unknown glyphs and accepts day-type filters', () => {
		expect(parseForm(stepForm, fd([['title', 'Brush'], ['icon', 'unicorn']]), ['dayTypes']).success).toBe(false);
		const ok = parseForm(stepForm, fd([['title', 'Brush'], ['icon', 'tooth'], ['dayTypes', '2'], ['dayTypes', '3']]), ['dayTypes']);
		expect(ok.success && ok.data.dayTypes).toEqual([2, 3]);
	});
	it('validates PINs, device ids and weekly pattern days', () => {
		expect(parseForm(pinForm, fd([['pin', '12345'], ['confirm', '12345']])).success).toBe(false);
		expect(parseForm(pinForm, fd([['pin', '123456'], ['confirm', '123457']])).success).toBe(false);
		expect(parseForm(deviceForm, fd([['id', 'Hall Wall'], ['name', 'Hall']])).success).toBe(false);
		expect(parseForm(deviceForm, fd([['id', 'hall-wall'], ['name', 'Hall']])).success).toBe(true);
		const set = parseForm(patternDayForm, fd([['memberId', '1'], ['weekday', '3'], ['dayTypeId', '2']]));
		expect(set.success && set.data).toEqual({ memberId: 1, weekday: 3, dayTypeId: 2 });
		const clear = parseForm(patternDayForm, fd([['memberId', '1'], ['weekday', '0'], ['dayTypeId', '']]));
		expect(clear.success && clear.data.dayTypeId).toBe('');
		expect(parseForm(patternDayForm, fd([['memberId', '1'], ['weekday', '7'], ['dayTypeId', '2']])).success).toBe(false);
	});
});

describe('item page form', () => {
	it('a shopping item posts name and notes only; a one-off "By a date" needs a date; Now has none', () => {
		const shop = parseForm(itemScheduleForm, fd(Object.entries({ itemId: '3', title: 'Milk', notes: ' Lactose free ' })));
		expect(shop.success && shop.data).toMatchObject({ title: 'Milk', notes: 'Lactose free', schedule: { due: null, repeat: null, now: false } });
		expect(parseForm(itemScheduleForm, fd(Object.entries({ itemId: '3', title: 'Tap', repeat: 'none', when: 'date', due: '' }))).success).toBe(false);
		const now = parseForm(itemScheduleForm, fd(Object.entries({ itemId: '3', title: 'Tap', repeat: 'none', when: 'now', due: '2026-11-20', notes: '' })));
		expect(now.success && now.data).toMatchObject({ notes: null, schedule: { due: null, now: true } });
		expect(parseForm(itemScheduleForm, fd(Object.entries({ itemId: '3', title: 'Tap', notes: 'x'.repeat(2001) }))).success).toBe(false);
	});
});
