import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/events';
import { hub } from '$lib/server/hub';

// Server-sent events: state changes, pushes and simulator frames. Used by /sim
// now and by the Board in Stage 2.
export const GET: RequestHandler = ({ request }) => {
	let stop = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			send('hello', { at: new Date().toISOString() });
			const unsub = subscribe((e) => {
				if (e.type === 'frame' || e.type === 'push') hub().simWall?.watch();
				send(e.type, e);
			});
			const ka = setInterval(() => {
				hub().simWall?.watch();
				controller.enqueue(enc.encode(':ka\n\n'));
			}, 15_000);
			stop = () => {
				clearInterval(ka);
				unsub();
			};
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			stop();
		}
	});
	hub().simWall?.watch();
	return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } });
};
