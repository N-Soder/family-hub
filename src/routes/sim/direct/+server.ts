import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import { hhmm } from '$lib/server/domain/time';
import { MAX_TAP_SLOT, renderForDevice } from '$lib/server/domain/render';
import { applyWallTap } from '$lib/server/domain/toggle';
import { afterWallTap, parseJson } from '$lib/server/api';
import { DIRECT_SIM_DEVICE, hub } from '$lib/server/hub';
import { publish } from '$lib/server/events';

// Direct mode: no Tesserae. Same payload and painter; taps go through the same
// tap logic as /api/tap, as the pseudo device "sim-direct".
const opts = () => ({ tz: env().TZ_HOUSEHOLD, rolloverMinutes: hhmm(env().DAY_ROLLOVER) });

export const GET: RequestHandler = () => json(renderForDevice(db(), DIRECT_SIM_DEVICE, 'home', opts()));

const body = z.object({ slot: z.number().int().min(1).max(MAX_TAP_SLOT) });

export const POST: RequestHandler = async ({ request }) => {
	const p = body.safeParse(parseJson(await request.text()));
	if (!p.success) return json({ error: 'bad request' }, { status: 400 });
	const res = applyWallTap(db(), { deviceId: DIRECT_SIM_DEVICE, page: 'home', slot: p.data.slot });
	afterWallTap(res, DIRECT_SIM_DEVICE, hub().repainter);
	// Other open simulator tabs repaint on this (the Planner's list pages too).
	if (res.applied && 'screen' in res) publish({ type: 'change', memberId: null, reason: 'sim' });
	const { status, ...rest } = res;
	return json(rest, { status });
};
