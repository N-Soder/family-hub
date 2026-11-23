import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { handleButton } from '$lib/server/api';
import { hub } from '$lib/server/hub';

// The wall's front buttons (ADR-28): Tesserae's `webhook:` button action posts here.
export const POST: RequestHandler = ({ request, url, params }) =>
	handleButton(db(), request, url, params, { repainter: hub().repainter, limiter: hub().tapLimiter });
