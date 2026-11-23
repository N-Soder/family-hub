import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { changePin, revokeSessions, SESSION_COOKIE } from '$lib/server/auth/planner';
import { fieldErrors, parseForm, pinForm } from '$lib/server/forms';
import { env } from '$lib/server/env';
import { hub } from '$lib/server/hub';
import { findPlaces, placeSchema, setWeatherPlace, weatherCache, weatherPlace } from '$lib/server/weather';
import { boardSessions, cancelPairingCode, currentPairingCode, issuePairingCode, unpairBoard } from '$lib/server/auth/board';
import { unpairForm } from '$lib/server/forms';

export const load: PageServerLoad = ({ locals, url }) => ({
	tz: env().TZ_HOUSEHOLD,
	rollover: env().DAY_ROLLOVER,
	// The simulator is LAN-only (404 through the tunnel, ADR-17). A PIN session means LAN.
	lan: locals.adultVia === 'pin',
	place: weatherPlace(db()),
	weather: weatherCache.get(new Date(), env().TZ_HOUSEHOLD),
	// Board screens (ADR-30): paired browsers and the code open for pairing, if any.
	boards: boardSessions(db()).map((b) => ({ hash: b.tokenHash, name: b.name, since: b.createdAt, seen: b.lastSeenAt })),
	pairCode: currentPairingCode(db()),
	boardUrl: `${url.host}/board`
});

const findForm = z.object({ q: z.string().trim().min(2, 'Type a suburb or town').max(80) });

/** A new place (or none): fetch its forecast now and repaint the walls' home screen. */
async function placeChanged(): Promise<void> {
	await weatherCache.refresh(weatherPlace(db()), new Date(), env().TZ_HOUSEHOLD, true);
	void hub().repainter.notify([], { full: true, screen: 'home' });
}

export const actions: Actions = {
	pin: async ({ request, cookies }) => {
		const p = parseForm(pinForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		const res = await changePin(db(), p.data.current, p.data.pin, cookies.get(SESSION_COOKIE));
		if (!res.ok) {
			const current =
				res.reason === 'locked'
					? `Too many attempts. Try again after ${new Date(res.lockedUntil!).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.`
					: 'Current PIN is wrong';
			return fail(res.reason === 'locked' ? 429 : 400, { errors: { current } });
		}
		return { saved: 'PIN changed. Other phones signed in with the PIN are signed out.' };
	},
	/** Lost phone: end every PIN session, this one too. */
	signOutAll: ({ cookies, locals }) => {
		revokeSessions(db());
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, locals.adultVia === 'cloudflare' ? '/cdn-cgi/access/logout' : '/planner/login');
	},
	weatherFind: async ({ request }) => {
		const p = parseForm(findForm, await request.formData());
		if (!p.success) return fail(400, { weatherError: Object.values(fieldErrors(p.error))[0] });
		try {
			const places = await findPlaces(p.data.q, env().TZ_HOUSEHOLD);
			if (!places.length) return fail(404, { weatherError: `Nothing found for “${p.data.q}”`, q: p.data.q });
			return { places, q: p.data.q };
		} catch {
			return fail(502, { weatherError: 'Could not reach the weather service. Try again.', q: p.data.q });
		}
	},
	weatherSet: async ({ request }) => {
		const p = parseForm(placeSchema, await request.formData());
		if (!p.success) return fail(400, { weatherError: 'Pick a place from the list' });
		setWeatherPlace(db(), p.data);
		await placeChanged();
		return { weatherSaved: true };
	},
	weatherClear: async () => {
		setWeatherPlace(db(), null);
		await placeChanged();
		return { weatherSaved: true };
	},
	boardCode: async () => {
		issuePairingCode(db());
		return { boardCode: true };
	},
	boardCancel: async () => {
		cancelPairingCode(db());
		return { boardCode: false };
	},
	boardUnpair: async ({ request }) => {
		const p = parseForm(unpairForm, await request.formData());
		if (!p.success || !unpairBoard(db(), p.data.hash)) return fail(400, { boardError: 'That screen is already gone.' });
		return { boardUnpaired: true };
	}
};
