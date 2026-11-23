import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { SESSION_COOKIE, validSession } from '$lib/server/auth/planner';
import { startHub } from '$lib/server/hub';
import { env } from '$lib/server/env';
import { accessToken, accessVerifier } from '$lib/server/auth/cf-access';
import { BOARD_COOKIE, validBoardSession } from '$lib/server/auth/board';

let verifyAccess: ReturnType<typeof accessVerifier> | null | undefined;
function accessCheck() {
	if (verifyAccess === undefined) {
		const { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: aud } = env();
		verifyAccess = teamDomain && aud ? accessVerifier({ teamDomain, aud }) : null;
	}
	return verifyAccess;
}

export const init: ServerInit = async () => {
	if (process.env.FAMILY_HUB_NO_HUB !== '1') await startHub();
};

// Paths that need an adult session. Device APIs authenticate with bearer tokens instead.
const ADULT = [/^\/planner(?!\/login)/, /^\/sim/];
// Paths a paired Board screen may use as well (ADR-30).
const ADULT_OR_BOARD = [/^\/board(?!\/pair)/, /^\/api\/events/];

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** CSRF: a browser form post must come from a page on this same host (any LAN address works). */
export function crossSiteForm(request: Request, url: URL): boolean {
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
	const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
	if (!FORM_TYPES.includes(type)) return false;
	const origin = request.headers.get('origin');
	try {
		return !origin || new URL(origin).host !== url.host;
	} catch {
		return true;
	}
}

/**
 * Basic hardening on every response (audit L6). Referrer-Policy is `same-origin`, not
 * `no-referrer`: no-referrer makes browsers send `Origin: null` on form posts, which the CSRF
 * check above would refuse.
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'x-frame-options': 'DENY',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin'
};

function harden(res: Response): Response {
	try {
		for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
		return res;
	} catch {
		// Immutable headers (a Response.redirect or a fetched response): copy into a new one.
		const headers = new Headers(res.headers);
		for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	if (crossSiteForm(event.request, event.url)) {
		return new Response('Cross-site form submissions are forbidden', { status: 403 });
	}
	const pin = validSession(db(), event.cookies.get(SESSION_COOKIE));
	const cloudflare = !pin && Boolean(await accessCheck()?.(accessToken(event.request, event.cookies.get('CF_Authorization'))));
	event.locals.adult = pin || cloudflare;
	event.locals.adultVia = pin ? 'pin' : cloudflare ? 'cloudflare' : null;
	event.locals.board = validBoardSession(db(), event.cookies.get(BOARD_COOKIE))?.name ?? null;
	const path = event.url.pathname;
	const needsAdult = !event.locals.adult && ADULT.some((r) => r.test(path));
	const needsBoard = !event.locals.adult && !event.locals.board && ADULT_OR_BOARD.some((r) => r.test(path));
	if (needsAdult || needsBoard) {
		if (path.startsWith('/api/') || event.request.method !== 'GET') {
			return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: { 'content-type': 'application/json' } });
		}
		if (needsBoard && path.startsWith('/board')) redirect(303, '/board/pair');
		redirect(303, `/planner/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	return harden(await resolve(event));
};
