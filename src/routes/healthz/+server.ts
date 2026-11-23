import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

export const GET: RequestHandler = () => {
	db().$client.prepare('select 1').get();
	return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
