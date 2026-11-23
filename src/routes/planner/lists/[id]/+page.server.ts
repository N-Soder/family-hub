import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Old per-list address (bookmarks, home-screen shortcuts): lists now live on one page.
export const load: PageServerLoad = ({ params }) => redirect(308, `/planner/lists?list=${encodeURIComponent(params.id)}`);
