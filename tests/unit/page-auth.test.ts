import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/lib/server/db';
import { buildWallCanvas, checkedInWallPage, fillWallPage, tokenInPage, MAX_SLOTS } from '../../src/lib/server/tesserae/page';
import { authenticateDevice, issueDeviceToken, presentedToken, RateLimiter } from '../../src/lib/server/auth/device';
import { login, setPin, validSession, MAX_FAILURES } from '../../src/lib/server/auth/planner';
import { packWidget } from '../../src/lib/server/tesserae/package';
import { gunzipSync } from 'node:zlib';

describe('wall page definition', () => {
	it('checked-in tesserae/pages/wall.json matches the builder (run tesserae/scripts/build-page.ts)', () => {
		expect(checkedInWallPage()).toEqual(buildWallCanvas());
	});
	it('has one webhook action per slot and no secrets', () => {
		const doc = checkedInWallPage();
		const wall = doc.els.find((e) => e.id === 'wall') as { actions: Record<string, string> };
		expect(Object.keys(wall.actions)).toHaveLength(MAX_SLOTS + 7); // + Lists / Back, the old plan button, Routines and four routines tabs
		expect(MAX_SLOTS).toBe(12); // list rows on the lists screen
		expect(wall.actions.slot3).toBe('webhook:{{BASE_URL}}/api/tap/{{DEVICE}}/{{PAGE}}/3?k={{TOKEN}}');
		expect(wall.actions.nav).toBe('webhook:{{BASE_URL}}/api/tap/{{DEVICE}}/{{PAGE}}/20?k={{TOKEN}}');
		expect(wall.actions.plan).toBe('webhook:{{BASE_URL}}/api/tap/{{DEVICE}}/{{PAGE}}/21?k={{TOKEN}}');
		expect(wall.actions.routines).toBe('webhook:{{BASE_URL}}/api/tap/{{DEVICE}}/{{PAGE}}/22?k={{TOKEN}}');
		expect(wall.actions.member4).toBe('webhook:{{BASE_URL}}/api/tap/{{DEVICE}}/{{PAGE}}/26?k={{TOKEN}}');
	});
	it('fills placeholders for a device', () => {
		const doc = fillWallPage(checkedInWallPage(), { baseUrl: 'http://family-hub:3000/', device: 'hall', page: 'home', token: 'T0K' });
		const json = JSON.stringify(doc);
		expect(json).not.toContain('{{');
		expect(json).toContain('webhook:http://family-hub:3000/api/tap/hall/home/1?k=T0K');
		expect(tokenInPage(doc)).toBe('T0K');
	});
	it('packs the widget as a gzip tarball under family_hub/', () => {
		const tar = gunzipSync(packWidget('tesserae/widget/family_hub'));
		expect(tar.subarray(0, 100).toString('utf8')).toMatch(/^family_hub\//);
		expect(tar.includes(Buffer.from('family_hub/server.py'))).toBe(true);
	});
});

describe('device auth', () => {
	it('401 without or with an unknown token, 403 for another device’s token, ok for its own', () => {
		const db = openDb(':memory:');
		const a = issueDeviceToken(db, 'wall-a');
		const b = issueDeviceToken(db, 'wall-b');
		expect(authenticateDevice(db, 'wall-a', null)).toEqual({ ok: false, status: 401 });
		expect(authenticateDevice(db, 'wall-a', 'nope')).toEqual({ ok: false, status: 401 });
		expect(authenticateDevice(db, 'wall-a', b)).toEqual({ ok: false, status: 403 });
		expect(authenticateDevice(db, 'wall-a', a)).toEqual({ ok: true });
		// Rotation invalidates the old token.
		issueDeviceToken(db, 'wall-a');
		expect(authenticateDevice(db, 'wall-a', a).ok).toBe(false);
	});
	it('reads the bearer header or ?k=', () => {
		const u = new URL('http://x/api/tap/a/home/1?k=fromquery');
		expect(presentedToken(new Request(u, { headers: { authorization: 'Bearer abc' } }), u)).toBe('abc');
		expect(presentedToken(new Request(u), u)).toBe('fromquery');
	});
	it('rate-limits bursts of 10 per 10 s', () => {
		const rl = new RateLimiter(10, 10_000);
		const results = Array.from({ length: 11 }, () => rl.allow('d', 1000));
		expect(results.filter(Boolean)).toHaveLength(10);
		expect(rl.allow('d', 12_000)).toBe(true);
	});
});

describe('planner PIN', () => {
	it('locks out after 5 wrong PINs for 15 minutes, then accepts the right PIN', async () => {
		const db = openDb(':memory:');
		await setPin(db, '135790');
		const t0 = new Date('2026-10-26T00:00:00Z');
		for (let i = 1; i < MAX_FAILURES; i++) expect(await login(db, '000000', t0)).toEqual({ ok: false, reason: 'wrong' });
		expect(await login(db, '000000', t0)).toMatchObject({ ok: false, reason: 'locked' });
		expect(await login(db, '135790', new Date(t0.getTime() + 60_000))).toMatchObject({ ok: false, reason: 'locked' });
		const later = await login(db, '135790', new Date(t0.getTime() + 16 * 60_000));
		expect(later.ok).toBe(true);
		if (later.ok) expect(validSession(db, later.token, new Date(t0.getTime() + 17 * 60_000))).toBe(true);
		expect(validSession(db, 'forged')).toBe(false);
	});
	it('rejects short PINs', async () => {
		await expect(setPin(openDb(':memory:'), '1234')).rejects.toThrow();
	});
});

describe('removing a device', () => {
	it('drops its token and served frames; the simulator devices stay', async () => {
		const { removeDevice } = await import('../../src/lib/server/planner');
		const { renderForDevice } = await import('../../src/lib/server/domain/render');
		const { ensureDirectSimDevice, DIRECT_SIM_DEVICE } = await import('../../src/lib/server/hub');
		const db = openDb(':memory:');
		const token = issueDeviceToken(db, 'old-wall');
		renderForDevice(db, 'old-wall', 'home');
		const frames = () => db.$client.prepare("SELECT count(*) AS n FROM served_snapshot WHERE device_id = 'old-wall'").get() as { n: number };
		expect(frames().n).toBeGreaterThan(0);
		ensureDirectSimDevice(db);
		expect(removeDevice(db, 'old-wall')).toBe(true);
		expect(authenticateDevice(db, 'old-wall', token).ok).toBe(false);
		expect(frames().n).toBe(0);
		expect(removeDevice(db, 'old-wall')).toBe(false);
		expect(removeDevice(db, DIRECT_SIM_DEVICE)).toBe(false);
	});
});
