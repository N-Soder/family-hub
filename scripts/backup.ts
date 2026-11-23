// Take a backup now: `npm run db:backup` (DATABASE_PATH, BACKUP_DIR as for the app).
import { backupDir, openDb } from '../src/lib/server/db';
import { backupDb } from '../src/lib/server/db/backup';

const file = process.env.DATABASE_PATH ?? './data/family-hub.db';
const tz = process.env.TZ_HOUSEHOLD ?? 'Australia/Perth';
const db = openDb(file, { tz });
const b = backupDb(db.$client, backupDir(file), { tag: 'manual', tz });
console.log(b.file);
if (b.problems.length) {
	console.error(`problems: ${b.problems.join('; ')}`);
	process.exit(1);
}
