import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { seededDb, perth, withDevice } from '../helpers';
import { renderForDevice } from '../../src/lib/server/domain/render';
import { painterSource } from '../../src/lib/server/tesserae/page';
import type { WallBlock, WallWeather } from '../../src/lib/server/weather';

// What Home paints (ADR-36): the weather in four blocks with chips, and every Agenda day,
// empty ones as just the date.

const MORNING = perth('2026-11-14', '06:15');

function paint(payload: unknown, extra: Record<string, unknown> = {}): string {
	let html = '';
	const root = { set innerHTML(v: string) { html = v; }, get innerHTML() { return html; }, querySelector: () => null };
	const ctx = vm.createContext({ console, Intl, Date, Math, JSON, String, Number, Object, Array });
	vm.runInContext(painterSource(), ctx);
	(ctx.paintWall as (r: unknown, d: unknown, o: unknown) => void)(root, { hub: { payload }, ...extra }, {});
	return html;
}

const block = (over: Partial<WallBlock>): WallBlock => ({ name: 'Morning', hours: '6–9', icon: 'wxSun', label: 'Sunny', temp: 16, wind: { from: 'E', level: 1 }, rain: null, uv: null, ...over });
const weather = (blocks: WallBlock[] | null) =>
	({ icon: 'wxSun', label: 'Sunny', temp: 16, high: 30, low: 16, uv: 11, uvLevel: 3, rain: null, rainChance: null, wind: null, blocks }) satisfies WallWeather;

async function home(w: WallWeather | null, extra: Record<string, unknown> = {}) {
	const db = await seededDb();
	withDevice(db, 'wall-1');
	return paint(renderForDevice(db, 'wall-1', 'home', { now: MORNING, screen: 'home', member: null, weather: w }), extra);
}

describe('home: weather blocks', () => {
	it('one block per part of the day; wind always, rain and UV only when given; black for level 3', async () => {
		const html = await home(weather([
			block({}),
			block({ name: 'Midday', hours: '9–3', temp: 30, wind: { from: 'SW', level: 3 }, uv: { index: 11, level: 3 } }),
			block({ name: 'Arvo', hours: '3–6', temp: 27, wind: { from: 'SW', level: 2 }, rain: { pct: 40, level: 1 }, uv: { index: 8, level: 2 } })
		]));
		expect(html.match(/class="fh-wx-b"/g)).toHaveLength(3);
		expect(html).toContain('<b>Midday</b><small>9–3</small>');
		expect(html).toContain('<b>30°</b>');
		expect(html.match(/class="fh-chip quiet"/g)).toHaveLength(1); // the light easterly
		expect(html.match(/class="fh-chip hot"/g)).toHaveLength(2); // strong SW, UV 11
		expect(html).toContain('40%');
		expect(html).toContain('UV 8');
		expect(html).not.toContain('UV 6');
	});

	it('no blocks (no place set, or an old forecast) → no band', async () => {
		expect(await home(weather(null))).not.toContain('class="fh-wx"');
		expect(await home(null)).not.toContain('class="fh-wx"');
	});
});

describe('home: agenda', () => {
	it('lists every day after today, empty ones as just the date', async () => {
		const ev = { summary: 'Dentist', start: '2026-11-17T15:30:00+08:00', all_day: false };
		const week = { days: [
			{ date: '2026-11-14', is_today: true, events: [] },
			{ date: '2026-11-15', events: [] },
			{ date: '2026-11-16', events: [] },
			{ date: '2026-11-17', events: [ev] }
		] };
		const html = await home(null, { week, today: { events: [] } });
		expect(html.match(/class="fh-wk-row"/g)).toHaveLength(3);
		expect(html).toContain('15 Nov');
		expect(html).toContain('16 Nov');
		expect(html).toContain('Dentist');
	});
});
