<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import '$lib/theme.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import { paintThemeColour } from '$lib/prefs';
	let { children } = $props();

	// Offline (installed app, no signal): show the last saved copy read-only. Links become full
	// page loads so the service worker can answer them; changes are blocked with a note.
	let offline = $state(false);
	let blocked = $state(false);
	onMount(() => {
		paintThemeColour();
		const sync = () => {
			offline = !navigator.onLine;
			if (!offline) blocked = false;
		};
		const stopOfflineSubmit = (e: SubmitEvent) => {
			if (!navigator.onLine) {
				e.preventDefault();
				e.stopImmediatePropagation();
				blocked = true;
			}
		};
		sync();
		addEventListener('online', sync);
		addEventListener('offline', sync);
		addEventListener('submit', stopOfflineSubmit, true);
		return () => {
			removeEventListener('online', sync);
			removeEventListener('offline', sync);
			removeEventListener('submit', stopOfflineSubmit, true);
		};
	});
	// The same four tabs on desktop (header) and phone (tab bar), ADR-38. Setup pages open from
	// Settings; the calendar opens from Home; Lists, Tasks, Notes and Gifts share the Lists tab
	// behind a switch (ADR-39, ADR-40).
	const LISTS_SIDE = 'fh-lists-side';
	const SIDES = [
		['lists', 'Lists'],
		['tasks', 'Tasks'],
		['notes', 'Notes'],
		['gifts', 'Gifts']
	] as const;
	let listsHref = $state('/planner/lists');
	const tabs = $derived([
		['/planner', 'Home', 'home'],
		['/planner/routines', 'Routines', 'sun'],
		[listsHref, 'Lists', 'list'],
		['/planner/settings', 'Settings', 'settings']
	]);
	const setupPages = ['/planner/members', '/planner/schedule', '/planner/devices'];
	const under = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	const inSetup = $derived(setupPages.some(under));
	// Which side of the Lists tab this page is on, if any.
	const side = $derived(SIDES.find(([s]) => under(`/planner/${s}`))?.[0] ?? null);
	// The switch shows on the three index pages only, not on a list, note or person.
	const onIndex = $derived(side !== null && page.url.pathname === `/planner/${side}` && !page.url.searchParams.has('list'));
	const active = (href: string) =>
		href === '/planner'
			? page.url.pathname === '/planner' || under('/planner/calendar')
			: href === '/planner/settings'
				? under(href) || inSetup
				: href === listsHref
					? side !== null
					: under(href);
	// The Lists tab goes back to whichever side (lists, tasks, notes or gifts) this phone used last.
	onMount(() => {
		try {
			const kept = localStorage.getItem(LISTS_SIDE);
			if (SIDES.some(([s]) => s === kept)) listsHref = `/planner/${kept}`;
		} catch {
			/* no storage: lists */
		}
	});
	$effect(() => {
		if (!side) return;
		listsHref = `/planner/${side}`;
		try {
			localStorage.setItem(LISTS_SIDE, side);
		} catch {
			/* private mode: not remembered */
		}
	});
	const signedIn = $derived(!page.url.pathname.startsWith('/planner/login'));
	// Kid view: full screen on a tablet, no Planner header or tabs (ADR-27).
	const kids = $derived(under('/planner/kids'));
</script>

<svelte:head><title>Family Hub · Planner</title></svelte:head>

{#if kids}
	{#if offline}<p class="offline kid-offline" role="status">No internet. Ticks need a connection.</p>{/if}
	{@render children()}
{:else}
<div class="shell" data-sveltekit-reload={offline ? '' : 'off'}>
	{#if offline}
		<p class="offline" role="status">
			Offline: showing the last saved copy.{blocked ? ' Changes need a connection.' : ''}
		</p>
	{/if}
	<header class="bar">
		<a class="mark" href="/planner"><Glyph name="sun" size={26} />Family Hub</a>
		{#if signedIn}
			<nav class="links" aria-label="Planner pages">
				{#each tabs as [href, label] (href)}
					<a {href} class:on={active(href)} aria-current={active(href) ? 'page' : undefined}>{label}</a>
				{/each}
			</nav>
		{/if}
	</header>
	<main>
		{#if inSetup}<BackLink href="/planner/settings" label="Settings" />{/if}
		{#if under('/planner/calendar')}<BackLink href="/planner" label="Home" />{/if}
		{#if onIndex}
			<nav class="side" aria-label="Lists, tasks, notes and gifts">
				{#each SIDES as [s, label] (s)}
					<a href={`/planner/${s}`} class:on={side === s} aria-current={side === s ? 'page' : undefined}>{label}</a>
				{/each}
			</nav>
		{/if}
		{@render children()}
	</main>
	{#if signedIn}
		<nav class="tabs" aria-label="Planner">
			{#each tabs as [href, label, glyph] (href)}
				<a {href} class:on={active(href)} aria-current={active(href) ? 'page' : undefined}><Glyph name={glyph} size={26} />{label}</a>
			{/each}
		</nav>
	{/if}
</div>
{/if}

<style>
	.shell {
		max-width: 760px;
		margin: 0 auto;
		/* Safe areas: the installed app runs full screen on phones with a notch / home bar. */
		padding: env(safe-area-inset-top) max(16px, env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
	}
	.offline {
		position: sticky;
		top: 0;
		z-index: 3;
		margin: 0 -16px;
		padding: 8px 16px;
		background: var(--ink);
		color: var(--bg);
		font-weight: 600;
		font-size: 0.9rem;
	}
	.kid-offline {
		margin: 0;
		text-align: center;
		font-size: 1.1rem;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px 18px;
		flex-wrap: wrap;
		padding: 14px 0;
		margin-bottom: 8px;
	}
	.mark {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ink);
		text-decoration: none;
		font-family: var(--serif);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-weight: 650;
		font-size: 1.25rem;
		--glyph-bg: var(--sun);
		--glyph-bg-opacity: 1;
	}
	.mark :global(.glyph) {
		color: var(--sun-ink);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		align-items: center;
		margin-left: auto;
	}
	.links a {
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
		padding: 4px 0;
		border-bottom: 2.5px solid transparent;
	}
	.links a.on {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}
	.tabs {
		display: none;
	}
	/* Lists · Notes · Gifts: plain words, one accent underline, a hairline under the row (ADR-39). */
	.side {
		display: flex;
		gap: 24px;
		margin: 0 0 14px;
		border-bottom: 1px solid var(--line-strong);
	}
	.side a {
		display: flex;
		align-items: center;
		min-height: 44px;
		margin-bottom: -1px;
		border-bottom: 2.5px solid transparent;
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
		font-size: 1.05rem;
	}
	.side a.on {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}
	/* Phone or installed app: a bottom tab bar. `.desk-only` never shows here (Devices, Simulator);
	   `.setup` shows only when Settings → "Show setup tools on this phone" is on (day-type chips,
	   Members, Schedule). `.phone-only` is the reverse of `.desk-only`. */
	@media (max-width: 640px), (display-mode: standalone) {
		:global(.desk-only),
		:global(:root:not([data-setup='on']) .setup) {
			display: none !important;
		}
		.links {
			display: none;
		}
		.bar {
			padding: max(10px, env(safe-area-inset-top)) 0 4px;
		}
		.shell {
			padding-top: 0;
			padding-bottom: calc(96px + env(safe-area-inset-bottom));
		}
		.tabs {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 2;
			background: color-mix(in srgb, var(--card) 94%, transparent);
			backdrop-filter: blur(10px);
			border-top: 1px solid var(--line);
			padding: 6px max(8px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
		}
		.tabs a {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 2px;
			padding: 6px 0;
			color: var(--muted);
			text-decoration: none;
			font-size: 0.8rem;
			font-weight: 500;
			--glyph-bg-opacity: 0.18;
		}
		.tabs a.on {
			color: var(--accent-ink);
			font-weight: 700;
			--glyph-bg: var(--accent);
			--glyph-bg-opacity: 0.35;
		}
	}
	@media not ((max-width: 640px) or (display-mode: standalone)) {
		:global(.phone-only) {
			display: none !important;
		}
	}
</style>
