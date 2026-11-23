import { eq } from 'drizzle-orm';
import { backupDir, db, type DB } from './db';
import { backedUpToday, backupDb } from './db/backup';
import { device } from './db/schema';
import { env } from './env';
import { getSetting } from './settings';
import { issueDeviceToken, RateLimiter } from './auth/device';
import { Repainter, wallBindings } from './tesserae/repaint';
import { DroppedTapWatch } from './tesserae/dropped-taps';
import { seed } from './seed';
import { bootstrapTesserae, tesseraeConfigured, tesseraePusher, tesseraeTouchLog, type SimDeviceCreds } from './tesserae/service';
import { SimWall } from './sim/wall';
import { weatherCache, weatherPlace } from './weather';

// Process-wide services. One app process per household; no queues, no workers.

export const DIRECT_SIM_DEVICE = 'sim-direct';

interface Hub {
	repainter: Repainter;
	tapWatch: DroppedTapWatch | null;
	tapLimiter: RateLimiter;
	simWall: SimWall | null;
	bootstrap: { state: 'off' | 'running' | 'ready' | 'failed'; error?: string; steps: string[] };
	ticker: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __familyHub?: Hub };

export function hub(): Hub {
	if (!g.__familyHub) {
		const repainter = new Repainter(db, tesseraeConfigured() ? tesseraePusher(db) : null);
		g.__familyHub = {
			repainter,
			tapWatch: tesseraeConfigured()
				? new DroppedTapWatch(tesseraeTouchLog(db), (deviceId) => {
						console.log(`[tesserae] dropped tap on ${deviceId}: full repaint to clear it`);
						void repainter.notify([], { full: true, deviceId });
					})
				: null,
			tapLimiter: new RateLimiter(10, 10_000),
			simWall: null,
			bootstrap: { state: 'off', steps: [] },
			ticker: null
		};
	}
	return g.__familyHub;
}

/** The direct-mode simulator renders as its own pseudo device (no Tesserae involved). */
export function ensureDirectSimDevice(d: DB): void {
	if (!d.select().from(device).where(eq(device.id, DIRECT_SIM_DEVICE)).get()) {
		issueDeviceToken(d, DIRECT_SIM_DEVICE, 'Simulator (direct)');
	}
}

function startSimWall(creds: SimDeviceCreds): void {
	const h = hub();
	h.simWall?.stop();
	h.simWall = new SimWall(env().TESSERAE_URL!, creds.id, creds.token);
	h.simWall.start();
}

export async function runBootstrap(): Promise<void> {
	const h = hub();
	h.bootstrap = { state: 'running', steps: [] };
	try {
		const report = await bootstrapTesserae(db(), (m) => {
			h.bootstrap.steps.push(m);
			console.log(`[tesserae] ${m}`);
		});
		if (report.simDevice) startSimWall(report.simDevice);
		h.repainter.reset();
		await h.repainter.notify([], { full: true });
		h.bootstrap.state = 'ready';
	} catch (e) {
		h.bootstrap.state = 'failed';
		h.bootstrap.error = e instanceof Error ? e.message : String(e);
		console.error(`[tesserae] bootstrap failed: ${h.bootstrap.error}`);
	}
}

/** One backup per household day (audit H1). Runs at start and hourly; cheap when already done. */
export function nightlyBackup(d: DB, dir: string, now = new Date(), tz = env().TZ_HOUSEHOLD): string | null {
	if (backedUpToday(dir, now, tz)) return null;
	try {
		const b = backupDb(d.$client, dir, { now, tz });
		if (b.problems.length) console.warn(`[backup] ${b.file} has problems: ${b.problems.join('; ')}`);
		else console.log(`[backup] ${b.file}`);
		return b.file;
	} catch (e) {
		console.error(`[backup] failed: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
}

let started = false;
export async function startHub(): Promise<void> {
	if (started) return;
	started = true;
	const d = db();
	if (env().SEED_ON_EMPTY) {
		const res = await seed(d, { pin: env().ADMIN_PIN });
		if (res.seeded) console.log('[family-hub] seeded the demo household');
	}
	ensureDirectSimDevice(d);
	const h = hub();
	const backups = backupDir(env().DATABASE_PATH);
	nightlyBackup(d, backups);
	setInterval(() => nightlyBackup(d, backups), 60 * 60_000).unref();
	// Today's weather: fetched in the background, read by renders (ADR-26). refresh() only asks
	// Open-Meteo when the copy is 30 min old or the day changed; the 30 s ticker repaints.
	const weather = () => void weatherCache.refresh(weatherPlace(d), new Date(), env().TZ_HOUSEHOLD);
	weather();
	setInterval(weather, 5 * 60_000).unref();
	// Day types from the calendar (ADR-29): Tesserae refreshes the feed files on its own schedule;
	// re-read them every 5 min (parsing is cached per file change) and repaint if today changed.
	if (env().CALENDAR_DIR) {
		const { syncCalendarDays } = await import('./planner');
		const calendar = () => {
			try {
				const r = syncCalendarDays(d);
				if (r.changed.length) console.log(`[calendar] day types updated for ${r.changed.length} day(s)`);
				if (r.error) console.warn(`[calendar] ${r.error}`);
			} catch (e) {
				console.warn(`[calendar] sync failed: ${(e as Error).message}`);
			}
		};
		calendar();
		setInterval(calendar, 5 * 60_000).unref();
	}
	if (tesseraeConfigured()) {
		const creds = getSetting<SimDeviceCreds | null>(d, 'sim_tesserae_device', null);
		if (env().TESSERAE_AUTO_BOOTSTRAP) void runBootstrap();
		else if (creds) startSimWall(creds);
		// Routine windows open/close and the day rolls over without any tap: repaint walls then.
		// Also catch dropped taps that came with no accepted tap around them.
		h.ticker = setInterval(() => {
			void h.repainter.tick().catch(() => undefined);
			for (const b of wallBindings(d)) void h.tapWatch?.check(b.deviceId).catch(() => false);
		}, 30_000);
	}
}
