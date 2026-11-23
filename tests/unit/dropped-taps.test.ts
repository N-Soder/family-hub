import { describe, expect, it } from 'vitest';
import { DroppedTapWatch, type TouchEvent } from '../../src/lib/server/tesserae/dropped-taps';

function setup(startMs = 1_000_000) {
	const events: TouchEvent[] = [];
	const repainted: string[] = [];
	const watch = new DroppedTapWatch({ recent: async () => [...events].reverse() }, (id) => repainted.push(id), { now: () => startMs });
	const add = (id: number, status: string, atMs = startMs + id) => events.push({ id, status, timestamp: atMs / 1000 });
	return { watch, add, repainted };
}

describe('dropped-tap watch', () => {
	it('ignores drops from before start-up, then repaints once per new drop', async () => {
		const { watch, add, repainted } = setup();
		add(1, 'stale', 1_000_000 - 60_000); // before start-up
		add(2, 'webhook_dispatched');
		expect(await watch.check('wall-1')).toBe(false);
		add(3, 'stale');
		expect(await watch.check('wall-1')).toBe(true);
		expect(await watch.check('wall-1')).toBe(false); // already handled
		expect(repainted).toEqual(['wall-1']);
	});

	it('a stale tap right after start-up still counts; deduped and dispatched taps do not', async () => {
		const { watch, add, repainted } = setup();
		add(1, 'deduped');
		add(2, 'webhook_dispatched');
		expect(await watch.check('wall-1')).toBe(false);
		add(3, 'unmapped');
		expect(await watch.check('wall-1')).toBe(true);
		const fresh = setup();
		fresh.add(1, 'stale');
		expect(await fresh.watch.check('wall-1')).toBe(true);
		expect(repainted).toEqual(['wall-1']);
	});
});
