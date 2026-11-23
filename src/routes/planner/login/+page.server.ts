import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { login, logout, pinIsSet, safeNext, SESSION_COOKIE } from '$lib/server/auth/planner';
import { loginForm, parseForm } from '$lib/server/forms';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.adult) redirect(303, '/planner');
	return { pinSet: pinIsSet(db()) };
};

export const actions: Actions = {
	login: async ({ request, cookies, url }) => {
		// adapter-node reports https for every request, so ask the proxy instead: Cloudflare sets
		// X-Forwarded-Proto. Plain-HTTP LAN gets a non-Secure cookie, which phones then keep.
		const https = request.headers.get('x-forwarded-proto') === 'https';
		const parsed = parseForm(loginForm, await request.formData());
		if (!parsed.success) return fail(400, { error: 'Enter your PIN' });
		const res = await login(db(), parsed.data.pin);
		if (!res.ok) {
			const message =
				res.reason === 'locked'
					? `Too many attempts. Try again after ${new Date(res.lockedUntil!).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.`
					: res.reason === 'no_pin'
						? 'No PIN is set. Set ADMIN_PIN and run the seed.'
						: 'Wrong PIN';
			return fail(res.reason === 'locked' ? 429 : 401, { error: message });
		}
		cookies.set(SESSION_COOKIE, res.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: https, maxAge: 30 * 24 * 3600 });
		redirect(303, safeNext(url.searchParams.get('next'), url.origin));
	},
	logout: ({ cookies, locals }) => {
		logout(db(), cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		// Signed in by Cloudflare Access: end that session too (handled at Cloudflare's edge).
		redirect(303, locals.adultVia === 'cloudflare' ? '/cdn-cgi/access/logout' : '/planner/login');
	}
};
