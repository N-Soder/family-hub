import { z } from 'zod';
import type { DB } from './db';
import { env } from './env';
import { authenticateDevice, presentedToken } from './auth/device';
import { isKnownPage, renderForDevice, MAX_TAP_SLOT, type RenderPayload } from './domain/render';
import { applyWallTap, type WallTapResult } from './domain/toggle';
import { applyButton, WALL_BUTTONS } from './domain/buttons';
import { hhmm } from './domain/time';
import type { Repainter } from './tesserae/repaint';
import type { RateLimiter } from './auth/device';
import { publish } from './events';

// HTTP handlers as plain functions so integration tests can call them directly.

export const deviceId = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/);
export const pageId = z.string().refine(isKnownPage, 'unknown page');
export const slotNo = z.coerce.number().int().min(1).max(MAX_TAP_SLOT);
// Tesserae's webhook body (fields we read; everything else ignored).
export const webhookBody = z
	.object({ device_id: z.string().optional(), region_id: z.string().optional(), touch_event_id: z.number().optional() })
	.passthrough();

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function handleRender(db: DB, request: Request, url: URL, params: { device: string; page: string }, now?: Date): Response {
	const dev = deviceId.safeParse(params.device);
	const page = pageId.safeParse(params.page);
	if (!dev.success || !page.success) return json(404, { error: 'not found' });
	const auth = authenticateDevice(db, dev.data, presentedToken(request, url));
	if (!auth.ok) return json(auth.status, { error: auth.status === 403 ? 'forbidden' : 'unauthorized' });
	const payload: RenderPayload = renderForDevice(db, dev.data, page.data, {
		now,
		tz: env().TZ_HOUSEHOLD,
		rolloverMinutes: hhmm(env().DAY_ROLLOVER)
	});
	return json(200, payload);
}

/** JSON.parse that returns undefined for bad JSON, so Zod turns it into a 400 (audit L4). */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export async function handleTap(
	db: DB,
	request: Request,
	url: URL,
	params: { device: string; page: string; slot: string },
	deps: { repainter: Repainter; limiter: RateLimiter; watch?: (deviceId: string) => void },
	now?: Date
): Promise<Response> {
	const dev = deviceId.safeParse(params.device);
	const page = pageId.safeParse(params.page);
	const slot = slotNo.safeParse(params.slot);
	if (!dev.success || !page.success || !slot.success) return json(404, { error: 'not found' });
	const auth = authenticateDevice(db, dev.data, presentedToken(request, url));
	if (!auth.ok) return json(auth.status, { error: auth.status === 403 ? 'forbidden' : 'unauthorized' });
	if (!deps.limiter.allow(dev.data)) return json(429, { error: 'rate limited' });
	let body: z.infer<typeof webhookBody> = {};
	const text = await request.text();
	if (text) {
		const parsed = webhookBody.safeParse(parseJson(text));
		if (!parsed.success) return json(400, { error: 'bad body' });
		body = parsed.data;
	}
	if (body.device_id && body.device_id !== dev.data) return json(403, { error: 'device mismatch' });
	const result: WallTapResult = applyWallTap(db, { deviceId: dev.data, page: page.data, slot: slot.data, regionId: body.region_id, now });
	afterWallTap(result, dev.data, deps.repainter);
	// Taps cluster: watch this wall for taps Tesserae drops before they reach us.
	deps.watch?.(dev.data);
	const { status, ...rest } = result;
	return json(status, rest);
}

/** Repaint after a wall tap (after responding: Tesserae's webhook is fire-and-forget). */
export function afterWallTap(result: WallTapResult, device: string, repainter: Repainter): void {
	if (result.applied && 'screen' in result) {
		// Another screen (or routines tab): a different layout on this wall only.
		queueMicrotask(() => void repainter.notify([], { full: true, deviceId: device }));
	} else if (result.applied && 'item' in result) {
		// Every wall showing list items: the lists, or home's TO DO.
		queueMicrotask(() => void repainter.notify([`i${result.item}`], { screen: ['lists', 'home'] }));
		publish({ type: 'change', memberId: null, reason: 'list' });
	} else if (result.applied) {
		queueMicrotask(() => void repainter.notify([result.step]));
		publish({ type: 'change', memberId: null, reason: 'tap' });
	} else if (result.reason !== 'deduped') {
		// The device already inverted the tapped box; with no change coming, only a full
		// frame clears it. (A deduped tap's box is covered by the first tap's repaint.)
		queueMicrotask(() => void repainter.notify([], { full: true, deviceId: device }));
	}
}

export const wallButton = z.enum(WALL_BUTTONS);

/**
 * A front-button press on the wall (ADR-28), sent by Tesserae's `webhook:` button action.
 * Tesserae already drops retried presses (same event id), so every call here moves one screen.
 */
export async function handleButton(
	db: DB,
	request: Request,
	url: URL,
	params: { device: string; page: string; button: string },
	deps: { repainter: Repainter; limiter: RateLimiter },
	now?: Date
): Promise<Response> {
	const dev = deviceId.safeParse(params.device);
	const page = pageId.safeParse(params.page);
	const button = wallButton.safeParse(params.button);
	if (!dev.success || !page.success || !button.success) return json(404, { error: 'not found' });
	const auth = authenticateDevice(db, dev.data, presentedToken(request, url));
	if (!auth.ok) return json(auth.status, { error: auth.status === 403 ? 'forbidden' : 'unauthorized' });
	if (!deps.limiter.allow(dev.data)) return json(429, { error: 'rate limited' });
	const text = await request.text();
	if (text) {
		const parsed = webhookBody.safeParse(parseJson(text));
		if (!parsed.success) return json(400, { error: 'bad body' });
		if (parsed.data.device_id && parsed.data.device_id !== dev.data) return json(403, { error: 'device mismatch' });
	}
	const { to } = applyButton(db, dev.data, page.data, button.data, { now, tz: env().TZ_HOUSEHOLD, rolloverMinutes: hhmm(env().DAY_ROLLOVER) });
	// A new screen: a full frame on this wall (the middle button on home also redraws it clean).
	queueMicrotask(() => void deps.repainter.notify([], { full: true, deviceId: dev.data }));
	return json(200, { screen: to.screen, member: to.member, label: to.label });
}
