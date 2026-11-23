import { describe, expect, it } from 'vitest';
import { changePin, login, MAX_FAILURES, revokeSessions, safeNext, validSession } from '../../src/lib/server/auth/planner';
import { seededDb } from '../helpers';

async function token(db: Awaited<ReturnType<typeof seededDb>>, pin = '246810'): Promise<string> {
	const res = await login(db, pin);
	if (!res.ok) throw new Error(res.reason);
	return res.token;
}

describe('revokeSessions', () => {
	it('ends every other session and keeps the one asked for', async () => {
		const db = await seededDb();
		const [a, b, c] = [await token(db), await token(db), await token(db)];
		revokeSessions(db, b);
		expect([validSession(db, a), validSession(db, b), validSession(db, c)]).toEqual([false, true, false]);
		revokeSessions(db);
		expect(validSession(db, b)).toBe(false);
	});
});

describe('changePin', () => {
	it('needs the current PIN, and a wrong one counts towards the lockout', async () => {
		const db = await seededDb();
		const mine = await token(db);
		for (let i = 1; i < MAX_FAILURES; i++) expect(await changePin(db, '000000', '135799', mine)).toEqual({ ok: false, reason: 'wrong' });
		expect((await changePin(db, '000000', '135799', mine)).ok).toBe(false);
		// Locked: even the right PIN is refused, at login too.
		expect(await changePin(db, '246810', '135799', mine)).toMatchObject({ ok: false, reason: 'locked' });
		expect(await login(db, '246810')).toMatchObject({ ok: false, reason: 'locked' });
	});

	it('signs out other sessions, keeps the caller’s, and the new PIN works', async () => {
		const db = await seededDb();
		const [mine, lost] = [await token(db), await token(db)];
		expect(await changePin(db, '246810', '135799', mine)).toEqual({ ok: true });
		expect(validSession(db, mine)).toBe(true);
		expect(validSession(db, lost)).toBe(false);
		expect((await login(db, '246810')).ok).toBe(false);
		expect((await login(db, '135799')).ok).toBe(true);
	});

	it('a Cloudflare session (no PIN cookie) signs out every PIN session', async () => {
		const db = await seededDb();
		const phone = await token(db);
		expect((await changePin(db, '246810', '135799', undefined)).ok).toBe(true);
		expect(validSession(db, phone)).toBe(false);
	});
});

describe('safeNext', () => {
	const origin = 'http://192.168.1.50:3000';
	it.each([
		['/planner/lists?list=2', '/planner/lists?list=2'],
		['/planner', '/planner'],
		['/sim', '/sim'],
		['//evil.example', '/planner'],
		['/\\evil.example', '/planner'],
		['https://evil.example/planner', '/planner'],
		['/planner/login', '/planner'],
		['/plannerx', '/planner'],
		['/api/render/x/home.json', '/planner'],
		['javascript:alert(1)', '/planner'],
		[null, '/planner']
	])('%s → %s', (raw, want) => expect(safeNext(raw, origin)).toBe(want));
});
