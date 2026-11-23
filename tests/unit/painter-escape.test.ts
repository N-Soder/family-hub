import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { seededDb, perth, withDevice } from '../helpers';
import { member, routineStep, routineTemplate } from '../../src/lib/server/db/schema';
import { addItem, createList, setNow, setSchedule } from '../../src/lib/server/domain/lists';
import { renderForDevice } from '../../src/lib/server/domain/render';
import { painterSource } from '../../src/lib/server/tesserae/page';

// Regression test for the wall painter's escaping (audit, testing gaps): hostile text in every
// field a person or a calendar feed controls must reach the wall as text, never as markup.

const EVIL = `<img src=x onerror="alert(1)">'&`;
const MORNING = perth('2026-11-02', '07:00'); // Monday, Ari's morning routine is on

/** Run the painter as /sim does, against a root that records the HTML it is given. */
function paint(payload: unknown, extra: Record<string, unknown> = {}): string {
	let html = '';
	const root = { set innerHTML(v: string) { html = v; }, get innerHTML() { return html; }, querySelector: () => null };
	const ctx = vm.createContext({ console, Intl, Date, Math, JSON, String, Number, Object, Array });
	vm.runInContext(painterSource(), ctx);
	(ctx.paintWall as (r: unknown, d: unknown, o: unknown) => void)(root, { hub: { payload }, ...extra }, {});
	return html;
}

describe('wall painter escaping', () => {
	it('shows hostile names, titles, calendar text and weather as text on every screen', async () => {
		const db = await seededDb();
		withDevice(db, 'wall-1');
		db.update(member).set({ name: EVIL }).run();
		db.update(routineTemplate).set({ name: EVIL }).run();
		db.update(routineStep).set({ title: EVIL }).run();
		const list = createList(db, { name: EVIL, kind: 'todo', icon: 'home' }, MORNING);
		const item = addItem(db, list, EVIL, MORNING).itemId;
		setNow(db, item, true, MORNING);
		setSchedule(db, addItem(db, list, EVIL, MORNING).itemId, { due: '2026-11-04', repeat: null, leadDays: null }, MORNING);

		const weather = { icon: 'sun', label: EVIL, temp: 20, high: 25, low: 12, rain: EVIL, wind: { from: EVIL, toward: 90, kmh: 20, change: { from: EVIL, toward: 0, kmh: 30, at: EVIL } },
			blocks: [{ name: EVIL, hours: EVIL, icon: EVIL, label: EVIL, temp: 20, wind: { from: EVIL, level: 3 }, rain: { pct: 40, level: 1 }, uv: { index: 11, level: 3 } }] };
		const event = { summary: EVIL, location: EVIL, feed: EVIL, start: '2026-11-02T09:00:00+08:00', all_day: false };
		const calendar = {
			today: { events: [event, { ...event, all_day: true, start: '2026-11-02' }] },
			week: { days: [{ date: '2026-11-02', is_today: true, events: [] }, { date: '2026-11-03', events: [event] }] }
		};

		for (const screen of ['home', 'lists', 'routines'] as const) {
			const payload = renderForDevice(db, 'wall-1', 'home', { now: MORNING, screen, member: null, weather: weather as never });
			const html = paint(payload, screen === 'home' ? calendar : {});
			expect(html, screen).not.toContain('<img');
			expect(html, screen).not.toContain('onerror="');
			expect(html.split('&lt;img').length - 1, `${screen}: hostile text shown`).toBeGreaterThan(screen === 'lists' ? 1 : 2);
		}
	});

	it('escapes the offline message too', () => {
		const html = paint(undefined, { hub: { error: EVIL } });
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});
});
