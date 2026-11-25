import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { DB } from './db';
import { dayType, giftIdea, giftPerson, list, listItem, listShop, member, note, routineStep, routineTemplate, weeklyPattern } from './db/schema';
import { seed } from './seed';
import { setWeatherPlace } from './weather';
import { addDays, localParts } from './domain/time';

// A made-up household for trying Family Hub without real data (`npm run demo`) and for the
// README screenshots: two children and a baby, two adults, routines, lists, gifts, notes,
// a weather place and a week of calendar events. Dates are relative to `now`.

/** Fills an empty database with the demo household. Returns false if it already has members. */
export async function seedDemo(db: DB, opts: { now?: Date; tz: string; pin?: string }): Promise<boolean> {
	const res = await seed(db, { pin: opts.pin });
	if (!res.seeded) return false;
	const now = opts.now ?? new Date();
	const iso = now.toISOString();
	const today = localParts(now, opts.tz).date;
	const day = (n: number) => addDays(today, n);

	db.transaction((tx) => {
		const types = Object.fromEntries(tx.select().from(dayType).all().map((t) => [t.name, t.id]));
		const routine = (memberId: number, name: string, kind: 'morning' | 'bedtime', start: string, end: string, steps: string[]) => {
			const t = tx.insert(routineTemplate).values({ memberId, name, kind, windowStart: start, windowEnd: end }).returning().get();
			steps.forEach((s, sort) => {
				const [title, icon] = s.split(':');
				tx.insert(routineStep).values({ templateId: t.id, title, icon, sort }).run();
			});
		};

		// The seed's child is Ari; Nora is older and has her own routines.
		const nora = tx.insert(member).values({ name: 'Nora', shortLabel: 'NORA', kind: 'child', sort: 1, icon: 'heart', displayMode: 'picture' }).returning().get();
		[types.Home, types.Daycare, types.Daycare, types.Daycare, types.Swimming, types.Daycare, types.Home].forEach((dt, weekday) =>
			tx.insert(weeklyPattern).values({ memberId: nora.id, weekday, dayTypeId: dt }).run()
		);
		routine(nora.id, 'Morning', 'morning', '06:30', '09:00', ['Make bed:bed', 'Get dressed:shirt', 'Breakfast:bowl', 'Brush teeth:tooth', 'Brush hair:brush', 'Shoes on:shoe', 'Pack bag:bag']);
		routine(nora.id, 'Bedtime', 'bedtime', '18:30', '21:00', ['Tidy toys:package', 'Bath:bath', 'Pyjamas:shirt', 'Brush teeth:tooth', 'Story:book', 'Lights out:moon']);

		// A baby's day plan: fixed times, steps timed from earlier ones, and a nap timer.
		const juno = tx.insert(member).values({ name: 'Juno', shortLabel: 'JUNO', kind: 'baby', sort: 2, icon: 'baby' }).returning().get();
		const plan = tx.insert(routineTemplate).values({ memberId: juno.id, name: '6–9 months', kind: 'plan', windowStart: '00:00', windowEnd: '23:59' }).returning().get();
		const step = (sort: number, title: string, icon: string, rule: Partial<typeof routineStep.$inferInsert>) =>
			tx.insert(routineStep).values({ templateId: plan.id, title, icon, sort, ...rule }).returning().get().id;
		const woke = step(0, 'Woke up', 'sun', { dueAt: '06:30' });
		const milk = step(1, 'Milk', 'bottle', { dueAt: '06:45' });
		step(2, 'Breakfast', 'bowl', { dueAfterStepId: milk, dueAfterMin: 60 });
		const nap = step(3, 'Nap', 'moon', { dueAfterStepId: woke, dueAfterMin: 150, timer: true, usualMin: 90 });
		step(4, 'Milk', 'bottle', { dueAfterStepId: nap, dueAfterMin: 15 });
		step(5, 'Lunch', 'bowl', { dueAt: '12:00' });
		step(6, 'Bath', 'bath', { dueAt: '18:00' });
		step(7, 'Bedtime', 'bed', { dueAt: '18:45' });

		tx.insert(member).values({ name: 'Mum', shortLabel: 'MUM', kind: 'adult', sort: 3, icon: 'face' }).run();
		tx.insert(member).values({ name: 'Dad', shortLabel: 'DAD', kind: 'adult', sort: 4, icon: 'star' }).run();

		type Item = string | Partial<typeof listItem.$inferInsert>;
		const fill = (listId: number, items: Item[]) =>
			items.forEach((it, sort) => tx.insert(listItem).values({ listId, sort, createdAt: iso, title: '', ...(typeof it === 'string' ? { title: it } : it) }).run());
		const newList = (name: string, kind: 'grocery' | 'todo' | 'other', icon: string, sort: number) =>
			tx.insert(list).values({ name, kind, icon, sort, createdAt: iso }).returning().get().id;

		// Migration 0002 creates the Shopping list; fill that one rather than add a second.
		const shopping = tx.select().from(list).where(eq(list.name, 'Shopping')).get()?.id ?? newList('Shopping', 'grocery', 'cart', 0);
		fill(shopping, [
			'Milk', 'Bread', 'Bananas', 'Weet-Bix', { title: 'Nappies', notes: 'Size 4' }, 'Avocados', 'Yoghurt pouches', 'Sunscreen',
			{ title: 'Eggs', doneAt: iso, doneBy: 'planner' }, { title: 'Coffee beans', doneAt: iso, doneBy: 'planner' }
		]);
		// Two shops (ADR-41): nappies and sunscreen from the warehouse, avocados from the grocer.
		const shop = (name: string, tone: number, sort: number, titles: string[]) => {
			const id = tx.insert(listShop).values({ listId: shopping, name, tone, sort }).returning().get().id;
			for (const t of titles) tx.update(listItem).set({ shopId: id }).where(and(eq(listItem.listId, shopping), eq(listItem.title, t))).run();
		};
		shop('Grocer', 1, 0, ['Avocados', 'Bananas']);
		shop('Warehouse', 4, 1, ['Nappies', 'Sunscreen']);
		fill(newList('House', 'todo', 'home', 1), [
			{ title: 'Clean the gutters', dueDate: day(-2) },
			{ title: 'Pay council rates', dueDate: day(2), notes: 'Reference on the fridge' },
			{ title: 'Water the veggie patch', dueDate: day(0), repeatEvery: 2, repeatUnit: 'day', repeatMode: 'after' },
			{ title: 'Return library books', nowSince: iso },
			{ title: 'Change the pool filter', dueDate: day(9), repeatEvery: 1, repeatUnit: 'month', repeatMode: 'fixed', repeatAnchor: day(9) },
			{ title: 'Test smoke alarms', dueDate: day(98), repeatEvery: 1, repeatUnit: 'year', repeatMode: 'fixed', repeatAnchor: day(98) },
			'Fix the wobbly gate',
			'Hang the hallway photos'
		]);
		fill(newList('School & daycare', 'todo', 'school', 2), [
			{ title: 'Sign excursion form', dueDate: day(1) },
			{ title: 'Crazy hat day', dueDate: day(4), notes: 'Nora' },
			{ title: 'Spare clothes in daycare bag', nowSince: iso },
			'Name labels on new jumpers'
		]);
		fill(newList('Holiday packing', 'other', 'package', 3), ['Swimmers', 'Beach towels', 'Travel cot', 'Chargers', 'Snacks for the car']);

		const person = (name: string, birthday: string, ideas: Array<[string, number, 'idea' | 'bought']>) => {
			const p = tx.insert(giftPerson).values({ name, birthday, createdAt: iso }).returning().get();
			for (const [title, price, status] of ideas)
				tx.insert(giftIdea).values({ personId: p.id, title, price, status, createdAt: iso, ...(status === 'bought' ? { boughtAt: iso } : {}) }).run();
		};
		person('Grandma', '12-14', [['Photo book of the kids', 60, 'idea'], ['Garden centre voucher', 50, 'idea']]);
		person('Ari', '01-09', [['Balance bike', 129, 'bought'], ['Dinosaur puzzle', 25, 'idea'], ['Swim goggles', 15, 'idea']]);
		person('Nora', '06-20', [['Art set', 35, 'idea'], ['Ballet shoes', 40, 'idea']]);

		tx.insert(note).values({ title: 'Babysitter notes', body: 'Bedtime 7 pm for Ari, 7:30 for Nora.\nJuno: bottle in the fridge, warm for 30 s.\nSpare key with the neighbours.', createdAt: iso, updatedAt: iso }).run();
		tx.insert(note).values({ title: 'Holiday ideas', body: 'Day trip to the island\nZoo (annual pass?)\nCamping weekend', createdAt: iso, updatedAt: iso }).run();
	});
	setWeatherPlace(db, { name: 'Perth, Western Australia', lat: -31.9522, lon: 115.8614 });
	return true;
}

/**
 * Writes demo calendar feeds in the layout of Tesserae's calendar_core folder (feeds.json +
 * feed_<id>.ics), so the Planner and Board show events without Tesserae (`CALENDAR_DIR`).
 */
export function writeDemoCalendar(dir: string, opts: { now?: Date; tz: string }): void {
	const today = localParts(opts.now ?? new Date(), opts.tz).date;
	const d = (n: number) => addDays(today, n).replaceAll('-', '');
	const at = (n: number, from: string, to: string) => [`DTSTART;TZID=${opts.tz}:${d(n)}T${from}00`, `DTEND;TZID=${opts.tz}:${d(n)}T${to}00`];
	const allDay = (n: number, days: number) => [`DTSTART;VALUE=DATE:${d(n)}`, `DTEND;VALUE=DATE:${d(n + days)}`];
	const ev = (uid: string, lines: string[], summary: string) => ['BEGIN:VEVENT', `UID:${uid}@demo`, 'DTSTAMP:20260101T000000Z', ...lines, `SUMMARY:${summary}`, 'END:VEVENT'];
	const ics = (events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Hub//demo//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
	const family = ics([
		ev('swim', [...at(0, '1530', '1600'), 'LOCATION:Aquatic centre'], 'Swim lessons'),
		ev('bins', at(0, '1900', '1915'), 'Bins out'),
		ev('playgroup', at(1, '0930', '1100'), 'Playgroup'),
		ev('dentist', at(2, '1000', '1045'), 'Dentist (Ari)'),
		ev('grandma', allDay(3, 2), 'Grandma staying'),
		ev('party', [...at(5, '1400', '1600'), 'LOCATION:Community hall'], 'Mila’s 5th birthday party'),
		ev('market', at(6, '0800', '0930'), 'Farmers market'),
		ev('concert', at(11, '1800', '1930'), 'End of year concert')
	]);
	const nora = ics([ev('ballet', at(0, '1630', '1715'), 'Ballet'), ev('ballet2', at(3, '1630', '1715'), 'Ballet')]);
	fs.mkdirSync(dir, { recursive: true });
	const feed = (id: string, name: string) => ({ id, name, url: `https://example.invalid/${id}.ics`, enabled: true });
	fs.writeFileSync(path.join(dir, 'feeds.json'), JSON.stringify({ feeds: [feed('family', 'Family'), feed('nora', 'Nora')] }, null, '\t'));
	fs.writeFileSync(path.join(dir, 'feed_family.ics'), family);
	fs.writeFileSync(path.join(dir, 'feed_nora.ics'), nora);
}
