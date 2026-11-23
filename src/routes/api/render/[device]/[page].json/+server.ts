import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { handleRender } from '$lib/server/api';

export const GET: RequestHandler = ({ request, url, params }) => handleRender(db(), request, url, params);
