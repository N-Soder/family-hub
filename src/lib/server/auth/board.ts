import { createHash, randomBytes, randomInt } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { boardSession } from '../db/schema';
import { getSetting, setSetting } from '../settings';

// Board access (ADR-30). A spare screen is paired once: an adult asks Planner → Settings for a
// six-digit code (good for ten minutes), types it on the screen's /board/pair page, and the
// browser keeps a long-lived cookie. The token is stored hashed; the code is short-lived and
// is only ever shown on a Planner page (PIN or Cloudflare Access).

export const BOARD_COOKIE = 'fh_board';
export const PAIR_CODE_MS = 10 * 60_000;
export const PAIR_MAX_FAILURES = 5;
const PAIR_KEY = 'board_pair';
/** How often a screen's "last seen" is written (not on every request). */
const SEEN_EVERY_MS = 60 * 60_000;

interface PairCode {
	code: string;
	expiresAt: string;
	failures: number;
}

function tokenHash(token: string): string {
	return createHash('sha256').update(`board:${token}`).digest('hex');
}

/** A fresh code, replacing any earlier one. */
export function issuePairingCode(db: DB, now = new Date()): { code: string; expiresAt: string } {
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const expiresAt = new Date(now.getTime() + PAIR_CODE_MS).toISOString();
	setSetting(db, PAIR_KEY, { code, expiresAt, failures: 0 } satisfies PairCode);
	return { code, expiresAt };
}

/** The code still open for pairing, if any (for the Settings page). */
export function currentPairingCode(db: DB, now = new Date()): { code: string; expiresAt: string } | null {
	const p = getSetting<PairCode | null>(db, PAIR_KEY, null);
	return p && p.expiresAt > now.toISOString() ? { code: p.code, expiresAt: p.expiresAt } : null;
}

export function cancelPairingCode(db: DB): void {
	setSetting(db, PAIR_KEY, null);
}

export type PairResult = { ok: true; token: string } | { ok: false; reason: 'none' | 'wrong' };

/**
 * Turn a typed code into a board session. A wrong guess counts; after five the code is gone and
 * an adult has to ask for a new one. A code is single use.
 */
export function redeemPairingCode(db: DB, typed: string, name: string, now = new Date()): PairResult {
	const p = getSetting<PairCode | null>(db, PAIR_KEY, null);
	if (!p || p.expiresAt <= now.toISOString()) return { ok: false, reason: 'none' };
	if (typed.replace(/\s+/g, '') !== p.code) {
		const failures = p.failures + 1;
		if (failures >= PAIR_MAX_FAILURES) setSetting(db, PAIR_KEY, null);
		else setSetting(db, PAIR_KEY, { ...p, failures } satisfies PairCode);
		return { ok: false, reason: failures >= PAIR_MAX_FAILURES ? 'none' : 'wrong' };
	}
	setSetting(db, PAIR_KEY, null);
	const token = randomBytes(32).toString('base64url');
	const at = now.toISOString();
	db.insert(boardSession)
		.values({ tokenHash: tokenHash(token), name: name.trim() || 'Screen', createdAt: at, lastSeenAt: at })
		.run();
	return { ok: true, token };
}

export type BoardSession = typeof boardSession.$inferSelect;

/** The paired screen behind a cookie, or null. Notes when it was last seen, about hourly. */
export function validBoardSession(db: DB, token: string | undefined, now = new Date()): BoardSession | null {
	if (!token) return null;
	const row = db.select().from(boardSession).where(eq(boardSession.tokenHash, tokenHash(token))).get();
	if (!row) return null;
	if (now.getTime() - Date.parse(row.lastSeenAt) > SEEN_EVERY_MS) {
		db.update(boardSession).set({ lastSeenAt: now.toISOString() }).where(eq(boardSession.tokenHash, row.tokenHash)).run();
	}
	return row;
}

export function boardSessions(db: DB): BoardSession[] {
	return db.select().from(boardSession).orderBy(desc(boardSession.createdAt)).all();
}

/** Forget one screen (by its stored hash, as listed in Settings). */
export function unpairBoard(db: DB, hash: string): boolean {
	return db.delete(boardSession).where(eq(boardSession.tokenHash, hash)).run().changes > 0;
}
