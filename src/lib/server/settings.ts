import { eq } from 'drizzle-orm';
import type { DB } from './db';
import { setting } from './db/schema';

export function getSetting<T>(db: DB, key: string, fallback: T): T {
	const row = db.select().from(setting).where(eq(setting.key, key)).get();
	return row ? (JSON.parse(row.valueJson) as T) : fallback;
}

export function setSetting(db: DB, key: string, value: unknown): void {
	const valueJson = JSON.stringify(value);
	db.insert(setting).values({ key, valueJson }).onConflictDoUpdate({ target: setting.key, set: { valueJson } }).run();
}
