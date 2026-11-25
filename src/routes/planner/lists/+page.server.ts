import { listsActions, listsLoad } from '$lib/server/lists-page';

// The Lists side of the Lists tab; the page and its actions are shared (`lists-page.ts`).
export const load = listsLoad('lists');
export const actions = listsActions;
