import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { eq, lt, ne } from 'drizzle-orm';
import type { DB } from '../db';
import { plannerSession } from '../db/schema';
import { getSetting, setSetting } from '../settings';

export const SESSION_COOKIE = 'fh_session';
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60_000;
const SESSION_MS = 30 * 24 * 60 * 60_000;

interface Lockout {
	failures: number;
	lockedUntil: string | null;
}

export async function setPin(db: DB, pin: string): Promise<void> {
	if (!/^\d{6,12}$/.test(pin)) throw new Error('PIN must be 6–12 digits');
	setSetting(db, 'planner_pin_hash', await hash(pin));
	setSetting(db, 'planner_lockout', { failures: 0, lockedUntil: null } satisfies Lockout);
}

export function pinIsSet(db: DB): boolean {
	return getSetting<string | null>(db, 'planner_pin_hash', null) !== null;
}

export type PinCheck = { ok: true } | { ok: false; reason: 'locked' | 'wrong' | 'no_pin'; lockedUntil?: string };
export type LoginResult = { ok: true; token: string } | Extract<PinCheck, { ok: false }>;

/** Check a PIN against the stored hash. Wrong PINs count towards the shared lockout. */
async function checkPin(db: DB, pin: string, now: Date): Promise<PinCheck> {
	const stored = getSetting<string | null>(db, 'planner_pin_hash', null);
	if (!stored) return { ok: false, reason: 'no_pin' };
	const lock = getSetting<Lockout>(db, 'planner_lockout', { failures: 0, lockedUntil: null });
	if (lock.lockedUntil && new Date(lock.lockedUntil) > now) {
		return { ok: false, reason: 'locked', lockedUntil: lock.lockedUntil };
	}
	const good = /^\d{6,12}$/.test(pin) && (await verify(stored, pin));
	if (!good) {
		const failures = (lock.lockedUntil ? 0 : lock.failures) + 1;
		const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;
		setSetting(db, 'planner_lockout', { failures: lockedUntil ? 0 : failures, lockedUntil } satisfies Lockout);
		return lockedUntil ? { ok: false, reason: 'locked', lockedUntil } : { ok: false, reason: 'wrong' };
	}
	setSetting(db, 'planner_lockout', { failures: 0, lockedUntil: null } satisfies Lockout);
	return { ok: true };
}

export async function login(db: DB, pin: string, now = new Date()): Promise<LoginResult> {
	const check = await checkPin(db, pin, now);
	if (!check.ok) return check;
	const token = randomBytes(32).toString('base64url');
	db.delete(plannerSession).where(lt(plannerSession.expiresAt, now.toISOString())).run();
	db.insert(plannerSession)
		.values({
			tokenHash: sessionHash(token),
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + SESSION_MS).toISOString()
		})
		.run();
	return { ok: true, token };
}

/**
 * Change the PIN (audit H2). Needs the current PIN, through the same lockout as login, and
 * signs out every other PIN session: changing the PIN is how you cut off a lost phone.
 */
export async function changePin(db: DB, current: string, next: string, keepToken: string | undefined, now = new Date()): Promise<PinCheck> {
	const check = pinIsSet(db) ? await checkPin(db, current, now) : ({ ok: true } as const);
	if (!check.ok) return check;
	await setPin(db, next);
	revokeSessions(db, keepToken);
	return check;
}

/** End every PIN session, except the one for `keepToken` if given. */
export function revokeSessions(db: DB, keepToken?: string): void {
	if (keepToken) db.delete(plannerSession).where(ne(plannerSession.tokenHash, sessionHash(keepToken))).run();
	else db.delete(plannerSession).run();
}

function sessionHash(token: string): string {
	return createHash('sha256').update(`session:${token}`).digest('hex');
}

export function validSession(db: DB, token: string | undefined, now = new Date()): boolean {
	if (!token) return false;
	const row = db.select().from(plannerSession).where(eq(plannerSession.tokenHash, sessionHash(token))).get();
	return Boolean(row && row.expiresAt > now.toISOString());
}

export function logout(db: DB, token: string | undefined): void {
	if (token) db.delete(plannerSession).where(eq(plannerSession.tokenHash, sessionHash(token))).run();
}

/**
 * Where to go after login: only a Planner or simulator page on this site (audit L2). Resolving against the
 * origin catches `//host` and `/\\host`, which browsers treat as another site.
 */
export function safeNext(raw: string | null, origin: string): string {
	const fallback = '/planner';
	if (!raw) return fallback;
	try {
		const u = new URL(raw, origin);
		const ours = /^\/(planner|sim)(\/|$)/.test(u.pathname) && !u.pathname.startsWith('/planner/login');
		return u.origin === origin && ours ? u.pathname + u.search : fallback;
	} catch {
		return fallback;
	}
}
