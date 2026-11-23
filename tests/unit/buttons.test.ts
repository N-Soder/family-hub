import { describe, expect, it } from 'vitest';
import { seededDb, perth, withDevice } from '../helpers';
import { renderForDevice, wallStops } from '../../src/lib/server/domain/render';
import { applyButton } from '../../src/lib/server/domain/buttons';
import { WallScreens } from '../../src/lib/server/domain/screens';

// The wall's side buttons (ADR-28, ADR-35): the wall shows Home only, so every button
// repaints Home. Routines are on the iPad (ADR-27); lists on phones.

const NOON = perth('2026-11-02', '12:00');

async function setup() {
	const db = await seededDb(); // Ari (child) and the Shopping list
	withDevice(db, 'wall-1');
	const screens = new WallScreens();
	const press = (b: 'next' | 'prev' | 'home') => applyButton(db, 'wall-1', 'home', b, { now: NOON }, screens).to.label;
	const render = () => renderForDevice(db, 'wall-1', 'home', { now: NOON, screen: screens.get('wall-1', NOON), member: screens.member('wall-1', NOON) });
	return { db, screens, press, render };
}

describe('wall side buttons', () => {
	it('Home is the only stop, even with lists', async () => {
		const { db } = await setup();
		expect(wallStops(db).map((s) => s.label)).toEqual(['Home']);
	});

	it('every button lands on Home', async () => {
		const { press, render } = await setup();
		expect([press('next'), press('prev'), press('home')]).toEqual(['Home', 'Home', 'Home']);
		expect(render().screen).toBe('home');
	});

	it('a wall left on an old lists or routines screen goes back to Home', async () => {
		const { screens, press, render } = await setup();
		screens.set('wall-1', 'lists', NOON);
		expect(press('next')).toBe('Home');
		expect(render().screen).toBe('home');
		screens.set('wall-1', 'routines', NOON);
		expect(press('prev')).toBe('Home');
	});

	it('the page strip has one entry, which the painter skips', async () => {
		const { render } = await setup();
		expect(render().pages).toEqual([{ label: 'Home', on: true }]);
	});
});
