import type { RequestHandler } from './$types';
import { painterSource } from '$lib/server/tesserae/page';

// The exact painter the Tesserae code element runs, for the direct-mode simulator.
export const GET: RequestHandler = () =>
	new Response(painterSource(), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
