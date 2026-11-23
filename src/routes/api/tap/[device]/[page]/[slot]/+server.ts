import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { handleTap } from '$lib/server/api';
import { hub } from '$lib/server/hub';

export const POST: RequestHandler = ({ request, url, params }) =>
	handleTap(db(), request, url, params, { repainter: hub().repainter, limiter: hub().tapLimiter, watch: (id) => hub().tapWatch?.watch(id) });
