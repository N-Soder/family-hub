import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db';
import { seed } from '../../src/lib/server/seed';
import { device, member, servedSnapshot, setting, completionEvent, routineStep, routineTemplate } from '../../src/lib/server/db/schema';
import { handleButton, handleRender, handleTap } from '../../src/lib/server/api';
import { RateLimiter } from '../../src/lib/server/auth/device';
import { Repainter, type Pusher } from '../../src/lib/server/tesserae/repaint';
import { seededDb, withDevice, perth } from '../helpers';
import { wallScreens } from '../../src/lib/server/domain/screens';

const MON_7AM = perth('2026-10-26', '07:00');

function req(path: string, init: RequestInit & { token?: string } = {}) {
	const url = new URL(`http://family-hub:3000${path}`);
	const headers = new Headers(init.headers);
	if (init.token) headers.set('authorization', `Bearer ${init.token}`);
	return { request: new Request(url, { ...init, headers }), url };
}

async function world() {
	wallScreens.reset();
	const db = await seededDb();
	const token = withDevice(db, 'wall-1');
	const other = withDevice(db, 'wall-2');
	db.update(device).set({ settingsJson: JSON.stringify({ tesseraePageId: 'tp-wall-1', page: 'home' }) }).where(eq(device.id, 'wall-1')).run();
	const pushes: string[] = [];
	const pusher: Pusher = {
		patch: async (p, d) => (pushes.push(`patch ${d}`), { ok: true, status: 'sent', ms: 1 }),
		full: async (p, d) => (pushes.push(`full ${d}`), { ok: true, status: 'sent', ms: 1 })
	};
	const deps = { repainter: new Repainter(() => db, pusher, () => MON_7AM), limiter: new RateLimiter() };
	return { db, token, other, deps, pushes };
}

describe('GET /api/render/{device}/{page}.json', () => {
	it('401 without a bearer, 403 with another device’s, 200 + served_snapshot with its own', async () => {
		const { db, token, other } = await world();
		const path = '/api/render/wall-1/home.json';
		let r = req(path);
		expect(handleRender(db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).status).toBe(401);
		r = req(path, { token: other });
		expect(handleRender(db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).status).toBe(403);
		r = req(path, { token });
		const res = handleRender(db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM);
		expect(res.status).toBe(200);
		const body = await res.json();
		// Home: the checklist is behind the Routines button, which says one is on.
		expect(body.routines_nav).toEqual({ touch_id: 'nroutines-s22', sub: 'Ari to do' });
		expect(body.slots).toEqual([]);
		wallScreens.set('wall-1', 'routines', MON_7AM);
		const routines = await handleRender(db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
		expect(routines.children[0].routine.name).toBe('Morning');
		expect(routines.slots).toHaveLength(6);
		expect(routines.slots[0].touch_id).toMatch(/^o\d+-s1$/);
		expect(db.select().from(servedSnapshot).all()).toHaveLength(2);
		expect(db.select().from(device).where(eq(device.id, 'wall-1')).get()!.lastSeen).not.toBeNull();
	});
	it('404 for unknown pages and malformed ids', async () => {
		const { db, token } = await world();
		const r = req('/api/render/wall-1/nope.json', { token });
		expect(handleRender(db, r.request, r.url, { device: 'wall-1', page: 'nope' }).status).toBe(404);
		expect(handleRender(db, r.request, r.url, { device: 'Bad Id', page: 'home' }).status).toBe(404);
	});
});

describe('POST /api/tap/{device}/{page}/{slot}', () => {
	const tap = async (w: Awaited<ReturnType<typeof world>>, slot: number, opts: { token?: string; query?: string; body?: unknown; now?: Date } = {}) => {
		const r = req(`/api/tap/wall-1/home/${slot}${opts.query ?? ''}`, {
			method: 'POST',
			token: opts.token,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
			headers: { 'content-type': 'application/json', 'user-agent': 'tesserae-button-webhook/1' }
		});
		const res = await w.deps.repainter.notify([]).then(() =>
			handleTap(w.db, r.request, r.url, { device: 'wall-1', page: 'home', slot: String(slot) }, w.deps, opts.now ?? MON_7AM)
		);
		await new Promise((r) => setTimeout(r, 5)); // let the post-response repaint run
		return { status: res.status, body: await res.json() };
	};

	it('rejects a missing or wrong token (the bad/missing-token integration test)', async () => {
		const w = await world();
		expect((await tap(w, 1)).status).toBe(401);
		expect((await tap(w, 1, { query: '?k=wrong' })).status).toBe(401);
		expect((await tap(w, 1, { query: `?k=${w.other}` })).status).toBe(403);
		expect(w.db.select().from(completionEvent).all()).toHaveLength(0);
	});

	it('409 on an unknown snapshot; empty slot → 200 applied:false', async () => {
		const w = await world();
		expect(await tap(w, 1, { query: `?k=${w.token}` })).toMatchObject({ status: 409, body: { reason: 'no_snapshot' } });
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM);
		expect(await tap(w, 8, { query: `?k=${w.token}` })).toEqual({ status: 200, body: { applied: false, reason: 'empty_slot' } });
	});

	it('a rejected tap gets a full frame (clears the device’s invert); a deduped one does not; every tap starts the drop watch', async () => {
		const w = await world();
		const watched: string[] = [];
		w.deps = { ...w.deps, watch: (id: string) => watched.push(id) } as typeof w.deps;
		wallScreens.set('wall-1', 'routines', MON_7AM);
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM);
		await tap(w, 8, { query: `?k=${w.token}` }); // empty slot
		expect(w.pushes.at(-1)).toBe('full wall-1');
		await tap(w, 1, { query: `?k=${w.token}` });
		expect(w.pushes.at(-1)).toBe('patch wall-1');
		const before = w.pushes.length;
		expect((await tap(w, 1, { query: `?k=${w.token}` })).body).toMatchObject({ reason: 'deduped' });
		expect(w.pushes.slice(before)).not.toContain('full wall-1');
		expect(watched).toEqual(['wall-1', 'wall-1', 'wall-1']);
	});

	it('applies a good tap (token in the URL, Tesserae webhook body) and records a push', async () => {
		const w = await world();
		wallScreens.set('wall-1', 'routines', MON_7AM);
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		const payload = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
		const res = await tap(w, 1, {
			query: `?k=${w.token}`,
			body: { device_id: 'wall-1', region_id: `el:${payload.slots[0].touch_id}:tap`, touch_event_id: 7, gesture: 'tap' }
		});
		expect(res).toMatchObject({ status: 200, body: { applied: true, state: 'done' } });
		expect(w.pushes.at(-1)).toBe('patch wall-1');
		// The body's device must match the path.
		expect((await tap(w, 2, { query: `?k=${w.token}`, body: { device_id: 'wall-2' } })).status).toBe(403);
	});

	it('the Lists button (slot 20) opens the lists on that wall with a full frame; slot 27 is not a slot', async () => {
		const w = await world();
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		const home = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
		expect(home.nav).toEqual({ to: 'lists', touch_id: 'nlists-s20' });
		try {
			const res = await tap(w, 20, { query: `?k=${w.token}`, body: { device_id: 'wall-1', region_id: 'el:nlists-s20:tap' } });
			expect(res).toEqual({ status: 200, body: { applied: true, screen: 'lists' } });
			expect(w.pushes.at(-1)).toBe('full wall-1');
			const lists = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
			expect(lists).toMatchObject({ screen: 'lists', nav: { to: 'home' }, lists: [{ name: 'Shopping', items: [] }] });
			expect((await tap(w, 27, { query: `?k=${w.token}` })).status).toBe(404);
		} finally {
			wallScreens.reset();
		}
	});

	it("the Routines button (slot 22) opens the routines; the baby's tab (slot 24) shows the plan", async () => {
		const w = await world();
		const baby = w.db.insert(member).values({ name: 'Juno', shortLabel: 'JUN', kind: 'baby', sort: 1, icon: 'baby' }).returning().get();
		const plan = w.db.insert(routineTemplate).values({ memberId: baby.id, name: '6–9 months', kind: 'plan', windowStart: '00:00', windowEnd: '23:59' }).returning().get();
		w.db.insert(routineStep).values({ templateId: plan.id, title: 'Milk', icon: 'bottle', sort: 0, dueAt: '07:00' }).run();
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		const home = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
		expect(home.routines_nav.touch_id).toBe('nroutines-s22');
		try {
			const res = await tap(w, 22, { query: `?k=${w.token}`, body: { device_id: 'wall-1', region_id: 'el:nroutines-s22:tap' } });
			expect(res).toEqual({ status: 200, body: { applied: true, screen: 'routines' } });
			expect(w.pushes.at(-1)).toBe('full wall-1');
			const first = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
			// Ari's morning routine is on, so the screen opens on Ari.
			expect(first).toMatchObject({ screen: 'routines', tabs: [{ name: 'Ari', on: true }, { name: 'Juno', on: false, touch_id: 'nroutines-s24' }] });
			expect(await tap(w, 24, { query: `?k=${w.token}`, body: { device_id: 'wall-1', region_id: 'el:nroutines-s24:tap' } })).toEqual({ status: 200, body: { applied: true, screen: 'routines' } });
			const shown = await handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM).json();
			expect(shown).toMatchObject({ screen: 'routines', nav: { to: 'home' }, plan: { name: 'Juno', rows: [{ title: 'Milk', time: '7:00 am' }] } });
		} finally {
			wallScreens.reset();
		}
	});

	it('rate-limits a device to 10 taps per 10 s', async () => {
		const w = await world();
		const r = req('/api/render/wall-1/home.json', { token: w.token });
		handleRender(w.db, r.request, r.url, { device: 'wall-1', page: 'home' }, MON_7AM);
		const codes: number[] = [];
		for (let i = 0; i < 11; i++) codes.push((await tap(w, 8, { query: `?k=${w.token}` })).status);
		expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
		expect(codes[10]).toBe(429);
	});
});

describe('migrations and seed', () => {
	it('apply cleanly to an empty database and seeding is idempotent', async () => {
		const db = openDb(':memory:');
		expect((await seed(db, { pin: '112233' })).seeded).toBe(true);
		expect((await seed(db, { pin: '445566' })).seeded).toBe(false);
		expect(db.select().from(member).all()).toHaveLength(1);
		expect(db.select().from(setting).where(eq(setting.key, 'planner_pin_hash')).get()).toBeTruthy();
	});
});

describe('POST /api/button/{device}/{page}/{button} (ADR-28)', () => {
	const press = (w: Awaited<ReturnType<typeof world>>, button: string, token?: string) => {
		const r = req(`/api/button/wall-1/home/${button}`, { method: 'POST', token, body: JSON.stringify({ device_id: 'wall-1', button: 'right', button_event_id: 7 }) });
		return handleButton(w.db, r.request, r.url, { device: 'wall-1', page: 'home', button }, w.deps, MON_7AM);
	};
	it('needs the device token, repaints Home and sends a full frame', async () => {
		const w = await world();
		expect((await press(w, 'next')).status).toBe(401);
		expect((await press(w, 'next', w.other)).status).toBe(403);
		expect((await press(w, 'sideways', w.token)).status).toBe(404);
		const res = await press(w, 'next', w.token);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ screen: 'home', label: 'Home' });
		await new Promise((r) => setTimeout(r, 20));
		expect(w.pushes).toContain('full wall-1');
		expect(await (await press(w, 'home', w.token)).json()).toMatchObject({ screen: 'home' });
	});
});

describe('bad input gets a 400, not a 500', () => {
	it('malformed JSON on /api/tap', async () => {
		const w = await world();
		const r = req('/api/tap/wall-1/home/1', { method: 'POST', token: w.token, body: '{not json', headers: { 'content-type': 'application/json' } });
		const res = await handleTap(w.db, r.request, r.url, { device: 'wall-1', page: 'home', slot: '1' }, w.deps, MON_7AM);
		expect(res.status).toBe(400);
	});

	it('an unknown step id in the Routines, Home and kid view toggle actions', async () => {
		const w = await world();
		const { setDb } = await import('../../src/lib/server/db');
		setDb(w.db);
		const form = new URLSearchParams({ stepId: '99999', done: '1' });
		const post = () => new Request('http://localhost/planner?/toggle', { method: 'POST', body: form });
		const routines = await import('../../src/routes/planner/routines/+page.server');
		const home = await import('../../src/routes/planner/+page.server');
		const kids = await import('../../src/routes/planner/kids/+page.server');
		for (const action of [routines.actions.toggle!, home.actions.step!, kids.actions.toggle!]) {
			const res = (await action({ request: post() } as never)) as { status: number; data: { error: string } };
			expect(res).toMatchObject({ status: 400, data: { error: 'That step is gone. Reload the page.' } });
		}
		// Home's To do row: an item that has gone.
		const item = (await home.actions.item!({ request: new Request('http://localhost/planner?/item', { method: 'POST', body: new URLSearchParams({ itemId: '99999' }) }) } as never)) as { status: number };
		expect(item).toMatchObject({ status: 400 });
		setDb(null);
	});
});

describe('routine step actions check the step belongs to the routine (audit L1)', () => {
	it('a step id from another routine is refused and left alone', async () => {
		const db = await seededDb();
		const { setDb } = await import('../../src/lib/server/db');
		setDb(db);
		const [a, b] = db.select().from(routineTemplate).all();
		const theirs = db.select().from(routineStep).where(eq(routineStep.templateId, b.id)).all()[0];
		const mine = db.select().from(routineStep).where(eq(routineStep.templateId, a.id)).all()[0];
		const { actions } = await import('../../src/routes/planner/routines/[id]/+page.server');
		const post = (action: string, fields: Record<string, string>) =>
			actions[action]!({ request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams(fields) }), params: { id: String(a.id) } } as never) as Promise<
				{ status?: number } | undefined
			>;
		for (const action of ['up', 'down', 'delete']) expect((await post(action, { stepId: String(theirs.id) }))?.status).toBe(400);
		const edit = (id: number) => ({ stepId: String(id), title: 'Hijacked', icon: theirs.icon ?? '', active: 'on' });
		expect(await post('saveStep', edit(theirs.id))).toMatchObject({ status: 400, data: { stepErrors: { form: 'Bad step' } } });
		const after = db.select().from(routineStep).where(eq(routineStep.id, theirs.id)).get()!;
		expect(after).toMatchObject({ title: theirs.title, sort: theirs.sort, deletedAt: null });
		// Its own step still works.
		expect(await post('saveStep', edit(mine.id))).toEqual({ saved: 'Step saved.' });
		expect(await post('delete', { stepId: String(mine.id) })).toEqual({ saved: 'Step deleted.' });
		setDb(null);
	});
});
