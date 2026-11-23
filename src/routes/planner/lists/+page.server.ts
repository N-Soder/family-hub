import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { db } from '$lib/server/db';
import {
	addItem,
	addSuggestion,
	allLists,
	anyDated,
	comingUp,
	completeRepeating,
	getItem,
	localToday,
	removeLog,
	repeatOf,
	suggestionsFor,
	clearDone,
	createList,
	deleteItem,
	deleteList,
	itemListId,
	listDetail,
	moveItem,
	renameItem,
	setItemDone,
	setNow,
	updateList
} from '$lib/server/domain/lists';
import { fieldErrors, itemForm, itemIdForm, itemRenameForm, itemToggleForm, listForm, listIdForm, logIdForm, newListForm, nowForm, parseForm, suggestForm } from '$lib/server/forms';
import { shortDate } from '$lib/server/domain/repeat';
import { publish } from '$lib/server/events';
import { hub } from '$lib/server/hub';

// One route, two views (ADR-39): no `?list` is the index (Coming up when anything is due, then
// one row per list); `?list=<id>` is that list's own page. Forms on a list page post to
// `?list=<id>&/<action>`, so a plain (no-JS) post comes back to the same list.

export const load: PageServerLoad = ({ url }) => {
	// Coming up was its own view until ADR-39; it is now a section of the index.
	if (url.searchParams.has('view')) redirect(308, '/planner/lists');
	const lists = allLists(db());
	const asked = url.searchParams.get('list');
	if (asked === null) {
		const coming = anyDated(db()) ? comingUp(db()) : [];
		return { lists, coming, detail: null, suggestions: [] };
	}
	const current = lists.find((l) => l.id === Number(asked));
	if (!current) redirect(303, '/planner/lists');
	const detail = listDetail(db(), current.id);
	const suggestions = current.kind !== 'grocery' ? suggestionsFor(db(), current.id) : [];
	return { lists, coming: [], detail, suggestions };
};

/**
 * Refresh open Planner pages and any wall showing the lists. A tick repaints just that row;
 * anything else may move rows, so it gets a full frame.
 */
const changed = (tickedItem?: number) => {
	publish({ type: 'change', memberId: null, reason: 'list' });
	void hub().repainter.notify(tickedItem ? [`i${tickedItem}`] : [], tickedItem ? { screen: ['lists', 'home'] } : { full: true, screen: ['lists', 'home'] });
};

/** Parse a form that names an item; the item must be on the list the form says. */
async function itemFrom<S extends z.ZodType<{ itemId: number }>>(schema: S, { request }: RequestEvent) {
	const form = await request.formData();
	const p = parseForm(schema, form);
	const l = parseForm(listIdForm, form);
	if (!p.success || !l.success || itemListId(db(), p.data.itemId) !== l.data.listId) return null;
	return p.data;
}

export const actions: Actions = {
	add: async ({ request }) => {
		const form = await request.formData();
		const l = parseForm(listIdForm, form);
		const p = parseForm(itemForm, form);
		if (!l.success) return fail(400, { error: 'That list has gone.' });
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		const res = addItem(db(), l.data.listId, p.data.title);
		changed();
		if (res.status === 'exists') return { notice: `${res.title} is already on the list.` };
		if (res.status === 'unticked') return { notice: `${res.title} is back on the list.` };
		return { added: true };
	},
	toggle: async (event) => {
		const d = await itemFrom(itemToggleForm, event);
		if (!d) return fail(400, { error: 'That item has gone. The list has been refreshed.' });
		const item = getItem(db(), d.itemId);
		if (item && repeatOf(item)) {
			if (!d.done) return;
			const res = completeRepeating(db(), d.itemId, { source: 'planner' });
			if (!res) return;
			changed();
			return { notice: `${item.title}: done. Next due ${shortDate(res.next, localToday())}.`, undo: res.logId };
		}
		if (setItemDone(db(), d.itemId, d.done, 'planner')) changed(d.itemId);
	},
	/** Undo a repeating item's "done" (the notice's Undo button). */
	undo: async ({ request }) => {
		const p = parseForm(logIdForm, await request.formData());
		if (!p.success || !removeLog(db(), p.data.logId)) return fail(400, { error: 'Nothing to undo.' });
		changed();
		return { notice: 'Undone.' };
	},
	/** Add a starter job with its repeat, then open it to check the date. */
	suggest: async ({ request }) => {
		const p = parseForm(suggestForm, await request.formData());
		const id = p.success ? addSuggestion(db(), p.data.listId, p.data.key) : null;
		if (!id) return fail(400, { error: 'That suggestion has gone.' });
		changed();
		redirect(303, `/planner/lists/item/${id}?new=1`);
	},
	rename: async (event) => {
		const d = await itemFrom(itemRenameForm, event);
		if (!d) return fail(400, { error: 'Item names need 1–80 characters.' });
		renameItem(db(), d.itemId, d.title);
		changed();
	},
	/** Flag or unflag Now (edit mode). */
	now: async (event) => {
		const d = await itemFrom(nowForm, event);
		if (d && setNow(db(), d.itemId, d.now)) changed();
	},
	up: async (event) => {
		const d = await itemFrom(itemIdForm, event);
		if (!d) return;
		moveItem(db(), d.itemId, -1);
		changed();
	},
	down: async (event) => {
		const d = await itemFrom(itemIdForm, event);
		if (!d) return;
		moveItem(db(), d.itemId, 1);
		changed();
	},
	remove: async (event) => {
		const d = await itemFrom(itemIdForm, event);
		if (!d) return;
		deleteItem(db(), d.itemId);
		changed();
	},
	clearDone: async ({ request }) => {
		const l = parseForm(listIdForm, await request.formData());
		if (!l.success) return fail(400, { error: 'That list has gone.' });
		const n = clearDone(db(), l.data.listId);
		changed();
		return { notice: n ? `Cleared ${n} ticked item${n === 1 ? '' : 's'}.` : 'Nothing ticked to clear.' };
	},
	newList: async ({ request }) => {
		const p = parseForm(newListForm, await request.formData());
		if (!p.success) return fail(400, { newErrors: fieldErrors(p.error) });
		const icon = p.data.kind === 'grocery' ? 'bag' : p.data.kind === 'todo' ? 'home' : 'star';
		const id = createList(db(), { ...p.data, icon });
		changed();
		redirect(303, `/planner/lists?list=${id}`);
	},
	save: async ({ request }) => {
		const form = await request.formData();
		const l = parseForm(listIdForm, form);
		const p = parseForm(listForm, form);
		if (!l.success) return fail(400, { error: 'That list has gone.' });
		if (!p.success) return fail(400, { listErrors: fieldErrors(p.error) });
		updateList(db(), l.data.listId, p.data);
		changed();
		return { notice: 'List saved.' };
	},
	deleteList: async ({ request }) => {
		const form = await request.formData();
		const l = parseForm(listIdForm, form);
		if (!l.success) return fail(400, { error: 'That list has gone.' });
		if (form.get('confirm') !== 'on') return fail(400, { listErrors: { confirm: 'Tick the box to confirm.' } });
		deleteList(db(), l.data.listId);
		changed();
		redirect(303, '/planner/lists');
	}
};
