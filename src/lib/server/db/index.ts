import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import { env } from '../env';
import { backupDb, isEmpty, pendingMigrations, PRE_MIGRATION_KEEP } from './backup';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = path.resolve(process.env.MIGRATIONS_DIR ?? 'drizzle');

/** Where backups go: BACKUP_DIR, or `backups/` next to the database. */
export function backupDir(file: string): string {
	return path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(file)), 'backups'));
}

/**
 * Open a database file (or ':memory:'), enable WAL + FKs, apply migrations. Migrations only go
 * forward, so a file database with pending ones is copied first (`family-hub-pre-NNNN-*.db`).
 */
export function openDb(file: string, opts: { backupDir?: string; tz?: string; migrations?: string } = {}): DB {
	const migrations = opts.migrations ?? MIGRATIONS;
	if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	const sqlite = new Database(file);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	if (file !== ':memory:' && !isEmpty(sqlite)) {
		const pending = pendingMigrations(sqlite, migrations);
		if (pending.length) {
			const tag = `pre-${pending[0].slice(0, 4)}`;
			const b = backupDb(sqlite, opts.backupDir ?? backupDir(file), { tag, keep: PRE_MIGRATION_KEEP, tz: opts.tz });
			console.log(`[family-hub] ${pending.length} migration(s) pending; backed up to ${b.file}`);
			if (b.problems.length) console.warn(`[family-hub] backup check found problems: ${b.problems.join('; ')}`);
		}
	}
	const db = drizzle(sqlite, { schema }) as DB;
	migrate(db, { migrationsFolder: migrations });
	return db;
}

let instance: DB | null = null;
export function db(): DB {
	if (!instance) instance = openDb(env().DATABASE_PATH, { tz: env().TZ_HOUSEHOLD });
	return instance;
}

/** Tests swap in an in-memory database. */
export function setDb(next: DB | null): void {
	instance = next;
}

export { schema };
