import { openDb } from '../src/lib/server/db';
const file = process.env.DATABASE_PATH ?? './data/family-hub.db';
openDb(file);
console.log(`migrations applied to ${file}`);
