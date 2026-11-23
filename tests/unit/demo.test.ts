import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/lib/server/db';
import { list, listItem, member } from '../../src/lib/server/db/schema';
import { seedDemo, writeDemoCalendar } from '../../src/lib/server/demo';
import { calendarView } from '../../src/lib/server/domain/calendar';
import { perth } from '../helpers';

const TZ = 'Australia/Perth';
const NOW = perth('2026-11-23', '07:20');

describe('demo household (npm run demo)', () => {
	it('fills an empty database once: five members, one Shopping list, dates relative to today', async () => {
		const db = openDb(':memory:');
		expect(await seedDemo(db, { now: NOW, tz: TZ, pin: '123456' })).toBe(true);
		expect(db.select().from(member).all().map((m) => m.name)).toEqual(['Ari', 'Nora', 'Juno', 'Mum', 'Dad']);
		expect(db.select().from(list).all().filter((l) => l.name === 'Shopping')).toHaveLength(1);
		const gutters = db.select().from(listItem).all().find((i) => i.title === 'Clean the gutters');
		expect(gutters?.dueDate).toBe('2026-11-21');
		expect(await seedDemo(db, { now: NOW, tz: TZ })).toBe(false); // never touches a used database
		expect(db.select().from(member).all()).toHaveLength(5);
	});

	it('writes calendar feeds the Planner reads like Tesserae’s', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-demo-cal-'));
		writeDemoCalendar(dir, { now: NOW, tz: TZ });
		const v = calendarView(dir, TZ, NOW);
		expect(v.connected).toBe(true);
		expect(v.today.map((e) => e.title)).toEqual(['Swim lessons', 'Ballet', 'Bins out']);
	});
});
