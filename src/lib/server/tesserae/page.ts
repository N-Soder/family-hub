import fs from 'node:fs';
import path from 'node:path';
import layout from '../../../../tesserae/pages/layout.json';

// Builds the wall canvas page (ADR-9): one code element painted by
// tesserae/paint/routine.js from the family_hub widget's data plus Tesserae's
// calendar_day / calendar_month data, with one named webhook action per slot
// (plus `nav` for the Lists / Back button).
// The checked-in tesserae/pages/wall.json is this output with placeholders;
// `fillWallPage` substitutes them at import time.

export const ROOT = path.resolve(process.env.FAMILY_HUB_ROOT ?? '.');
export const PLACEHOLDER = { base: '{{BASE_URL}}', device: '{{DEVICE}}', page: '{{PAGE}}', token: '{{TOKEN}}' } as const;
/** Row slots on any screen: checklist steps, or list items on the lists screen. */
export const MAX_SLOTS = Math.max(layout.variants.reader.slots, layout.variants.picture.slots, layout.lists.slots);

export interface CanvasDoc {
	w: number;
	h: number;
	theme: string;
	style: string;
	font: string;
	bg: string;
	els: Array<Record<string, unknown>>;
}

/** The painter as it runs inside the code element (and in /sim). */
export function painterSource(): string {
	const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'tesserae/paint/icons.json'), 'utf8')) as Record<string, unknown>;
	delete icons.$ui;
	const { $comment: _c, ...geometry } = layout as typeof layout & { $comment?: string };
	void _c;
	return [
		`var LAYOUT = ${JSON.stringify(geometry)};`,
		`var ICONS = ${JSON.stringify(icons)};`,
		fs.readFileSync(path.join(ROOT, 'tesserae/paint/routine.js'), 'utf8')
	].join('\n');
}

export function tapUrl(base: string, device: string, page: string, slot: number, token: string): string {
	return `${base}/api/tap/${device}/${page}/${slot}?k=${token}`;
}

/**
 * The wall's front buttons (ADR-28) as Tesserae's per-device `button_map`: left = previous
 * screen, right = next, the refresh button = home. Pasted into Tesserae's device page by hand:
 * its save form resets every setting it is not sent, so Family Hub does not write it.
 */
export function buttonMap(base: string, device: string, page: string, token: string): Record<string, string> {
	const url = (b: string) => `webhook:${base.replace(/\/$/, '')}/api/button/${device}/${page}/${b}?k=${token}`;
	return { left: url('prev'), right: url('next'), refresh: url('home') };
}

export function buildWallCanvas(): CanvasDoc {
	const P = PLACEHOLDER;
	const actions: Record<string, string> = {};
	for (let slot = 1; slot <= MAX_SLOTS; slot++) actions[`slot${slot}`] = `webhook:${tapUrl(P.base, P.device, P.page, slot, P.token)}`;
	// The Lists / Back button.
	actions.nav = `webhook:${tapUrl(P.base, P.device, P.page, layout.navSlot, P.token)}`;
	// The baby's plan button (older frames; the plan is now a tab on the routines screen).
	actions.plan = `webhook:${tapUrl(P.base, P.device, P.page, layout.planSlot, P.token)}`;
	// The Routines button, and the routines screen's tabs (one per child or baby).
	actions.routines = `webhook:${tapUrl(P.base, P.device, P.page, layout.routinesSlot, P.token)}`;
	layout.memberSlots.forEach((slot, i) => (actions[`member${i + 1}`] = `webhook:${tapUrl(P.base, P.device, P.page, slot, P.token)}`));
	return {
		w: layout.canvas.w,
		h: layout.canvas.h,
		theme: 'light',
		style: 'standard',
		font: '',
		bg: '#ffffff',
		els: [
			{
				id: 'wall',
				kind: 'code',
				x: 0,
				y: 0,
				w: layout.canvas.w,
				h: layout.canvas.h,
				sources: [
					{ key: 'family_hub', name: 'hub', options: { base_url: P.base, device: P.device, page: P.page, token: P.token } },
					// Calendars stay in Tesserae; the painter draws TODAY and COMING UP from their data.
					{ key: 'calendar_day', name: 'today', options: {} },
					// COMING UP: calendar_week stops at 7 days, so read 3 rolling weeks from calendar_month
					// (Mon of this week onward); the painter skips to tomorrow and shows as many days as fit.
					{ key: 'calendar_month', name: 'week', options: { rolling_weeks: '3', week_start: 'monday', max_events_per_day: 20 } }
				],
				html: '<div id="fh"></div>',
				css: 'html,body{margin:0;background:#fff}',
				js: `${painterSource()}\npaintWall(document.getElementById('fh'), ctx.data, {});\n`,
				actions
			}
		]
	};
}

export interface FillValues {
	baseUrl: string;
	device: string;
	page: string;
	token: string;
}

export function fillWallPage(doc: CanvasDoc, v: FillValues): CanvasDoc {
	const json = JSON.stringify(doc)
		.split(PLACEHOLDER.base)
		.join(v.baseUrl.replace(/\/$/, ''))
		.split(PLACEHOLDER.device)
		.join(v.device)
		.split(PLACEHOLDER.page)
		.join(v.page)
		.split(PLACEHOLDER.token)
		.join(v.token);
	return JSON.parse(json) as CanvasDoc;
}

export function checkedInWallPage(): CanvasDoc {
	return JSON.parse(fs.readFileSync(path.join(ROOT, 'tesserae/pages/wall.json'), 'utf8')) as CanvasDoc;
}

/** Token embedded in a live page (to check it still matches the stored hash). */
export function tokenInPage(doc: { els?: Array<Record<string, unknown>> }): string | null {
	const wall = doc.els?.find((e) => e.id === 'wall') as { sources?: Array<{ options?: { token?: string } }> } | undefined;
	return wall?.sources?.[0]?.options?.token ?? null;
}
