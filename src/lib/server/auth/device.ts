import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { device } from '../db/schema';

export function newToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function sameHash(a: string, b: string): boolean {
	const ba = Buffer.from(a, 'hex');
	const bb = Buffer.from(b, 'hex');
	return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Bearer from `Authorization`, else `?k=` (Tesserae webhooks cannot send headers, ADR-13). */
export function presentedToken(request: Request, url: URL): string | null {
	const auth = request.headers.get('authorization');
	if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
	return url.searchParams.get('k');
}

export type DeviceAuth = { ok: true } | { ok: false; status: 401 | 403 | 404 };

export function authenticateDevice(db: DB, deviceId: string, token: string | null): DeviceAuth {
	if (!token) return { ok: false, status: 401 };
	const hash = hashToken(token);
	const row = db.select().from(device).where(eq(device.id, deviceId)).get();
	if (row && sameHash(row.tokenHash, hash)) {
		db.update(device).set({ lastSeen: new Date().toISOString() }).where(eq(device.id, deviceId)).run();
		return { ok: true };
	}
	// A valid token for a different device is forbidden; anything else is unauthenticated.
	const owner = db.select({ id: device.id }).from(device).where(eq(device.tokenHash, hash)).get();
	if (owner) return { ok: false, status: 403 };
	return { ok: false, status: 401 };
}

/** Create or re-key a device. Returns the plaintext token (shown once). */
export function issueDeviceToken(db: DB, deviceId: string, name?: string): string {
	const token = newToken();
	const tokenHash = hashToken(token);
	db.insert(device)
		.values({ id: deviceId, name: name ?? deviceId, tokenHash })
		.onConflictDoUpdate({ target: device.id, set: { tokenHash, ...(name ? { name } : {}) } })
		.run();
	return token;
}

/** Simple sliding-window limiter: burst 10 per 10 s per key (in memory). */
export class RateLimiter {
	private hits = new Map<string, number[]>();
	constructor(
		private limit = 10,
		private windowMs = 10_000
	) {}
	allow(key: string, now = Date.now()): boolean {
		const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (list.length >= this.limit) {
			this.hits.set(key, list);
			return false;
		}
		list.push(now);
		this.hits.set(key, list);
		return true;
	}
}
