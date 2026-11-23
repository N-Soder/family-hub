import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { member } from '$lib/server/db/schema';
import { members, changed, shortLabelTakenBy } from '$lib/server/planner';
import { fieldErrors, memberForm, parseForm } from '$lib/server/forms';

export const load: PageServerLoad = () => ({ members: members(db()) });

export const actions: Actions = {
	add: async ({ request }) => {
		const p = parseForm(memberForm, await request.formData());
		if (!p.success) return fail(400, { errors: fieldErrors(p.error) });
		const taken = shortLabelTakenBy(db(), p.data.shortLabel);
		if (taken) return fail(400, { errors: { shortLabel: `${taken} already has “${p.data.shortLabel}”; labels must differ on the wall` } });
		const sort = members(db()).length;
		db().insert(member).values({ ...p.data, sort }).run();
		changed(null, [], true);
		return { added: p.data.name };
	}
};
