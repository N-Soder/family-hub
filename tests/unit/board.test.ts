import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seededDb, perth } from '../helpers';
import { member, routineTemplate } from '../../src/lib/server/db/schema';
import { boardSessions, currentPairingCode, issuePairingCode, PAIR_MAX_FAILURES, redeemPairingCode, unpairBoard, validBoardSession } from '../../src/lib/server/auth/board';
import { boardView, mondayOf, weekGrid } from '../../src/lib/server/domain/board';
import { setStepState } from '../../src/lib/server/domain/toggle';
import { createList, addItem, setSchedule } from '../../src/lib/server/domain/lists';
import { getOrCreateOccurrence, occurrenceSteps } from '../../src/lib/server/domain/routines';

const TZ = 'Australia/Perth';

describe('board pairing (ADR-30)', () => {
	it('a code pairs once, within ten minutes; wrong guesses count and five end the code', async () => {
		const db = await seededDb();
		const t0 = new Date('2026-11-05T10:00:00+08:00');
		expect(currentPairingCode(db, t0)).toBeNull();
		expect(redeemPairingCode(db, '123456', 'TV', t0)).toEqual({ ok: false, reason: 'none' });
		const { code } = issuePairingCode(db, t0);
		expect(code).toMatch(/^\d{6}$/);
		expect(currentPairingCode(db, t0)?.code).toBe(code);
		// Expired after ten minutes.
		expect(redeemPairingCode(db, code, 'TV', new Date(t0.getTime() + 11 * 60_000))).toEqual({ ok: false, reason: 'none' });
		// Fresh code: wrong guesses, then the right one (spaces allowed), then it is spent.
		const fresh = issuePairingCode(db, t0).code;
		expect(redeemPairingCode(db, '000000' === fresh ? '000001' : '000000', 'TV', t0)).toEqual({ ok: false, reason: 'wrong' });
		const ok = redeemPairingCode(db, `${fresh.slice(0, 3)} ${fresh.slice(3)}`, ' Kitchen TV ', t0);
		expect(ok.ok).toBe(true);
		expect(redeemPairingCode(db, fresh, 'again', t0)).toEqual({ ok: false, reason: 'none' });
		if (!ok.ok) return;
		const s = validBoardSession(db, ok.token, t0);
		expect(s?.name).toBe('Kitchen TV');
		expect(validBoardSession(db, 'nope', t0)).toBeNull();
		expect(validBoardSession(db, undefined, t0)).toBeNull();
		// Last seen is noted about hourly, not per request.
		validBoardSession(db, ok.token, new Date(t0.getTime() + 30 * 60_000));
		expect(boardSessions(db)[0].lastSeenAt).toBe(t0.toISOString());
		const later = new Date(t0.getTime() + 2 * 60 * 60_000);
		validBoardSession(db, ok.token, later);
		expect(boardSessions(db)[0].lastSeenAt).toBe(later.toISOString());
		// Five wrong guesses end a code.
		const c3 = issuePairingCode(db, t0).code;
		for (let i = 0; i < PAIR_MAX_FAILURES; i++) redeemPairingCode(db, c3 === '111111' ? '222222' : '111111', 'x', t0);
		expect(currentPairingCode(db, t0)).toBeNull();
		// Unpair forgets the screen.
		expect(unpairBoard(db, s!.tokenHash)).toBe(true);
		expect(validBoardSession(db, ok.token, t0)).toBeNull();
		expect(unpairBoard(db, s!.tokenHash)).toBe(false);
	});
});

function ics(events: string[]) {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}
const ev = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'].join('\r\n');
function feedDir(feeds: Record<string, string>, names: Record<string, string>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-board-'));
	fs.writeFileSync(path.join(dir, 'feeds.json'), JSON.stringify({ feeds: Object.keys(feeds).map((id) => ({ id, name: names[id], url: 'https://x.invalid/a.ics', enabled: true })) }));
	for (const [id, body] of Object.entries(feeds)) fs.writeFileSync(path.join(dir, `feed_${id}.ics`), body);
	return dir;
}

describe('board view', () => {
	// Thursday 5 Nov 2026, 7:15 am Perth: Ari's Morning routine (06:30–09:00) is running; Thursday is a home day.
	const NOW = perth('2026-11-05', '07:15');

	it('week grid: Monday to Sunday with today marked and past days flagged, then next week', async () => {
		const db = await seededDb();
		expect(mondayOf('2026-11-05')).toBe('2026-11-02');
		expect(mondayOf('2026-11-02')).toBe('2026-11-02');
		expect(mondayOf('2026-11-08')).toBe('2026-11-02');
		const dir = feedDir(
			{
				fam: ics([
					ev('a', ['DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'SUMMARY:Bin night']),
					ev('b', ['DTSTART;TZID=Australia/Perth:20261105T063000', 'DTEND;TZID=Australia/Perth:20261105T070000', 'SUMMARY:Early swim']),
					ev('c', ['DTSTART;TZID=Australia/Perth:20261105T153000', 'DTEND;TZID=Australia/Perth:20261105T160000', 'SUMMARY:Dentist']),
					...[1, 2, 3, 4, 5].map((i) => ev(`m${i}`, [`DTSTART;TZID=Australia/Perth:2026110${6}T1${i}0000`, `DTEND;TZID=Australia/Perth:2026110${6}T1${i}3000`, `SUMMARY:Thing ${i}`])),
					ev('n', ['DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261111', 'SUMMARY:Next week thing'])
				]),
				ari: ics([ev('d', ['DTSTART;TZID=Australia/Perth:20261107T100000', 'DTEND;TZID=Australia/Perth:20261107T110000', 'SUMMARY:Party'])])
			},
			{ fam: 'Family', ari: 'Ari' }
		);
		// A dated to-do lands on its day; shopping items never do.
		const todo = createList(db, { name: 'Jobs', kind: 'todo', icon: 'list' }, NOW);
		const job = addItem(db, todo, 'Pay rates', NOW).itemId;
		setSchedule(db, job, { due: '2026-11-08', repeat: null, leadDays: null }, NOW);
		const grocery = createList(db, { name: 'Shopping', kind: 'grocery', icon: 'cart' }, NOW);
		const shop = addItem(db, grocery, 'Milk', NOW).itemId;
		setSchedule(db, shop, { due: '2026-11-08', repeat: null, leadDays: null }, NOW);

		const g = weekGrid(db, dir, TZ, '2026-11-05', NOW);
		expect(g.calendar).toBe(true);
		expect(g.week.map((d) => `${d.weekday} ${d.day}`)).toEqual(['Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6', 'Sat 7', 'Sun 8']);
		expect(g.week.map((d) => d.past)).toEqual([true, true, true, false, false, false, false]);
		expect(g.week.find((d) => d.today)?.date).toBe('2026-11-05');
		const by = (date: string) => g.week.find((d) => d.date === date)!;
		expect(by('2026-11-03').events.map((e) => e.title)).toEqual(['Bin night']);
		// Today: the 6:30 swim is over (past), the dentist is not.
		expect(by('2026-11-05').events.map((e) => [e.time, e.title, e.past])).toEqual([
			['6:30 am', 'Early swim', true],
			['3:30 pm', 'Dentist', false]
		]);
		// Five things on Friday: three shown and "+2 more".
		expect(by('2026-11-06').events).toHaveLength(3);
		expect(by('2026-11-06').more).toBe(2);
		// Ari's own calendar carries his glyph.
		expect(by('2026-11-07').events[0]).toMatchObject({ title: 'Party', icon: 'star' });
		expect(by('2026-11-08').events).toEqual([{ time: null, title: 'Pay rates', icon: null, kind: 'todo', past: false }]);
		expect(g.nextWeek.count).toBe(1);
		expect(g.nextWeek.events[0]).toMatchObject({ weekday: 'Tue', title: 'Next week thing' });
	});

	it('no calendar folder: the week still shows dated to-dos', async () => {
		const db = await seededDb();
		const g = weekGrid(db, undefined, TZ, '2026-11-05', NOW);
		expect(g.calendar).toBe(false);
		expect(g.week).toHaveLength(7);
	});

	it('kids: the running routine with its steps and count; a tick from the board shows', async () => {
		const db = await seededDb();
		const v = boardView(db, { tz: TZ, now: NOW });
		expect(v.date).toBe('2026-11-05');
		expect(v.kids).toHaveLength(1);
		const ari = v.kids[0];
		expect(ari.dayType?.name).toBe('Home');
		expect(ari.routine).toMatchObject({ name: 'Morning', state: 'now', done: 0 });
		expect(ari.routine!.steps.map((s) => s.title)).toEqual(['Get dressed', 'Breakfast', 'Brush teeth']); // home day: no bag, shoes, hat
		expect(ari.next).toMatchObject({ name: 'Bedtime' });
		setStepState(db, ari.routine!.steps[0].id, true, 'board', NOW);
		const again = boardView(db, { tz: TZ, now: NOW }).kids[0].routine!;
		expect(again.done).toBe(1);
		expect(again.steps[0].done).toBe(true);
		const morning = db.select().from(routineTemplate).where(eq(routineTemplate.name, 'Morning')).get()!;
		const occ = getOrCreateOccurrence(db, morning, '2026-11-05', NOW);
		expect(occurrenceSteps(db, occ.id)[0].completedBy).toBe('board');
	});

	it('kids: between routines the next one shows as "soon" with its steps; after the last, nothing more', async () => {
		const db = await seededDb();
		const midday = boardView(db, { tz: TZ, now: perth('2026-11-05', '12:00') }).kids[0];
		expect(midday.routine).toMatchObject({ name: 'Bedtime', state: 'soon' });
		expect(midday.next).toBeNull();
		const late = boardView(db, { tz: TZ, now: perth('2026-11-05', '23:30') }).kids[0];
		expect(late.routine?.state ?? late.next).toBeDefined();
	});

	it('an inactive child is left out; a baby shows the plan summary', async () => {
		const db = await seededDb();
		db.update(member).set({ active: false }).run();
		db.insert(member).values({ name: 'Juno', shortLabel: 'JUN', kind: 'baby', sort: 1, icon: 'baby', displayMode: 'picture' }).run();
		const v = boardView(db, { tz: TZ, now: NOW });
		expect(v.kids).toEqual([]);
		expect(v.baby).toBeNull(); // no plan set up yet
	});
});
