import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/lib/server/db';
import { backedUpToday, backupDb, pendingMigrations } from '../../src/lib/server/db/backup';
import { seed } from '../../src/lib/server/seed';
import { todayBoard } from '../../src/lib/server/planner';
import { nightlyBackup } from '../../src/lib/server/hub';
import { perth } from '../helpers';

let tmp = '';
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-backup-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const count = (db: Database.Database, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const dbs = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();

/** The real migrations folder, cut off after `last` (e.g. '0006'): an older install. */
function migrationsUpTo(last: string): string {
	const dir = path.join(tmp, `migrations-${last}`);
	fs.cpSync('drizzle', dir, { recursive: true });
	const journalFile = path.join(dir, 'meta', '_journal.json');
	const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
	journal.entries = journal.entries.filter((e: { tag: string }) => e.tag.slice(0, 4) <= last);
	fs.writeFileSync(journalFile, JSON.stringify(journal));
	return dir;
}

describe('backupDb', () => {
	it('copies a seeded database that reopens with the same rows', async () => {
		const db = openDb(':memory:');
		await seed(db, { pin: '246810' });
		const b = backupDb(db.$client, tmp, { now: perth('2026-11-06', '02:30') });
		expect(path.basename(b.file)).toBe('family-hub-20261106-0230.db');
		expect(b.problems).toEqual([]);
		const copy = new Database(b.file, { readonly: true });
		for (const t of ['member', 'routine_template', 'routine_step', 'list', 'list_item']) expect(count(copy, t)).toBe(count(db.$client, t));
		copy.close();
	});

	it('keeps the newest backups per tag and leaves other tags alone', () => {
		const db = openDb(':memory:');
		backupDb(db.$client, tmp, { tag: 'pre-0007', keep: 5 });
		for (let day = 1; day <= 4; day++) backupDb(db.$client, tmp, { keep: 3, now: perth(`2026-11-0${day}`, '02:00') });
		expect(dbs(tmp)).toEqual([
			'family-hub-20261102-0200.db',
			'family-hub-20261103-0200.db',
			'family-hub-20261104-0200.db',
			expect.stringMatching(/^family-hub-pre-0007-\d{8}-\d{4}\.db$/)
		]);
	});

	it('does not overwrite a backup taken in the same minute', () => {
		const db = openDb(':memory:');
		const now = perth('2026-11-06', '02:30');
		backupDb(db.$client, tmp, { now });
		const second = backupDb(db.$client, tmp, { now });
		expect(path.basename(second.file)).toBe('family-hub-20261106-0230-2.db');
	});

	it('reports a broken foreign key in the copy', () => {
		const db = openDb(':memory:');
		db.$client.pragma('foreign_keys = OFF');
		db.$client.prepare("INSERT INTO list_item (list_id, title, created_at) VALUES (999, 'x', '2026-01-01')").run();
		expect(backupDb(db.$client, tmp).problems.join()).toMatch(/list_item/);
	});
});

describe('backups before migrations', () => {
	it('backs up an older database before migrating it, and not once it is current', () => {
		const file = path.join(tmp, 'family-hub.db');
		const backups = path.join(tmp, 'backups');
		openDb(file, { migrations: migrationsUpTo('0006'), backupDir: backups }).$client.close();
		expect(fs.existsSync(backups)).toBe(false); // a new, empty database has nothing to copy

		const old = new Database(file);
		expect(pendingMigrations(old, 'drizzle')).toEqual(['0007_list_notes', '0008_board_session', '0009_gifts', '0010_notes']);
		old.close();

		openDb(file, { backupDir: backups }).$client.close();
		expect(dbs(backups)).toEqual([expect.stringMatching(/^family-hub-pre-0007-\d{8}-\d{4}\.db$/)]);
		const copy = new Database(path.join(backups, dbs(backups)[0]), { readonly: true });
		expect(pendingMigrations(copy, 'drizzle')).toEqual(['0007_list_notes', '0008_board_session', '0009_gifts', '0010_notes']);
		copy.close();

		openDb(file, { backupDir: backups }).$client.close();
		expect(dbs(backups)).toHaveLength(1);
	});
});

describe('restore', () => {
	it('a backup opens as the live database and the Planner loads', async () => {
		const live = openDb(path.join(tmp, 'live.db'), { backupDir: path.join(tmp, 'b') });
		await seed(live, { pin: '246810' });
		const b = backupDb(live.$client, path.join(tmp, 'b'));
		live.$client.close();

		const restored = path.join(tmp, 'restored', 'family-hub.db');
		fs.mkdirSync(path.dirname(restored));
		fs.copyFileSync(b.file, restored);
		const db = openDb(restored, { backupDir: path.join(tmp, 'b2') });
		const board = todayBoard(db, perth('2026-10-26', '07:00'));
		expect(board.length).toBeGreaterThan(0);
		db.$client.close();
	});
});

describe('nightlyBackup', () => {
	it('takes one backup per household day', () => {
		const db = openDb(':memory:');
		const tz = 'Australia/Perth';
		expect(nightlyBackup(db, tmp, perth('2026-11-06', '02:00'), tz)).toBeTruthy();
		expect(nightlyBackup(db, tmp, perth('2026-11-06', '23:00'), tz)).toBeNull();
		expect(backedUpToday(tmp, perth('2026-11-07', '00:30'), tz)).toBe(false);
		expect(nightlyBackup(db, tmp, perth('2026-11-07', '00:30'), tz)).toBeTruthy();
		expect(dbs(tmp)).toHaveLength(2);
	});
});
