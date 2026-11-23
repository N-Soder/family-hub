import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seededDb, perth, withDevice } from '../helpers';
import { device } from '../../src/lib/server/db/schema';
import { Repainter, type Pusher } from '../../src/lib/server/tesserae/repaint';

function recorder() {
	const calls: string[] = [];
	const pusher: Pusher = {
		patch: async (page, dev) => (calls.push(`patch ${dev}@${page}`), { ok: true, status: 'sent', ms: 1 }),
		full: async (page, dev) => (calls.push(`full ${dev}@${page}`), { ok: true, status: 'sent', ms: 1 })
	};
	return { calls, pusher };
}

async function setup(now = perth('2026-10-26', '07:00')) {
	const db = await seededDb();
	withDevice(db, 'wall-1');
	db.update(device).set({ settingsJson: JSON.stringify({ tesseraePageId: 'tp1', page: 'home' }) }).where(eq(device.id, 'wall-1')).run();
	const clock = { now };
	const { calls, pusher } = recorder();
	const r = new Repainter(() => db, pusher, () => clock.now);
	return { db, r, calls, clock };
}

describe('repaint rule (patch vs full frame)', () => {
	it('first push is full (unknown anchor); a row’s first change is a patch; changing it back is full', async () => {
		const { r, calls } = await setup();
		await r.notify([], { full: true });
		await r.notify([11]);
		await r.notify([12]);
		await r.notify([11]);
		await r.notify([11]);
		expect(calls).toEqual(['full wall-1@tp1', 'patch wall-1@tp1', 'patch wall-1@tp1', 'full wall-1@tp1', 'patch wall-1@tp1']);
	});

	it('a routine switch forces a full frame on the next change and on the ticker', async () => {
		const { r, calls, clock } = await setup();
		await r.notify([], { full: true });
		clock.now = perth('2026-10-26', '12:00'); // morning window closed
		await r.tick();
		await r.tick(); // nothing new
		expect(calls).toEqual(['full wall-1@tp1', 'full wall-1@tp1']);
		clock.now = perth('2026-10-26', '18:31'); // bedtime opens
		await r.notify([99]);
		expect(calls.at(-1)).toBe('full wall-1@tp1');
	});

	it('coalesces bursts while a push is in flight', async () => {
		const { r, calls } = await setup();
		await r.notify([], { full: true });
		const all = Promise.all([r.notify([1]), r.notify([2]), r.notify([3])]);
		await all;
		expect(calls.length).toBeLessThanOrEqual(3); // full + at most two patches, not four pushes
		expect(calls.slice(1).every((c) => c.startsWith('patch'))).toBe(true);
	});

	it('a failed push forgets the anchor so the next one is full', async () => {
		const db = await seededDb();
		withDevice(db, 'wall-1');
		db.update(device).set({ settingsJson: JSON.stringify({ tesseraePageId: 'tp1' }) }).where(eq(device.id, 'wall-1')).run();
		const calls: string[] = [];
		let fail = false;
		const r = new Repainter(() => db, {
			patch: async () => (calls.push('patch'), { ok: !fail, status: fail ? 'failed' : 'sent', ms: 0 }),
			full: async () => (calls.push('full'), { ok: true, status: 'sent', ms: 0 })
		}, () => perth('2026-10-26', '07:00'));
		await r.notify([], { full: true });
		fail = true;
		await r.notify([1]);
		fail = false;
		await r.notify([2]);
		expect(calls).toEqual(['full', 'patch', 'full']);
	});

	it('does nothing without Tesserae', async () => {
		const db = await seededDb();
		await new Repainter(() => db, null).notify([1]);
	});
});
