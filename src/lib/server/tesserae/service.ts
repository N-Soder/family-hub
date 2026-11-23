import { createHash } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { device } from '../db/schema';
import { env } from '../env';
import { getSetting, setSetting } from '../settings';
import { issueDeviceToken, hashToken } from '../auth/device';
import { TesseraeAdmin, FakeDevice } from './client';
import { packWidget, widgetVersion } from './package';
import { checkedInWallPage, fillWallPage, tokenInPage, ROOT } from './page';
import type { Pusher, PushOutcome } from './repaint';
import type { TouchEvent, TouchLog } from './dropped-taps';

const WIDGET_DIR = path.join(ROOT, 'tesserae/widget/family_hub');

export function tesseraeConfigured(): boolean {
	return Boolean(env().TESSERAE_URL);
}

export function tesseraeClient(db: DB): TesseraeAdmin {
	const e = env();
	if (!e.TESSERAE_URL) throw new Error('TESSERAE_URL not set');
	return new TesseraeAdmin({
		baseUrl: e.TESSERAE_URL,
		adminPassword: e.TESSERAE_ADMIN_PASSWORD,
		// Prefer the token Family Hub minted (bootstrap re-mints when it stops working).
		mcpToken: getSetting<string | null>(db, 'tesserae_mcp_token', null) || e.TESSERAE_MCP_TOKEN || undefined,
		pushToken: e.TESSERAE_PUSH_TOKEN
	});
}

/**
 * Patch = webhook-token push (page pipeline; Tesserae diverts small diffs to
 * patches). Full = the same push first (it computes the tap-region map for the
 * new composition), then an MCP push, which always mints a full frame but
 * reuses the page's last region map (architecture §8, S3c).
 */
export function tesseraePusher(db: () => DB): Pusher {
	return {
		async patch(pageId, deviceId): Promise<PushOutcome> {
			const t0 = performance.now();
			const r = await tesseraeClient(db()).push(pageId, [deviceId]);
			return { ok: r.status === 'sent' || r.status === 'no_change', status: r.status, ms: performance.now() - t0 };
		},
		async full(pageId, deviceId): Promise<PushOutcome> {
			const t0 = performance.now();
			const c = tesseraeClient(db());
			await c.push(pageId, [deviceId]);
			const r = await c.mcp<{ sent: string[]; errors: unknown[] }>('POST', `/pages/${pageId}/push`, {
				device_ids: [deviceId]
			});
			const ok = r.sent.includes(deviceId);
			return { ok, status: ok ? 'sent' : JSON.stringify(r.errors), ms: performance.now() - t0 };
		}
	};
}

/** Tesserae's touch log (Settings → Devices → Touch monitor) over one long-lived admin session. */
export function tesseraeTouchLog(db: () => DB): TouchLog {
	let client: TesseraeAdmin | null = null;
	return {
		async recent(deviceId): Promise<TouchEvent[]> {
			client ??= tesseraeClient(db());
			const res = await client.get(`/devices/touch/${encodeURIComponent(deviceId)}/data.json`);
			if (!res.ok) {
				await res.arrayBuffer();
				return [];
			}
			const body = (await res.json()) as { events?: Array<Partial<TouchEvent>> };
			return (body.events ?? []).flatMap((e) =>
				typeof e.id === 'number' && typeof e.timestamp === 'number' && typeof e.status === 'string'
					? [{ id: e.id, timestamp: e.timestamp, status: e.status }]
					: []
			);
		}
	};
}

async function waitForTesserae(base: string, timeoutMs = 90_000): Promise<void> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		try {
			const r = await fetch(`${base}/healthz`);
			if (r.ok) return;
		} catch {
			/* not up yet */
		}
		if (Date.now() > until) throw new Error(`Tesserae not reachable at ${base}`);
		await new Promise((r) => setTimeout(r, 1500));
	}
}

/** Mint + scrape an MCP token (Settings → System → MCP → Regenerate shows it once). */
async function ensureMcpToken(db: DB, t: TesseraeAdmin): Promise<void> {
	try {
		await t.mcp('GET', '/pages');
		return;
	} catch {
		/* token missing or stale */
	}
	await t.form('/settings/system/mcp/regenerate', {});
	const res = await t.get('/settings/system');
	const m = /value="([^"]+)" readonly data-modal-token/.exec(await res.text());
	if (!m) throw new Error('could not read the new MCP token from Tesserae');
	setSetting(db, 'tesserae_mcp_token', m[1]);
	t.setMcpToken(m[1]);
	await t.mcp('GET', '/pages');
}

interface WallSettings {
	tesseraePageId?: string;
	page?: string;
	templateHash?: string;
	sim?: boolean;
}

function settingsOf(db: DB, id: string): WallSettings {
	const row = db.select().from(device).where(eq(device.id, id)).get();
	return row ? (JSON.parse(row.settingsJson) as WallSettings) : {};
}

function templateHash(baseUrl: string, page: string): string {
	return createHash('sha256').update(JSON.stringify(checkedInWallPage())).update(baseUrl).update(page).digest('hex').slice(0, 16);
}

/**
 * Make Tesserae show the wall page for `deviceId`. Re-imports (and re-keys the
 * device token, which lives in the page) only when the page is missing, the
 * template changed or the token no longer matches.
 */
export async function ensureWallPage(db: DB, t: TesseraeAdmin, deviceId: string, page = 'home', force = false): Promise<string> {
	const base = env().APP_BASE_URL_FOR_TESSERAE;
	const s = settingsOf(db, deviceId);
	const pages = (await t.mcp<{ pages: Array<{ id: string; device_ids: string[] }> }>('GET', '/pages')).pages;
	const live = s.tesseraePageId ? pages.find((p) => p.id === s.tesseraePageId) : undefined;
	const hash = templateHash(base, page);
	if (live && !force && s.templateHash === hash) {
		const canvas = await t.mcp<{ els: Array<Record<string, unknown>> }>('GET', `/pages/${live.id}/canvas`);
		const token = tokenInPage(canvas);
		const row = db.select().from(device).where(eq(device.id, deviceId)).get();
		if (token && row && hashToken(token) === row.tokenHash) {
			if (!live.device_ids.includes(deviceId)) await t.mcp('POST', `/pages/${live.id}/devices`, { device_ids: [deviceId] });
			return live.id;
		}
	}
	const token = issueDeviceToken(db, deviceId);
	const pageId = live?.id ?? (await t.mcp<{ id: string }>('POST', '/pages', { name: `Family Hub · ${deviceId}`, w: 1404, h: 1872 })).id;
	await t.mcp('PUT', `/pages/${pageId}/canvas`, fillWallPage(checkedInWallPage(), { baseUrl: base, device: deviceId, page, token }));
	await t.mcp('POST', `/pages/${pageId}/devices`, { device_ids: [deviceId] });
	db.update(device)
		.set({ settingsJson: JSON.stringify({ ...s, tesseraePageId: pageId, page, templateHash: hash }) })
		.where(eq(device.id, deviceId))
		.run();
	return pageId;
}

export interface SimDeviceCreds {
	id: string;
	token: string;
}

/** Register the simulator's fake E1003 with Tesserae (pairing code → register). */
async function ensureSimDevice(db: DB, t: TesseraeAdmin): Promise<SimDeviceCreds> {
	const id = env().SIM_DEVICE_ID;
	const base = env().TESSERAE_URL!;
	const known = (await t.mcp<{ devices: Array<{ id: string }> }>('GET', '/devices')).devices.some((d) => d.id === id);
	let creds = getSetting<SimDeviceCreds | null>(db, 'sim_tesserae_device', null);
	if (!known || !creds || creds.id !== id) {
		const { code } = await t.adminJson<{ code: string }>('/api/v1/device/admin/pairing/issue', { note: 'Family Hub simulator' });
		const fake = new FakeDevice(base, id, `02:fa:${id.length.toString(16).padStart(2, '0')}:00:00:01`);
		await fake.register(code);
		creds = { id: fake.id, token: fake.token };
		setSetting(db, 'sim_tesserae_device', creds);
	}
	const fake = new FakeDevice(base, creds.id, '');
	fake.token = creds.token;
	await fake.status(); // advertise proto v2 / overlay schema 2 / can_stay_awake
	if (!db.select().from(device).where(eq(device.id, creds.id)).get()) {
		issueDeviceToken(db, creds.id, 'Simulator (fake E1003)');
		db.update(device).set({ settingsJson: JSON.stringify({ sim: true }) }).where(eq(device.id, creds.id)).run();
	}
	return creds;
}

/** The wall's fonts (docs/design.md), cached once in Tesserae: its render sandbox has no network,
 * and its font fetch refuses LAN addresses, so they come from the public npm CDN, pinned to the
 * same Fontsource files the Planner bundles. A failure only costs the look (CSS falls back). */
export const WALL_FONTS = [
	{ family: 'FH Fraunces', url: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/fraunces@5.3.0/files/fraunces-latin-full-normal.woff2' },
	{ family: 'FH Outfit', url: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/outfit@5.3.0/files/outfit-latin-wght-normal.woff2' }
];
async function ensureWallFonts(t: TesseraeAdmin): Promise<string> {
	try {
		const have = new Set((await t.mcp<{ fonts: Array<{ name?: string }> }>('GET', '/fonts')).fonts.map((f) => f.name));
		const missing = WALL_FONTS.filter((f) => !have.has(f.family));
		for (const f of missing) await t.mcp('POST', '/fonts', { family: f.family, url: f.url, weight: 400 });
		return missing.length ? `fonts cached: ${missing.map((f) => f.family).join(', ')}` : 'fonts ok';
	} catch (e) {
		return `fonts not cached (wall uses fallback fonts): ${(e as Error).message}`;
	}
}

export interface BootstrapReport {
	steps: string[];
	simDevice?: SimDeviceCreds;
}

/** Idempotent first-run setup of a Tesserae instance for Family Hub. */
export async function bootstrapTesserae(db: DB, log: (m: string) => void = () => {}): Promise<BootstrapReport> {
	const e = env();
	const report: BootstrapReport = { steps: [] };
	const step = (m: string) => {
		report.steps.push(m);
		log(m);
	};
	if (!e.TESSERAE_URL || !e.TESSERAE_ADMIN_PASSWORD || !e.TESSERAE_PUSH_TOKEN) {
		throw new Error('TESSERAE_URL, TESSERAE_ADMIN_PASSWORD and TESSERAE_PUSH_TOKEN are required');
	}
	await waitForTesserae(e.TESSERAE_URL);
	const t = tesseraeClient(db);
	if (await t.setupPending()) {
		await t.setup();
		step('admin password set');
	}
	await t.login();
	await t.form('/onboarding/skip', {});
	await t.form('/onboarding/timezone', { timezone: e.TZ_HOUSEHOLD });
	await t.form('/settings/system/webhook/set', { webhook_token: e.TESSERAE_PUSH_TOKEN });
	step(`timezone ${e.TZ_HOUSEHOLD}, webhook token set`);
	await ensureMcpToken(db, t);
	step('MCP token ok');
	const installed = await t.mcp<{ widgets?: Array<{ id?: string; key?: string; version?: string }> }>('GET', '/widgets?origin=authored');
	const current = (installed.widgets ?? []).find((w) => (w.id ?? w.key) === 'family_hub');
	if (current?.version !== widgetVersion(WIDGET_DIR)) {
		await t.mcp('POST', '/widgets/install?reload=in_process', packWidget(WIDGET_DIR));
		step(`widget family_hub ${widgetVersion(WIDGET_DIR)} installed`);
	}
	step(await ensureWallFonts(t));
	report.simDevice = await ensureSimDevice(db, t);
	step(`simulator device ${report.simDevice.id} registered`);
	const walls = db.select().from(device).all();
	for (const d of walls) {
		const s = JSON.parse(d.settingsJson) as WallSettings;
		if (s.sim || s.tesseraePageId) {
			const id = await ensureWallPage(db, t, d.id, s.page ?? 'home');
			step(`wall page for ${d.id}: ${id}`);
		}
	}
	return report;
}
