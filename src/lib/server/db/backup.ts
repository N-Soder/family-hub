import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { localParts } from '../domain/time';

// Database backups (audit H1). A backup is a `VACUUM INTO` copy: a consistent, compacted
// snapshot taken while the app keeps running, with no WAL file to carry along.

export const NIGHTLY_KEEP = 14;
export const PRE_MIGRATION_KEEP = 5;
const PREFIX = 'family-hub-';

export interface Backup {
	file: string;
	/** Problems `integrity_check` and `foreign_key_check` found in the copy; empty when sound. */
	problems: string[];
}

/** `20261106-0230` in the household zone, so file names read as local time. */
function stamp(now: Date, tz: string): string {
	const { date, minutes } = localParts(now, tz);
	const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
	const mm = String(minutes % 60).padStart(2, '0');
	return `${date.replaceAll('-', '')}-${hh}${mm}`;
}

/**
 * Copy the database to `<dir>/family-hub-[<tag>-]YYYYMMDD-HHMM.db`, check the copy, and keep
 * only the newest `keep` files with the same tag.
 */
export function backupDb(
	sqlite: Database.Database,
	dir: string,
	opts: { tag?: string; keep?: number; now?: Date; tz?: string } = {}
): Backup {
	const now = opts.now ?? new Date();
	const head = opts.tag ? `${PREFIX}${opts.tag}-` : PREFIX;
	fs.mkdirSync(dir, { recursive: true });
	const base = path.join(dir, `${head}${stamp(now, opts.tz ?? 'Australia/Perth')}`);
	let file = `${base}.db`;
	// Two backups in one minute (a restart loop): keep both rather than fail.
	for (let n = 2; fs.existsSync(file); n++) file = `${base}-${n}.db`;
	sqlite.prepare('VACUUM INTO ?').run(file);
	const problems = checkCopy(file);
	prune(dir, head, opts.keep ?? NIGHTLY_KEEP);
	return { file, problems };
}

function checkCopy(file: string): string[] {
	const copy = new Database(file, { readonly: true });
	try {
		const integrity = copy.pragma('integrity_check') as { integrity_check: string }[];
		const problems = integrity.map((r) => r.integrity_check).filter((r) => r !== 'ok');
		const fks = copy.pragma('foreign_key_check') as { table: string; rowid: number; parent: string }[];
		for (const f of fks) problems.push(`foreign key: ${f.table} row ${f.rowid} → missing ${f.parent}`);
		return problems;
	} finally {
		copy.close();
	}
}

/** Delete all but the newest `keep` backups with this exact prefix (untagged ignores tagged). */
function prune(dir: string, head: string, keep: number): void {
	const mine = fs
		.readdirSync(dir)
		.filter((f) => f.startsWith(head) && f.endsWith('.db') && /^\d{8}-\d{4}/.test(f.slice(head.length)))
		.sort();
	for (const f of mine.slice(0, Math.max(0, mine.length - keep))) fs.rmSync(path.join(dir, f));
}

/** Migrations in `folder` the database has not applied yet (drizzle's own bookkeeping). */
export function pendingMigrations(sqlite: Database.Database, folder: string): string[] {
	const all = readMigrationFiles({ migrationsFolder: folder });
	const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
		entries: { tag: string; when: number }[];
	};
	const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
	const last = hasTable
		? Number((sqlite.prepare('SELECT max(created_at) AS t FROM __drizzle_migrations').get() as { t: number | null }).t ?? 0)
		: 0;
	return all.filter((m) => m.folderMillis > last).map((m) => journal.entries.find((e) => e.when === m.folderMillis)?.tag ?? String(m.folderMillis));
}

/** True when the database holds no tables yet: a first start, with nothing worth copying. */
export function isEmpty(sqlite: Database.Database): boolean {
	return !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
}

/** True when a nightly backup already exists for the household's current date. */
export function backedUpToday(dir: string, now: Date, tz: string): boolean {
	const day = stamp(now, tz).slice(0, 8);
	try {
		return fs.readdirSync(dir).some((f) => f.startsWith(`${PREFIX}${day}-`));
	} catch {
		return false;
	}
}
