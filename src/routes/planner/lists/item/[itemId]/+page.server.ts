import { error, fail, redirect } from '@sveltejs/kit';
import { listUrl } from '$lib/lists-side';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
	completeRepeating,
	deleteItem,
	getItem,
	itemDetail,
	localToday,
	removeLog,
	renameItem,
	setItemDone,
	setItemShop,
	setNotes,
	setSchedule,
	skipRepeating,
	snoozeItem
} from '$lib/server/domain/lists';
import { averageGap, autoLeadDays, shortDate } from '$lib/server/domain/repeat';
import { fieldErrors, itemDoneForm, itemScheduleForm, logIdForm, parseForm, snoozeForm } from '$lib/server/forms';
import { publish } from '$lib/server/events';
import { hub } from '$lib/server/hub';

// One list item: name, notes, due date, repeat, lead time, "done on…", snooze/skip and history
// (SPEC §5.1, ADR-24). Shopping items get name and notes only.

export const load: PageServerLoad = ({ params, url }) => {
	const d = itemDetail(db(), Number(params.itemId));
	if (!d) error(404, 'That item has gone.');
	const unit = d.item.repeatUnit ?? 'month';
	const every = d.item.repeatEvery ?? 1;
	const done = d.log.filter((l) => l.kind === 'done');
	return {
		...d,
		isNew: url.searchParams.has('new'),
		latestLogId: d.log.reduce((m, l) => Math.max(m, l.id), 0),
		autoLead: autoLeadDays(every, unit),
		stats: d.item.repeatUnit ? { count: done.length, gap: averageGap(done.map((l) => l.doneOn), d.item.repeatUnit) } : null,
		log: d.log.map((l) => ({ ...l, when: shortDate(l.doneOn, d.today) }))
	};
};

const changed = () => {
	publish({ type: 'change', memberId: null, reason: 'list' });
	void hub().repainter.notify([], { full: true, screen: ['lists', 'home'] });
};

const nextNotice = (next: string) => `Next due ${shortDate(next, localToday())}.`;

export const actions: Actions = {
	save: async ({ request }) => {
		const p = parseForm(itemScheduleForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		if (!getItem(db(), p.data.itemId)) return fail(400, { error: 'That item has gone.' });
		renameItem(db(), p.data.itemId, p.data.title);
		setNotes(db(), p.data.itemId, p.data.notes);
		if (p.data.shop !== undefined && !setItemShop(db(), p.data.itemId, p.data.shop)) return fail(400, { error: 'That shop has gone. Pick another.' });
		const l = itemDetail(db(), p.data.itemId)!.list;
		if (l.kind !== 'grocery') setSchedule(db(), p.data.itemId, p.data.schedule);
		changed();
		return { notice: 'Saved.' };
	},
	/** A one-off item: tick it (back to the list) or untick it. */
	tick: async ({ params, request }) => {
		const item = getItem(db(), Number(params.itemId));
		if (!item) return fail(400, { error: 'That item has gone.' });
		const done = (await request.formData()).get('done') !== '0';
		if (setItemDone(db(), item.id, done, 'planner')) changed();
		if (done) redirect(303, listUrl(itemDetail(db(), item.id)!.list));
		return { notice: 'Back on the list.' };
	},
	done: async ({ request }) => {
		const p = parseForm(itemDoneForm, await request.formData());
		if (!p.success) return fail(400, { doneErrors: fieldErrors(p.error) });
		if (p.data.doneOn > localToday()) return fail(400, { doneErrors: { doneOn: 'That date has not happened yet.' } });
		const res = completeRepeating(db(), p.data.itemId, { source: 'planner', doneOn: p.data.doneOn, note: p.data.note });
		if (!res) return fail(400, { error: 'Only repeating items keep a history.' });
		changed();
		// Back to the whole list, which says what was done and offers Undo.
		redirect(303, `${listUrl(itemDetail(db(), p.data.itemId)!.list)}&done=${p.data.itemId}`);
	},
	skip: async ({ request }) => {
		const p = parseForm(snoozeForm.pick({ itemId: true }), await request.formData());
		const res = p.success ? skipRepeating(db(), p.data.itemId, 'planner') : null;
		if (!res) return fail(400, { error: 'Only repeating items can be skipped.' });
		changed();
		return { notice: `Skipped. ${nextNotice(res.next)}` };
	},
	snooze: async ({ request }) => {
		const p = parseForm(snoozeForm, await request.formData());
		const due = p.success ? snoozeItem(db(), p.data.itemId, p.data.days) : null;
		if (!due) return fail(400, { error: 'Give it a due date first.' });
		changed();
		return { notice: `Moved to ${shortDate(due, localToday())}.` };
	},
	removeLog: async ({ request }) => {
		const p = parseForm(logIdForm, await request.formData());
		if (!p.success || !removeLog(db(), p.data.logId)) return fail(400, { error: 'That entry has gone.' });
		changed();
		return { notice: 'Removed from the history.' };
	},
	remove: async ({ params }) => {
		const d = itemDetail(db(), Number(params.itemId));
		if (!d) redirect(303, '/planner/lists');
		deleteItem(db(), d.item.id);
		changed();
		redirect(303, listUrl(d.list));
	}
};
