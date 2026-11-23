import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { hub } from '$lib/server/hub';

export const GET: RequestHandler = () => {
	const h = hub();
	const wall = h.simWall;
	wall?.watch();
	return json({
		bootstrap: { state: h.bootstrap.state, error: h.bootstrap.error ?? null },
		wall: wall ? { id: wall.id, stats: wall.stats, regions: wall.tapRegions(), hasFrame: wall.hasFrame() } : null
	});
};
