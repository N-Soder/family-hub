// The wall's front buttons (ADR-28): right = next screen, left = previous, middle = home.
// The cycle is Home → Lists → Home (routines are on the iPad, not the wall). Touch is off on
// the wall; Tesserae sends each press to /api/button as a webhook.

import type { DB } from '../db';
import { stopIndex, wallStops, type BuildOptions, type WallStop } from './render';
import { wallScreens, type WallScreens } from './screens';

export const WALL_BUTTONS = ['next', 'prev', 'home'] as const;
export type WallButton = (typeof WALL_BUTTONS)[number];

export function applyButton(
	db: DB,
	deviceId: string,
	_page: string,
	button: WallButton,
	opts: BuildOptions = {},
	screens: WallScreens = wallScreens
): { from: WallStop; to: WallStop } {
	const now = opts.now ?? new Date();
	const stops = wallStops(db);
	// A screen that is not a stop (an old routines screen) counts as Home.
	const at = stopIndex(stops, screens.get(deviceId, now), screens.member(deviceId, now));
	const to = button === 'home' ? 0 : (at + (button === 'next' ? 1 : -1) + stops.length) % stops.length;
	const stop = stops[to];
	screens.set(deviceId, stop.screen, now, stop.member);
	return { from: stops[at], to: stop };
}
