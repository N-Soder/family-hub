import type { DB } from './db';
import { dayType, member, routineStep, routineTemplate, weeklyPattern } from './db/schema';
import { pinIsSet, setPin } from './auth/planner';
import { setSetting, getSetting } from './settings';

/** Demo household: one child, morning + bedtime routines, three day types. Idempotent. */
export async function seed(db: DB, opts: { pin?: string } = {}): Promise<{ seeded: boolean }> {
	if (opts.pin && !pinIsSet(db)) await setPin(db, opts.pin);
	if (getSetting(db, 'seeded', false) || db.select().from(member).get()) return { seeded: false };
	db.transaction((tx) => {
		const [home, daycare, swimming] = ['home', 'daycare', 'swimming'].map(
			(name, i) =>
				tx
					.insert(dayType)
					.values({ name: name[0].toUpperCase() + name.slice(1), glyph: ['home', 'school', 'swim'][i], sort: i })
					.returning()
					.get().id
		);
		const child = tx
			.insert(member)
			.values({ name: 'Ari', shortLabel: 'ARI', kind: 'child', sort: 0, icon: 'star', displayMode: 'picture' })
			.returning()
			.get();
		// Sun..Sat
		[home, daycare, swimming, daycare, home, daycare, home].forEach((dt, weekday) =>
			tx.insert(weeklyPattern).values({ memberId: child.id, weekday, dayTypeId: dt }).run()
		);
		const morning = tx
			.insert(routineTemplate)
			.values({ memberId: child.id, name: 'Morning', kind: 'morning', windowStart: '06:30', windowEnd: '09:00' })
			.returning()
			.get();
		const steps: Array<[string, string, number[] | null]> = [
			['Get dressed', 'shirt', null],
			['Breakfast', 'apple', null],
			['Brush teeth', 'tooth', null],
			['Shoes on', 'shoe', [daycare, swimming]],
			['Pack bag', 'bag', [daycare]],
			['Hat and sunscreen', 'hat', [daycare, swimming]]
		];
		steps.forEach(([title, icon, types], sort) =>
			tx.insert(routineStep).values({ templateId: morning.id, title, icon, sort, dayTypeIdsJson: types ? JSON.stringify(types) : null }).run()
		);
		const bedtime = tx
			.insert(routineTemplate)
			.values({ memberId: child.id, name: 'Bedtime', kind: 'bedtime', windowStart: '18:30', windowEnd: '21:00' })
			.returning()
			.get();
		['Bath:bath', 'Pyjamas:shirt', 'Brush teeth:tooth', 'Toilet:toilet', 'Story:book', 'Lights out:moon'].forEach((s, sort) => {
			const [title, icon] = s.split(':');
			tx.insert(routineStep).values({ templateId: bedtime.id, title, icon, sort }).run();
		});
	});
	setSetting(db, 'seeded', true);
	return { seeded: true };
}
