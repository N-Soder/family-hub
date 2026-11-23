import type { RequestHandler } from './$types';
import { hub } from '$lib/server/hub';

// What the fake E1003's framebuffer holds right now (full frames + applied patches).
export const GET: RequestHandler = () => {
	const wall = hub().simWall;
	if (!wall?.hasFrame()) return new Response('no frame yet', { status: 404 });
	wall.watch();
	return new Response(new Uint8Array(wall.snapshotPng()), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
};
