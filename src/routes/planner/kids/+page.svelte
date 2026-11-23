<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Glyph from '$lib/components/Glyph.svelte';
	import { cue, setSoundOn, soundOn, unlockAudio } from '$lib/kid-feedback';
	import { KIDS_KEY } from '$lib/prefs';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// Kid view (ADR-27): big cards, whole card is the button. Forgiving touch: a press ticks once
	// the finger has rested briefly (no need to lift), a quick tap ticks on lift even if the finger
	// slid a little; a done card needs a hold to undo, so a stray tap never unticks.

	const UNDO_HOLD_MS = 900;
	const TICK_PRESS_MS = 150; // a finger resting this long ticks without waiting for the lift
	const EXIT_HOLD_MS = 2000;
	const SLOP_PX = 40; // a lift this far outside the card still counts
	const LOCK_MS = 700; // ignore a second tap on the same card (double taps, bouncy fingers)
	const TONES = [2, 1, 3, 4, 0];

	// Which child and routine: each tablet remembers the child; the routine starts on the one now.
	const KID_KEY = 'fh-kids-member';
	let pickedKid = $state<number | null>(null);
	let pickedRoutine = $state<number | null>(null);
	const kid = $derived(data.kids.find((k) => k.id === pickedKid) ?? data.kids[0] ?? null);
	const routine = $derived(kid?.routines.find((r) => r.id === pickedRoutine) ?? kid?.routines.find((r) => r.id === kid.defaultRoutine) ?? null);

	function pickKid(id: number) {
		pickedKid = id;
		pickedRoutine = null;
		cue('hint', sound);
		try {
			localStorage.setItem(KID_KEY, String(id));
		} catch {
			/* not remembered */
		}
	}

	// Ticks show at once; the server answer (and the live feed) settles them.
	const pending = new SvelteMap<number, boolean>();
	const isDone = (s: { id: number; done: boolean }) => pending.get(s.id) ?? s.done;
	const doneCount = $derived(routine ? routine.steps.filter(isDone).length : 0);
	const allDone = $derived(Boolean(routine && routine.steps.length && doneCount === routine.steps.length));

	let sound = $state(true);
	let celebrate = $state(false);
	let celebratedAt = 0;
	// The same finger's click lands on the overlay as it opens; only later taps close it.
	const closeParty = () => Date.now() - celebratedAt > 1200 && (celebrate = false);
	let celebrateTimer: ReturnType<typeof setTimeout> | undefined;
	let hintFor = $state<number | null>(null);
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	let popped = $state<number | null>(null);
	const lockedUntil = new Map<number, number>();

	async function setDone(stepId: number, done: boolean) {
		lockedUntil.set(stepId, Date.now() + LOCK_MS);
		pending.set(stepId, done);
		const steps = routine?.steps ?? [];
		const nowAllDone = done && steps.length > 0 && steps.every((s) => (s.id === stepId ? true : isDone(s)));
		if (nowAllDone) {
			cue('allDone', sound);
			celebrate = true;
			celebratedAt = Date.now();
			clearTimeout(celebrateTimer);
			celebrateTimer = setTimeout(() => (celebrate = false), 6000);
		} else cue(done ? 'tick' : 'untick', sound);
		if (done) {
			popped = stepId;
			setTimeout(() => popped === stepId && (popped = null), 600);
		}
		const body = new FormData();
		body.set('stepId', String(stepId));
		body.set('done', done ? '1' : '0');
		try {
			const res = await fetch('?/toggle', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			if (result.type !== 'success') throw new Error(result.type);
			await invalidateAll();
		} catch {
			cue('error', sound);
			celebrate = false;
		}
		pending.delete(stepId);
	}

	// One gesture per card: pointer down → (hold timer if done) → up inside the card (with slop).
	type Press = { pointerId: number; done: boolean; timer?: ReturnType<typeof setTimeout>; fired: boolean };
	const presses = new Map<number, Press>();
	let holding = $state<number | null>(null);

	function down(e: PointerEvent, step: { id: number; done: boolean }) {
		if (presses.has(step.id) || (lockedUntil.get(step.id) ?? 0) > Date.now()) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const press: Press = { pointerId: e.pointerId, done: isDone(step), fired: false };
		if (press.done) {
			holding = step.id;
			press.timer = setTimeout(() => {
				press.fired = true;
				holding = null;
				void setDone(step.id, false);
			}, UNDO_HOLD_MS);
		} else {
			// Long or wiggly presses were lost when iOS cancelled the touch; tick while still down.
			press.timer = setTimeout(() => {
				press.fired = true;
				void setDone(step.id, true);
			}, TICK_PRESS_MS);
		}
		presses.set(step.id, press);
	}

	function up(e: PointerEvent, step: { id: number }) {
		const press = presses.get(step.id);
		if (!press || press.pointerId !== e.pointerId) return;
		end(step.id);
		if (press.fired) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const inside = e.clientX > r.left - SLOP_PX && e.clientX < r.right + SLOP_PX && e.clientY > r.top - SLOP_PX && e.clientY < r.bottom + SLOP_PX;
		if (!inside) return;
		if (!press.done) void setDone(step.id, true);
		else showHint(step.id);
	}

	function end(id: number) {
		const press = presses.get(id);
		clearTimeout(press?.timer);
		presses.delete(id);
		if (holding === id) holding = null;
	}

	function showHint(id: number) {
		cue('hint', sound);
		hintFor = id;
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => (hintFor = null), 2500);
	}

	/** Keyboard / switch access: Enter or Space toggles straight away. */
	function key(e: MouseEvent, step: { id: number; done: boolean }) {
		if (e.detail !== 0) return; // pointer clicks are handled above
		void setDone(step.id, !isDone(step));
	}

	// Grown-ups leave by holding the corner button.
	let exitHold = $state(false);
	let exitTimer: ReturnType<typeof setTimeout> | undefined;
	function exitDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		exitHold = true;
		exitTimer = setTimeout(() => {
			try {
				localStorage.removeItem(KIDS_KEY);
			} catch {
				/* nothing stored */
			}
			void goto('/planner/routines');
		}, EXIT_HOLD_MS);
	}
	function exitUp() {
		exitHold = false;
		clearTimeout(exitTimer);
	}

	function toggleSound() {
		sound = !sound;
		setSoundOn(sound);
		if (sound) cue('tick', true);
	}

	onMount(() => {
		sound = soundOn();
		// Feel like an app: no pull-to-refresh or rubber-band bounce, no text selection anywhere.
		const root = document.documentElement;
		root.classList.add('kid-app');
		const noSelect = (e: Event) => e.preventDefault();
		document.addEventListener('selectstart', noSelect);
		try {
			// This tablet now opens in the kid view until a grown-up leaves it (app.html).
			localStorage.setItem(KIDS_KEY, 'on');
			const saved = Number(localStorage.getItem(KID_KEY));
			if (saved) pickedKid = saved;
		} catch {
			/* no storage: first child, not remembered */
		}
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());

		// Keep the screen on while the kid view is in use (Screen Wake Lock; HTTPS only, so on the
		// plain-HTTP LAN address the tablet's own Auto-Lock applies). After IDLE_MS with no tap the
		// lock is let go and the iPad's Auto-Lock takes over (a page cannot lock the screen itself).
		// The browser drops the lock when the page is hidden, so take it again on return and on
		// the next tap.
		const IDLE_MS = 15 * 60_000;
		let lock: WakeLockSentinel | null = null;
		let idle: ReturnType<typeof setTimeout> | undefined;
		const keepAwake = async () => {
			clearTimeout(idle);
			idle = setTimeout(() => void lock?.release(), IDLE_MS);
			if (lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
			try {
				lock = await navigator.wakeLock.request('screen');
				lock.addEventListener('release', () => (lock = null));
			} catch {
				/* refused (low battery, no user tap yet): try again on the next tap */
			}
		};
		void keepAwake();
		addEventListener('pointerdown', keepAwake);
		// iOS only lets audio start inside a tap end (not a touch start), and drops it again after
		// sleep; re-arm it on every tap so the sound is ready.
		addEventListener('pointerup', unlockAudio, true);
		addEventListener('touchend', unlockAudio, true);

		// Back from sleep: fetch today's state (the date may have rolled over).
		const wake = () => {
			if (document.visibilityState !== 'visible') return;
			void invalidateAll();
			void keepAwake();
		};
		document.addEventListener('visibilitychange', wake);
		return () => {
			root.classList.remove('kid-app');
			document.removeEventListener('selectstart', noSelect);
			es.close();
			removeEventListener('pointerdown', keepAwake);
			removeEventListener('pointerup', unlockAudio, true);
			removeEventListener('touchend', unlockAudio, true);
			document.removeEventListener('visibilitychange', wake);
			clearTimeout(idle);
			void lock?.release();
		};
	});

	const STARS = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * 360, d: 140 + (i % 3) * 70, t: i % 5 }));
</script>

<svelte:head><title>Family Hub · Kids</title></svelte:head>

<div class="kids" oncontextmenu={(e) => e.preventDefault()} role="presentation">
	<header class="top">
		{#if data.kids.length > 1}
			<div class="who" role="tablist" aria-label="Who is ticking">
				{#each data.kids as k, i (k.id)}
					<button role="tab" class="kid tone-{TONES[i % 5]}" aria-selected={kid?.id === k.id} onclick={() => pickKid(k.id)}>
						<span class="face"><Glyph name={k.icon} size={40} /></span>{k.name}
					</button>
				{/each}
			</div>
		{:else if kid}
			<div class="who solo tone-{TONES[0]}"><span class="face"><Glyph name={kid.icon} size={40} /></span><h1>{kid.name}</h1></div>
		{/if}
		<button class="sound" onclick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Sound on' : 'Sound off'}>
			<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />{#if sound}<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />{:else}<path d="m16 9 6 6m0-6-6 6" />{/if}</svg
			>
		</button>
	</header>

	{#if !kid}
		<p class="empty">No children set up yet. A grown-up can add one in Settings → Members.</p>
	{:else if !routine}
		<p class="empty"><Glyph name="sun" size={64} /><br />Nothing to do today!</p>
	{:else}
		{#if kid.routines.length > 1}
			<div class="routines" role="tablist" aria-label="Routine">
				{#each kid.routines as r (r.id)}
					<button role="tab" aria-selected={routine.id === r.id} onclick={() => ((pickedRoutine = r.id), cue('hint', sound))}>
						{r.name}{#if r.running}<span class="now">now</span>{/if}
					</button>
				{/each}
			</div>
		{:else}
			<h2 class="rname">{routine.name}</h2>
		{/if}

		<div class="stars" role="img" aria-label={`${doneCount} of ${routine.steps.length} done`}>
			{#each routine.steps as s (s.id)}
				<span class="star" class:lit={isDone(s)}><Glyph name="star" size={34} /></span>
			{/each}
		</div>

		<ul class="grid" class:picture={kid.picture}>
			{#each routine.steps as s, i (s.id)}
				{@const done = isDone(s)}
				<li>
					<button
						class="step tone-{i % 5}"
						class:done
						class:pop={popped === s.id}
						class:holding={holding === s.id}
						class:wiggle={hintFor === s.id}
						aria-pressed={done}
						aria-label={done ? `${s.title}, done. Hold to undo.` : s.title}
						style:--hold={`${UNDO_HOLD_MS}ms`}
						onpointerdown={(e) => down(e, s)}
						onpointerup={(e) => up(e, s)}
						onpointercancel={() => end(s.id)}
						onclick={(e) => key(e, s)}
					>
						<span class="icon"><Glyph name={s.icon} size={kid.picture ? 132 : 100} /></span>
						<span class="title">{s.title}</span>
						<span class="badge" aria-hidden="true"><Glyph name="check" size={36} /></span>
						{#if hintFor === s.id}<span class="hint">Hold to undo</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<button
		class="exit"
		class:on={exitHold}
		style:--hold={`${EXIT_HOLD_MS}ms`}
		onpointerdown={exitDown}
		onpointerup={exitUp}
		onpointercancel={exitUp}
		onpointerleave={exitUp}
		aria-label="Grown-ups: hold to leave"
	>
		<span class="fill"></span><Glyph name="settings" size={20} />Grown-ups · hold
	</button>

	{#if celebrate}
		<button class="party" onclick={closeParty} aria-label="All done! Tap to close">
			<span class="burst" aria-hidden="true">
				{#each STARS as st, i (i)}
					<span class="fly tone-{st.t}" style:--a={`${st.a}deg`} style:--d={`${st.d}px`}><Glyph name="star" size={44} /></span>
				{/each}
			</span>
			<span class="big"><Glyph name="star" size={150} /></span>
			<span class="yay">All done!</span>
			<span class="sub">Great job, {kid?.name}!</span>
		</button>
	{/if}
	{#if allDone && !celebrate}<p class="finished"><Glyph name="star" size={28} /> All done!</p>{/if}
</div>

<style>
	:global(html.kid-app),
	:global(html.kid-app body) {
		overscroll-behavior: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.kids {
		min-height: 100dvh;
		box-sizing: border-box;
		padding: max(16px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) calc(90px + env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
		/* No double-tap zoom, no text selection or iOS callout on long presses. */
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
	.kids :global(button) {
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}
	.who {
		display: flex;
		gap: 12px;
		flex: 1;
		overflow-x: auto;
		align-items: center;
	}
	.who h1 {
		margin: 0;
		font-size: 2.4rem;
	}
	.kid {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 12px;
		min-height: 76px;
		padding: 8px 26px 8px 8px;
		font-size: 1.5rem;
		border: 3px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.kid[aria-selected='true'] {
		border-color: var(--tone);
		background: var(--tone-soft);
		color: var(--tone-ink);
	}
	.face {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--tone);
		color: var(--card);
		--glyph-bg: var(--card);
		--glyph-bg-opacity: 0.45;
	}
	.sound {
		flex: none;
		margin-left: auto;
		width: 68px;
		height: 68px;
		padding: 0;
		display: grid;
		place-items: center;
		background: var(--card);
		color: var(--ink);
		border: 2px solid var(--line-strong);
	}
	.sound[aria-pressed='false'] {
		color: var(--muted);
	}
	.routines {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	.routines button {
		min-height: 64px;
		padding: 10px 28px;
		font-size: 1.35rem;
		background: var(--card);
		color: var(--ink);
		border: 3px solid var(--line-strong);
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.routines button[aria-selected='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--card);
	}
	.now {
		font-size: 0.8rem;
		padding: 2px 10px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
	}
	.rname {
		font-size: 2rem;
		margin: 0 0 12px;
	}
	.stars {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 20px;
		color: var(--line-strong);
		--glyph-bg-opacity: 0.6;
	}
	.star {
		display: grid;
		transition: transform 0.3s cubic-bezier(0.3, 1.8, 0.5, 1);
	}
	.star.lit {
		color: var(--sun);
		--glyph-bg: var(--sun);
		transform: scale(1.15);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 20px;
	}
	.grid.picture {
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	}
	.step {
		position: relative;
		width: 100%;
		min-height: 230px;
		padding: 22px 16px 20px;
		border-radius: 32px;
		border: 4px solid var(--tone);
		background: var(--tone-soft);
		color: var(--tone-ink);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		box-shadow: 0 8px 0 color-mix(in srgb, var(--tone) 55%, transparent);
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease,
			background 0.2s,
			opacity 0.2s;
		overflow: hidden;
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.35;
	}
	.step:active {
		transform: translateY(6px) scale(0.98);
		box-shadow: 0 2px 0 color-mix(in srgb, var(--tone) 55%, transparent);
	}
	.icon {
		display: grid;
		color: var(--tone-ink);
	}
	.title {
		font-size: 1.7rem;
		font-weight: 700;
		line-height: 1.15;
		text-align: center;
	}
	.picture .title {
		font-size: 1.3rem;
	}
	.badge {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 58px;
		height: 58px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: transparent;
		transition:
			transform 0.3s cubic-bezier(0.3, 1.8, 0.5, 1),
			background 0.2s;
	}
	.step.done {
		background: var(--card);
		border-color: var(--line-strong);
		box-shadow: 0 8px 0 var(--line);
	}
	.step.done .icon,
	.step.done .title {
		opacity: 0.45;
	}
	.step.done .title {
		text-decoration: line-through;
		text-decoration-thickness: 4px;
		text-decoration-color: var(--tone);
	}
	.step.done .badge {
		background: var(--tone);
		color: var(--card);
		transform: scale(1.25);
		--glyph-bg-opacity: 0;
	}
	.step.pop {
		animation: pop 0.5s cubic-bezier(0.3, 1.8, 0.5, 1);
	}
	@keyframes pop {
		0% {
			transform: scale(0.94);
		}
		50% {
			transform: scale(1.06);
		}
		100% {
			transform: scale(1);
		}
	}
	/* Holding a done card: a fill rises; at the top it unticks. */
	.step::after {
		content: '';
		position: absolute;
		inset: auto 0 0 0;
		height: 0;
		background: color-mix(in srgb, var(--tone) 30%, transparent);
		pointer-events: none;
	}
	.step.holding::after {
		height: 100%;
		transition: height var(--hold) linear;
	}
	.step.wiggle {
		animation: wiggle 0.4s ease;
	}
	@keyframes wiggle {
		25% {
			transform: rotate(-2deg);
		}
		75% {
			transform: rotate(2deg);
		}
	}
	.hint {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		white-space: nowrap;
		padding: 6px 16px;
		border-radius: 999px;
		background: var(--ink);
		color: var(--card);
		font-size: 1.05rem;
	}
	.empty {
		text-align: center;
		font-size: 2rem;
		font-family: var(--serif);
		margin-top: 18vh;
		color: var(--muted);
	}
	.finished {
		text-align: center;
		font-family: var(--serif);
		font-size: 2rem;
		color: var(--sun-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		--glyph-bg: var(--sun);
	}
	.exit {
		position: fixed;
		left: max(16px, env(safe-area-inset-left));
		bottom: max(16px, env(safe-area-inset-bottom));
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 0.85rem;
		background: var(--card);
		color: var(--muted);
		border: 1.5px solid var(--line-strong);
		opacity: 0.7;
	}
	.exit .fill {
		position: absolute;
		inset: 0 100% 0 0;
		background: var(--line-strong);
		z-index: -1;
	}
	.exit {
		isolation: isolate;
	}
	.exit.on .fill {
		inset: 0 0 0 0;
		transition: inset var(--hold) linear;
	}
	.party {
		position: fixed;
		inset: 0;
		z-index: 10;
		border: none;
		border-radius: 0;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(6px);
		color: var(--ink);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		animation: fade 0.3s ease;
	}
	.big {
		color: var(--sun);
		--glyph-bg: var(--sun);
		--glyph-bg-opacity: 0.5;
		animation: bounce 0.9s cubic-bezier(0.3, 1.8, 0.5, 1);
	}
	.yay {
		font-family: var(--serif);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-weight: 700;
		font-size: 4.5rem;
		line-height: 1;
	}
	.sub {
		font-size: 1.6rem;
		color: var(--muted);
	}
	.burst {
		position: absolute;
		top: 50%;
		left: 50%;
	}
	.fly {
		position: absolute;
		left: -22px;
		top: -22px;
		color: var(--tone);
		--glyph-bg: var(--tone);
		animation: fly 1.2s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
	}
	@keyframes fly {
		from {
			transform: rotate(var(--a)) translateY(0) scale(0.3);
			opacity: 1;
		}
		to {
			transform: rotate(var(--a)) translateY(calc(-1 * var(--d) - 120px)) scale(1);
			opacity: 0;
		}
	}
	@keyframes bounce {
		from {
			transform: scale(0.2) rotate(-30deg);
		}
		to {
			transform: scale(1) rotate(0);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.step,
		.step.pop,
		.step.wiggle,
		.big,
		.fly,
		.party {
			animation: none;
			transition: none;
		}
	}
</style>
