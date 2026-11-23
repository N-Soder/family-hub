import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { hub } from '$lib/server/hub';
import { parseJson } from '$lib/server/api';

// Taps on the glass view are reported to Tesserae exactly as the E1003 would
// (POST /api/v1/device/<id>/tap with region id); Tesserae then fires the
// authenticated webhook back to /api/tap.
const body = z.object({ regionId: z.string().min(1).max(100) });

export const POST: RequestHandler = async ({ request }) => {
	const wall = hub().simWall;
	if (!wall) return json({ error: 'simulator device not connected' }, { status: 503 });
	const p = body.safeParse(parseJson(await request.text()));
	if (!p.success) return json({ error: 'bad request' }, { status: 400 });
	return json(await wall.tap(p.data.regionId));
};
