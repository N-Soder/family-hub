import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { BOARD_COOKIE, redeemPairingCode } from '$lib/server/auth/board';
import { RateLimiter } from '$lib/server/auth/device';
import { pairForm, parseForm } from '$lib/server/forms';

// Pair this browser as a Board screen with the code from Planner → Settings → Board (ADR-30).
const attempts = new RateLimiter(10, 60_000);

export const load: PageServerLoad = ({ locals }) => {
	if (locals.board) redirect(303, '/board');
	return { adult: locals.adult };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		if (!attempts.allow(getClientAddress())) return fail(429, { error: 'Too many tries. Wait a minute.' });
		const p = parseForm(pairForm, await request.formData());
		if (!p.success) return fail(400, { error: 'Type the six-digit code shown in Settings.' });
		const res = redeemPairingCode(db(), p.data.code, p.data.name);
		if (!res.ok) {
			return fail(401, { error: res.reason === 'none' ? 'No code is open. Ask for a new one in Planner → Settings → Board.' : 'That code is not right.' });
		}
		const https = request.headers.get('x-forwarded-proto') === 'https';
		cookies.set(BOARD_COOKIE, res.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: https, maxAge: 400 * 24 * 3600 });
		redirect(303, '/board');
	}
};
