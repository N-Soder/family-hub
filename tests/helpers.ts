import { openDb, type DB } from '../src/lib/server/db';
import { seed } from '../src/lib/server/seed';
import { issueDeviceToken } from '../src/lib/server/auth/device';

/** Perth is UTC+8 all year: 2026-10-26 07:00 Perth = 2026-10-25T23:00Z (a Monday). */
export function perth(date: string, time: string): Date {
	return new Date(new Date(`${date}T${time}:00+08:00`).toISOString());
}

export async function seededDb(): Promise<DB> {
	const db = openDb(':memory:');
	await seed(db, { pin: '246810' });
	return db;
}

export function withDevice(db: DB, id = 'wall-1'): string {
	return issueDeviceToken(db, id, id);
}
