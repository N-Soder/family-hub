import { describe, expect, it, beforeAll } from 'vitest';
import { setDb } from '../../src/lib/server/db';
import { seededDb } from '../helpers';
import { login } from '../../src/lib/server/auth/planner';

// The real hooks.server.ts handle(), with a minimal RequestEvent.
let handle: typeof import('../../src/hooks.server').handle;
let token = '';

beforeAll(async () => {
	const db = await seededDb();
	setDb(db);
	const res = await login(db, '246810');
	if (res.ok) token = res.token;
	({ handle } = await import('../../src/hooks.server'));
});

async function call(path: string, cookie?: string, method = 'GET', headers: Record<string, string> = {}) {
	const url = new URL(`http://localhost${path}`);
	const event = {
		url,
		request: new Request(url, { method, headers }),
		cookies: { get: (n: string) => (n === 'fh_session' ? cookie : undefined) },
		locals: {} as App.Locals
	} as unknown as Parameters<typeof handle>[0]['event'];
	try {
		return await handle({ event, resolve: async () => new Response('ok') });
	} catch (e) {
		return e as { status: number; location: string };
	}
}

describe('CSRF', () => {
	it('rejects form posts from another host or without an Origin; allows same host on any address', async () => {
		const { crossSiteForm } = await import('../../src/hooks.server');
		const form = (origin: string | null, host = 'http://192.168.0.175:3000') =>
			crossSiteForm(
				new Request(`${host}/planner?/toggle`, {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) }
				}),
				new URL(`${host}/planner?/toggle`)
			);
		expect(form('http://192.168.0.175:3000')).toBe(false);
		expect(form('http://localhost:3000', 'http://localhost:3000')).toBe(false);
		expect(form('http://evil.example')).toBe(true);
		expect(form(null)).toBe(true);
		// JSON APIs (device webhooks) are not form posts and carry their own bearer auth.
		expect(crossSiteForm(new Request('http://x/api/tap/a/home/1', { method: 'POST', headers: { 'content-type': 'application/json' } }), new URL('http://x/api/tap/a/home/1'))).toBe(false);
	});
});

describe('Planner gate', () => {
	it('redirects /planner/* to login without a session cookie', async () => {
		const r = (await call('/planner/members')) as { status: number; location: string };
		expect(r.status).toBe(303);
		expect(r.location).toBe('/planner/login?next=%2Fplanner%2Fmembers');
		expect(((await call('/sim')) as { status: number }).status).toBe(303);
	});
	it('401s APIs and form posts without a session', async () => {
		expect(((await call('/api/events')) as Response).status).toBe(401);
		expect(((await call('/planner', undefined, 'POST')) as Response).status).toBe(401);
	});
	it('lets a valid session through; the login page and device APIs are open', async () => {
		expect(((await call('/planner/members', token)) as Response).status).toBe(200);
		expect(((await call('/planner/login')) as Response).status).toBe(200);
		expect(((await call('/api/render/wall-1/home.json')) as Response).status).toBe(200); // bearer checked in the handler
		expect(((await call('/planner', 'forged')) as { status: number }).status).toBe(303);
	});
	it('a Cloudflare Access header does not get in when Access is not configured (LAN)', async () => {
		const r = (await call('/planner', undefined, 'GET', { 'cf-access-jwt-assertion': 'forged.token.here' })) as { status: number };
		expect(r.status).toBe(303);
	});
	it('sets the basic security headers on pages', async () => {
		const r = (await call('/planner/members', token)) as Response;
		expect(r.headers.get('x-frame-options')).toBe('DENY');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		// Not no-referrer: that sends `Origin: null` on form posts and the CSRF check would refuse them.
		expect(r.headers.get('referrer-policy')).toBe('same-origin');
	});
	it('PWA files are public so phones can install the app before logging in', async () => {
		for (const p of ['/manifest.webmanifest', '/service-worker.js', '/icons/storybook-192.png']) {
			expect(((await call(p)) as Response).status).toBe(200);
		}
	});
});
