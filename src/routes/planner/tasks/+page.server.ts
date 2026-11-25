import { listsActions, listsLoad } from '$lib/server/lists-page';

// The Tasks side of the Lists tab; the page and its actions are shared (`lists-page.ts`).
export const load = listsLoad('tasks');
export const actions = listsActions;
