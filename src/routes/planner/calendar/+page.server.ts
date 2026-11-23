import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { members } from '$lib/server/planner';
import { env } from '$lib/server/env';
import { calendarView } from '$lib/server/domain/calendar';

// The wall's calendar on the phone: Today and Coming up (ADR-19, read from Tesserae's feeds).
export const load: PageServerLoad = () => {
	const now = new Date();
	const tz = env().TZ_HOUSEHOLD;
	return {
		calendar: calendarView(env().CALENDAR_DIR, tz, now),
		// Events from a calendar named after a member carry that member's glyph, as on the wall.
		people: members(db()).map((m) => ({ name: m.name, icon: m.icon })),
		dateLabel: new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now)
	};
};
