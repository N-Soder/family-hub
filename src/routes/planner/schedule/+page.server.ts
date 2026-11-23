import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { dayType } from '$lib/server/db/schema';
import { dayTypes, patternDayAction, scheduleOverview, stepCountsByDayType, syncCalendarDays, today } from '$lib/server/planner';
import { weekdayOf } from '$lib/server/domain/time';
import { dayTypeForm, fieldErrors, parseForm } from '$lib/server/forms';

export const load: PageServerLoad = () => {
	const now = new Date();
	// Read the calendar now so the page shows the days it sets (ADR-29).
	const cal = syncCalendarDays(db(), now);
	const label = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
	return {
		dayTypes: dayTypes(db()),
		children: scheduleOverview(db()),
		stepCounts: stepCountsByDayType(db()),
		todayWeekday: weekdayOf(today(now)),
		calendar: {
			connected: cal.connected,
			error: cal.error,
			today: today(now),
			days: cal.days.map((d) => ({
				...d,
				label: label.format(new Date(`${d.date}T00:00:00Z`)),
				hidden: cal.overridden.some((o) => o.memberId === d.memberId && o.date === d.date)
			}))
		}
	};
};

export const actions: Actions = {
	patternDay: patternDayAction,
	add: async ({ request }) => {
		const p = parseForm(dayTypeForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		db().insert(dayType).values({ ...p.data, sort: dayTypes(db()).length }).run();
		return { saved: `Added “${p.data.name}”.` };
	},
	save: async ({ request }) => {
		const form = await request.formData();
		const id = parseForm(z.object({ id: z.coerce.number().int().positive() }), form);
		const p = parseForm(dayTypeForm, form);
		if (!id.success || !p.success) return fail(400, { errors: p.success ? { form: 'Bad id' } : fieldErrors(p.error) });
		db().update(dayType).set(p.data).where(eq(dayType.id, id.data.id)).run();
		return { saved: 'Day type saved.' };
	}
};
