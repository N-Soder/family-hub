// Builds the demo household and calendar (src/lib/server/demo.ts). Run via `npm run demo`.
import { openDb } from '../src/lib/server/db';
import { seedDemo, writeDemoCalendar } from '../src/lib/server/demo';

const file = process.env.DATABASE_PATH ?? './data/demo.db';
const calendar = process.env.CALENDAR_DIR ?? './data/demo-calendar';
const tz = process.env.TZ_HOUSEHOLD ?? 'Australia/Perth';
const added = await seedDemo(openDb(file), { tz, pin: process.env.ADMIN_PIN });
writeDemoCalendar(calendar, { tz });
console.log(added ? `demo household in ${file}, calendar in ${calendar}` : `${file} already has a household; left it as is`);
