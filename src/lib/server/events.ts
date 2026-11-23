import { EventEmitter } from 'node:events';

// In-process change feed for SSE (/api/events). The Board reuses it in Stage 2.
export type HubEvent =
	| { type: 'change'; memberId: number | null; reason: string; noteId?: number }
	| { type: 'frame'; deviceId: string; seq: number; latencyMs?: number; kind: 'patch' | 'full' }
	| { type: 'push'; deviceId: string; mode: 'patch' | 'full'; ms: number; status: string };

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publish(event: HubEvent): void {
	bus.emit('event', event);
}

export function subscribe(fn: (e: HubEvent) => void): () => void {
	bus.on('event', fn);
	return () => bus.off('event', fn);
}
