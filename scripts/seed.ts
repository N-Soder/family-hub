import { openDb } from '../src/lib/server/db';
import { seed } from '../src/lib/server/seed';
const file = process.env.DATABASE_PATH ?? './data/family-hub.db';
const res = await seed(openDb(file), { pin: process.env.ADMIN_PIN });
console.log(res.seeded ? `seeded ${file}` : `already seeded (${file})`);
