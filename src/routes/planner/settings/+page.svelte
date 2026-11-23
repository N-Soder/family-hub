<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import { getSetup, getTheme, setSetup, setTheme, type Theme } from '$lib/prefs';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	// Per-phone choices: read after mount (localStorage), saved on change.
	let theme = $state<Theme>('auto');
	let setup = $state(false);
	onMount(() => {
		theme = getTheme();
		setup = getSetup();
	});
	const themes: [Theme, string, string][] = [
		['light', 'Light', 'themeLight'],
		['dark', 'Dark', 'themeDark'],
		['auto', 'Auto', 'settings']
	];
</script>

<h1>Settings</h1>

<!-- Setup pages. Members and Schedule show on phones only with "Show setup tools" on;
     the wall's plumbing (Devices, Simulator) is desktop only. -->
<div class="hub">
	<a class="card tile setup tone-0" href="/planner/members">
		<span class="chip"><Glyph name="family" size={26} /></span>
		<span><strong>Members</strong><span class="muted">Who’s in the family</span></span>
	</a>
	<a class="card tile setup tone-1" href="/planner/schedule">
		<span class="chip"><Glyph name="calendar" size={26} /></span>
		<span><strong>Schedule</strong><span class="muted">Day types and what changes by day</span></span>
	</a>
	<a class="card tile tone-2" href="/planner/kids">
		<span class="chip"><Glyph name="star" size={26} /></span>
		<span><strong>Kid view</strong><span class="muted">Big buttons for a tablet the kids tick on</span></span>
	</a>
	<a class="card tile desk-only tone-4" href="/planner/devices">
		<span class="chip"><Glyph name="devices" size={26} /></span>
		<span><strong>Devices</strong><span class="muted">The wall and recent repaints</span></span>
	</a>
	{#if data.lan}
		<a class="card tile desk-only tone-3" href="/sim">
			<span class="chip"><Glyph name="refresh" size={26} /></span>
			<span><strong>Simulator</strong><span class="muted">The wall in a browser (home network)</span></span>
		</a>
	{/if}
</div>

<section class="card">
	<h2>This device</h2>
	<div class="pref">
		<span class="label">Theme</span>
		<div class="choices" role="radiogroup" aria-label="Theme">
			{#each themes as [value, label, glyph] (value)}
				<label class="choice">
					<input
						type="radio"
						name="theme"
						{value}
						checked={theme === value}
						onchange={() => {
							theme = value;
							setTheme(value);
						}}
					/>
					<Glyph name={glyph} size={18} />{label}
				</label>
			{/each}
		</div>
	</div>
	<label class="pref switch phone-only">
		<span>
			<span class="label">Show setup tools here</span>
			<span class="muted">The “Today is” day-type chips on Routines, plus Members and Schedule above.</span>
		</span>
		<input
			type="checkbox"
			role="switch"
			checked={setup}
			onchange={(e) => {
				setup = e.currentTarget.checked;
				setSetup(setup);
			}}
		/>
	</label>
</section>

<section class="card weather">
	<h2>Weather on the wall</h2>
	{#if data.place}
		<div class="place">
			<span class="chip"><Glyph name={data.weather?.icon ?? 'pin'} size={26} /></span>
			<span class="grow">
				<strong>{data.place.name}</strong>
				<span class="muted">
					{#if data.weather}
						{[`Now ${data.weather.temp}°`, data.weather.label, data.weather.high !== null ? `${data.weather.high}° / ${data.weather.low}°` : ''].filter(Boolean).join(' · ')}
					{:else}
						Forecast on its way
					{/if}
				</span>
			</span>
			<form method="POST" action="?/weatherClear" use:enhance>
				<button class="ghost">Remove</button>
			</form>
		</div>
	{:else}
		<p class="muted">Pick your suburb to show today’s weather on the wall, with the wind in the morning.</p>
	{/if}
	<form method="POST" action="?/weatherFind" use:enhance={keep(['q'])} class="find">
		<input name="q" type="search" placeholder={data.place ? 'Change place' : 'Suburb or town'} value={form?.q ?? ''} autocomplete="off" aria-label="Suburb or town" />
		<button>Search</button>
	</form>
	{#if form?.weatherError}<p class="error" role="alert">{form.weatherError}</p>{/if}
	{#if form?.places}
		<ul class="results" aria-label="Places found">
			{#each form.places as p (p.name + p.lat)}
				<li>
					<form method="POST" action="?/weatherSet" use:enhance>
						<input type="hidden" name="name" value={p.name} />
						<input type="hidden" name="lat" value={p.lat} />
						<input type="hidden" name="lon" value={p.lon} />
						<button class="result">
							<Glyph name="pin" size={20} />
							<span><strong>{p.name}</strong><span class="muted">{p.lat}, {p.lon}</span></span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="muted credit">Forecast from Open-Meteo, refreshed every 30 minutes.</p>
</section>

<section class="card board">
	<h2>Board</h2>
	<p class="muted">A spare tablet or TV browser shows the family's day in colour, live, and can tick things off. Open <code>{data.boardUrl}</code> on it (the same address as this page) and pair it once.</p>
	{#if data.pairCode}
		<p class="code" aria-live="polite"><span class="digits">{data.pairCode.code}</span> <span class="muted">until {new Date(data.pairCode.expiresAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</span></p>
		<form method="POST" action="?/boardCancel" use:enhance={keep()}><button class="ghost">Cancel code</button></form>
	{:else}
		<form method="POST" action="?/boardCode" use:enhance={keep()}><button>Pair a screen</button></form>
	{/if}
	{#if form?.boardError}<p class="error" role="alert">{form.boardError}</p>{/if}
	{#if data.boards.length}
		<ul class="boards">
			{#each data.boards as b (b.hash)}
				<li>
					<span><strong>{b.name}</strong> <span class="muted">· paired {new Date(b.since).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} · seen {new Date(b.seen).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span></span>
					<form method="POST" action="?/boardUnpair" use:enhance={keep()}>
						<input type="hidden" name="hash" value={b.hash} />
						<button class="ghost">Unpair</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No screen paired yet.</p>
	{/if}
</section>

<div class="card">
	<h2>Household</h2>
	<p>Time zone: <strong>{data.tz}</strong> · display day rolls over at <strong>{data.rollover}</strong></p>
	<p class="muted">Set with TZ_HOUSEHOLD and DAY_ROLLOVER in the environment.</p>
</div>

<form method="POST" action="?/pin" use:enhance={keep(['current', 'pin', 'confirm'])} class="card">
	<h2>Change Planner PIN</h2>
	<p class="muted">Used on the home network. Away from home you sign in with your email code. Changing it signs out other phones that use the PIN.</p>
	<label class="field">Current PIN <input name="current" type="password" inputmode="numeric" autocomplete="current-password" required /></label>
	<label class="field">New PIN (6–12 digits) <input name="pin" type="password" inputmode="numeric" required /></label>
	<label class="field">Repeat <input name="confirm" type="password" inputmode="numeric" required /></label>
	{#if form?.errors}<p class="error" role="alert">{Object.values(form.errors)[0]}</p>{/if}
	{#if form?.saved}<p role="status">{form.saved}</p>{/if}
	<button>Change PIN</button>
</form>

<form method="POST" action="?/signOutAll" class="card">
	<h2>Sign out all devices</h2>
	<p class="muted">
		For a lost phone. Every phone and tablet signed in with the PIN is signed out, this one too. Phones signed in with the email code stay
		in until that sign-in runs out.
	</p>
	<button class="ghost">Sign out all devices</button>
</form>

<form method="POST" action="/planner/login?/logout" class="logout">
	<button class="ghost"><Glyph name="signOut" size={20} />Log out</button>
</form>

<style>
	.board code {
		font-size: 0.95em;
		user-select: all;
	}
	.board .code {
		margin: 8px 0 4px;
	}
	.board .digits {
		font: 700 2.2rem/1 var(--sans);
		letter-spacing: 0.18em;
	}
	.boards {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
	}
	.boards li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--line);
	}
	.boards form {
		margin: 0;
	}
	.hub {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin-bottom: 12px;
	}
	.tile {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0;
		color: inherit;
		text-decoration: none;
	}
	.tile > span:last-child {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tile:hover {
		border-color: var(--tone);
	}
	.pref {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		padding: 10px 0;
	}
	.pref + .pref {
		border-top: 1px solid var(--line);
	}
	.label {
		display: block;
		font-weight: 600;
	}
	.switch > span {
		flex: 1;
		min-width: 0;
	}
	.switch .muted {
		font-size: 0.9rem;
	}
	/* A plain checkbox drawn as a switch. */
	input[role='switch'] {
		appearance: none;
		flex: none;
		width: 52px;
		height: 32px;
		margin: 0;
		border-radius: 999px;
		background: var(--line-strong);
		position: relative;
		cursor: pointer;
		transition: background 0.15s;
	}
	input[role='switch']::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--card);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		transition: transform 0.15s;
	}
	input[role='switch']:checked {
		background: var(--accent);
	}
	input[role='switch']:checked::after {
		transform: translateX(20px);
	}
	input[role='switch']:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.place {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 4px 0 12px;
	}
	.grow {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.place form {
		margin: 0;
	}
	.find {
		display: flex;
		gap: 8px;
		margin: 0;
	}
	.find input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 17px;
		padding: 11px 14px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.results {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.results form {
		margin: 0;
	}
	.result {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		text-align: left;
		background: var(--card);
		color: inherit;
		border: 1.5px solid var(--line);
		border-radius: 14px;
		padding: 10px 14px;
		font-weight: 400;
	}
	.result:hover {
		border-color: var(--accent);
	}
	.result > span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.result strong {
		font-weight: 600;
	}
	.result .muted {
		font-size: 0.85rem;
	}
	.place button {
		padding: 8px 14px;
	}
	.credit {
		font-size: 0.85rem;
		margin: 12px 0 0;
	}
	.logout {
		margin: 20px 0 0;
		text-align: center;
	}
	.logout button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
</style>
