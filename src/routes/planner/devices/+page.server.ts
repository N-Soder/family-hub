import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { device } from '$lib/server/db/schema';
import { devices, removeDevice } from '$lib/server/planner';
import { issueDeviceToken } from '$lib/server/auth/device';
import { deviceForm, fieldErrors, parseForm } from '$lib/server/forms';
import { hub, runBootstrap } from '$lib/server/hub';
import { ensureWallPage, tesseraeClient, tesseraeConfigured } from '$lib/server/tesserae/service';
import { buttonMap, tokenInPage } from '$lib/server/tesserae/page';
import { env } from '$lib/server/env';

export const load: PageServerLoad = () => ({
	devices: devices(db()),
	tesserae: tesseraeConfigured(),
	bootstrap: hub().bootstrap,
	pushes: hub().repainter.log.slice(-10).reverse()
});

const idOnly = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/) });

export const actions: Actions = {
	add: async ({ request }) => {
		const p = parseForm(deviceForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		if (db().select().from(device).where(eq(device.id, p.data.id)).get()) return fail(400, { errors: { id: 'That id exists' } });
		const token = issueDeviceToken(db(), p.data.id, p.data.name);
		return { token, for: p.data.id };
	},
	rotate: async ({ request }) => {
		const p = parseForm(idOnly, await request.formData());
		if (!p.success) return fail(400, { errors: { form: 'Bad device' } });
		const s = JSON.parse(db().select().from(device).where(eq(device.id, p.data.id)).get()?.settingsJson ?? '{}') as { tesseraePageId?: string };
		if (s.tesseraePageId && tesseraeConfigured()) {
			// The token lives in the Tesserae page: re-import it with a fresh token.
			await ensureWallPage(db(), tesseraeClient(db()), p.data.id, 'home', true);
			hub().repainter.reset(p.data.id);
			void hub().repainter.notify([], { full: true });
			return { notice: `Token rotated and the Tesserae page for ${p.data.id} updated.` };
		}
		return { token: issueDeviceToken(db(), p.data.id), for: p.data.id };
	},
	tesserae: async ({ request }) => {
		const p = parseForm(idOnly, await request.formData());
		if (!p.success || !tesseraeConfigured()) return fail(400, { errors: { form: 'Tesserae is not configured' } });
		try {
			const pageId = await ensureWallPage(db(), tesseraeClient(db()), p.data.id, 'home', true);
			hub().repainter.reset(p.data.id);
			void hub().repainter.notify([], { full: true });
			return { notice: `Wall page ${pageId} imported and bound to ${p.data.id}.` };
		} catch (e) {
			return fail(502, { errors: { form: e instanceof Error ? e.message : String(e) } });
		}
	},
	/** The front-button map to paste into Tesserae (ADR-28). Holds the device token: shown on request only. */
	buttons: async ({ request }) => {
		const p = parseForm(idOnly, await request.formData());
		if (!p.success || !tesseraeConfigured()) return fail(400, { errors: { form: 'Tesserae is not configured' } });
		const s = JSON.parse(db().select().from(device).where(eq(device.id, p.data.id)).get()?.settingsJson ?? '{}') as { tesseraePageId?: string; page?: string };
		if (!s.tesseraePageId) return fail(400, { errors: { form: 'Set this wall up on Tesserae first' } });
		try {
			const canvas = await tesseraeClient(db()).mcp<{ els: Array<Record<string, unknown>> }>('GET', `/pages/${s.tesseraePageId}/canvas`);
			const token = tokenInPage(canvas);
			if (!token) return fail(502, { errors: { form: 'No device token in the Tesserae page: press “Set up on Tesserae” first' } });
			const map = buttonMap(env().APP_BASE_URL_FOR_TESSERAE, p.data.id, s.page ?? 'home', token);
			return { buttonMap: JSON.stringify(map, null, 2), for: p.data.id };
		} catch (e) {
			return fail(502, { errors: { form: e instanceof Error ? e.message : String(e) } });
		}
	},
	remove: async ({ request }) => {
		const p = parseForm(idOnly, await request.formData());
		if (!p.success || !removeDevice(db(), p.data.id)) return fail(400, { errors: { form: 'That device can’t be removed' } });
		hub().repainter.reset(p.data.id);
		return { notice: `Removed ${p.data.id}. Its token no longer works. Delete its page in Tesserae too if it has one.` };
	},
	bootstrap: async () => {
		await runBootstrap();
		return { notice: `Tesserae setup: ${hub().bootstrap.state}` };
	}
};
