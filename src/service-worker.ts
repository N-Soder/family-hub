/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline shell for the Planner PWA. App files are cached per build. Planner pages are fetched
// from the network first; the last good copy of each is kept so the today board and lists still
// open with no signal (read only). Logging out, signing out all devices, or being sent to the
// login page (the session ended) deletes those copies.
//
// Service workers only run on HTTPS or localhost, so on plain-HTTP LAN this file never loads and
// the app behaves as before.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const ASSETS = `fh-assets-${version}`;
const PAGES = `fh-pages-${version}`; // tied to the build: old pages point at old asset hashes
const ASSET_PATHS = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(ASSETS)
			.then((c) => c.addAll([...ASSET_PATHS].map((p) => new Request(p, { cache: 'reload' }))))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== ASSETS && k !== PAGES).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

/** Planner pages worth keeping offline (not the login page). */
function isPlannerPage(url: URL): boolean {
	return (url.pathname === '/planner' || url.pathname.startsWith('/planner/')) && !url.pathname.startsWith('/planner/login');
}

async function networkFirst(request: Request, url: URL): Promise<Response> {
	const key = url.origin + url.pathname; // query strings do not change Planner pages
	try {
		const res = await fetch(request);
		// Sent to login: the session ended, so the copies must not outlive it (audit M4).
		if (res.redirected && new URL(res.url).pathname === '/planner/login') {
			await caches.delete(PAGES);
		} else if (res.ok && !res.redirected && res.type === 'basic') {
			const copy = res.clone();
			void caches.open(PAGES).then((c) => c.put(key, copy));
		}
		return res;
	} catch {
		const cached = await caches.match(key, { cacheName: PAGES });
		return cached ?? new Response(OFFLINE_PAGE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (request.method !== 'GET') {
		const signOut =
			(url.pathname === '/planner/login' && url.search.includes('logout')) || (url.pathname === '/planner/settings' && url.search.includes('signOutAll'));
		if (signOut) {
			event.waitUntil(caches.delete(PAGES));
		}
		return;
	}

	if (ASSET_PATHS.has(url.pathname)) {
		event.respondWith(caches.match(url.pathname, { cacheName: ASSETS }).then((hit) => hit ?? fetch(request)));
		return;
	}

	// Whole pages only. Client-side data loads (__data.json) are not cached: offline, the
	// layout switches links to full page loads so they come through here instead.
	if (request.mode === 'navigate' && isPlannerPage(url)) {
		event.respondWith(networkFirst(request, url));
	}
});

const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Family Hub</title><body style="font:17px system-ui;margin:20vh 24px;text-align:center;color:#1b1b1b;background:#fafaf8">
<h1 style="font-size:1.4rem">You're offline</h1><p>This page hasn't been opened on this phone yet.</p>
<p><a href="/planner/lists" style="color:inherit">Lists</a> · <a href="/planner/notes" style="color:inherit">Notes</a> · <a href="/planner" style="color:inherit">Home</a></p></body>`;
