// Per-phone Planner preferences, kept in localStorage and applied as attributes on <html>.
// src/app.html applies both before first paint; these helpers change them from the Settings page.

export type Theme = 'light' | 'dark' | 'auto';

const THEME_KEY = 'fh-theme';
const SETUP_KEY = 'fh-setup';
// Same values as the theme-color metas in src/app.html (used again for Auto).
const BAR = { light: '#fff8ee', dark: '#18161d' };

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null; // private mode: fall back to the default
	}
}

function write(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* private mode: still applies for this visit */
	}
}

export function getTheme(): Theme {
	const t = read(THEME_KEY);
	return t === 'light' || t === 'dark' ? t : 'auto';
}

/** Colour the phone's status bar to match the page. */
export function paintThemeColour() {
	const pinned = document.documentElement.dataset.theme;
	const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
	if (pinned) {
		const c = getComputedStyle(document.body).backgroundColor;
		metas.forEach((m) => m.setAttribute('content', c));
	} else {
		// Auto: each meta follows its own prefers-color-scheme media query again.
		metas.forEach((m) => m.setAttribute('content', m.media.includes('dark') ? BAR.dark : BAR.light));
	}
}

export function setTheme(t: Theme) {
	const root = document.documentElement;
	if (t === 'auto') delete root.dataset.theme;
	else root.dataset.theme = t;
	write(THEME_KEY, t === 'auto' ? null : t);
	paintThemeColour();
}

/** "Show setup tools on this phone": the day-type chips, Members and Schedule. */
export function getSetup(): boolean {
	return read(SETUP_KEY) === 'on';
}

export function setSetup(on: boolean) {
	const root = document.documentElement;
	if (on) root.dataset.setup = 'on';
	else delete root.dataset.setup;
	write(SETUP_KEY, on ? 'on' : null);
}

/** Kid view on this tablet: when set, opening the Planner goes straight to /planner/kids (app.html). */
export const KIDS_KEY = 'fh-kids';
