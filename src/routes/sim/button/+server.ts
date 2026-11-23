import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import { hhmm } from '$lib/server/domain/time';
import { applyButton, WALL_BUTTONS } from '$lib/server/domain/buttons';
import { DIRECT_SIM_DEVICE, hub } from '$lib/server/hub';
import { publish } from '$lib/server/events';
import { parseJson } from '$lib/server/api';

// The wall's front buttons in the simulator (ADR-28). Glass: the fake E1003 (through the same
// screen logic Tesserae's button webhook reaches); direct: the pseudo device "sim-direct".
const body = z.object({ button: z.enum(WALL_BUTTONS), glass: z.boolean().default(false) });

export const POST: RequestHandler = async ({ request }) => {
	const p = body.safeParse(parseJson(await request.text()));
	if (!p.success) return json({ error: 'bad request' }, { status: 400 });
	const deviceId = p.data.glass ? hub().simWall?.id : DIRECT_SIM_DEVICE;
	if (!deviceId) return json({ error: 'simulator device not connected' }, { status: 503 });
	const { to } = applyButton(db(), deviceId, 'home', p.data.button, { tz: env().TZ_HOUSEHOLD, rolloverMinutes: hhmm(env().DAY_ROLLOVER) });
	void hub().repainter.notify([], { full: true, deviceId });
	publish({ type: 'change', memberId: null, reason: 'sim' });
	return json({ screen: to.screen, label: to.label });
};
