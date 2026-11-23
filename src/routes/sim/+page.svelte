<script lang="ts">
	import '$lib/wall-fonts.css';
	import { onMount } from 'svelte';

	// Two views of the wall:
	//  glass  — the fake E1003's real framebuffer from Tesserae (full frames + patches),
	//           with tap regions from Tesserae's manifest; clicks are reported to Tesserae.
	//  direct — the same painter run in this browser from /sim/direct; no Tesserae.
	type Region = { id: string; x: number; y: number; w: number; h: number };
	type Stats = { connected: boolean; frames: number; patches: number; lastLatencyMs: number | null; lastSettledMs: number | null; latencies: number[]; settled: number[]; error: string | null };
	type State = { bootstrap: { state: string; error: string | null }; wall: null | { id: string; stats: Stats; regions: Region[]; hasFrame: boolean } };

	const W = 1404;
	const H = 1872;
	let view = $state<'glass' | 'direct'>('glass');
	let scale = $state(0.4);
	let sim = $state<State | null>(null);
	let glassSeq = $state(0);
	let flash = $state<string | null>(null);
	let lastOutcome = $state('');
	let pushes = $state<string[]>([]);
	let host: HTMLDivElement | undefined = $state();
	let shadow: ShadowRoot | null = null;

	const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

	async function refreshState() {
		sim = await (await fetch('/sim/state')).json();
		if (sim && !sim.wall?.hasFrame && view === 'glass' && sim.bootstrap.state !== 'running') view = 'direct';
	}

	async function paintDirect() {
		if (!host) return;
		const payload = await (await fetch('/sim/direct')).json();
		// Load the wall fonts first so the painter's fit-to-page measures the real text.
		await Promise.all(["50px 'FH Fraunces'", "50px 'FH Outfit'"].map((f) => document.fonts.load(f).catch(() => [])));
		shadow ??= host.attachShadow({ mode: 'open' });
		(window as unknown as { paintWall: (r: ShadowRoot, d: unknown, o: unknown) => void }).paintWall(shadow, { hub: { payload } }, { calendarPlaceholder: true });
	}

	async function tapGlass(r: Region) {
		flash = r.id; // tier-0 feedback: the panel inverts the region instantly
		setTimeout(() => (flash = null), 450);
		const res = await fetch('/sim/tap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regionId: r.id }) });
		lastOutcome = (await res.json()).outcome ?? `error ${res.status}`;
	}

	async function tapDirect(e: Event) {
		// Rows live in a shadow root, so the event target is retargeted to the host.
		// Like the wall, only tap targets (a routine row, a list box, a button) react and invert.
		const path = e.composedPath();
		const hit = path.find((n) => n instanceof HTMLElement && n.dataset.hit) as HTMLElement | undefined;
		const row = path.find((n) => n instanceof HTMLElement && n.dataset.slot) as HTMLElement | undefined;
		if (!hit || !row) return;
		hit.style.filter = 'invert(1)';
		setTimeout(() => (hit.style.filter = ''), 450);
		const res = await fetch('/sim/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: Number(row.dataset.slot) }) });
		const j = await res.json();
		lastOutcome = j.screen ? `opened ${j.screen}` : j.applied ? `applied: ${j.state}` : (j.reason ?? `error ${res.status}`);
		await paintDirect();
	}

	/** The wall's side buttons (ADR-28): previous, home, next screen. */
	async function press(button: 'prev' | 'home' | 'next') {
		const res = await fetch('/sim/button', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ button, glass: view === 'glass' }) });
		const j = await res.json();
		lastOutcome = j.label ? `button ${button} → ${j.label}` : (j.error ?? `error ${res.status}`);
		if (view === 'direct') await paintDirect();
	}

	function fit() {
		scale = Math.min(0.6, Math.max(0.2, (window.innerHeight - 150) / H));
	}

	onMount(() => {
		fit();
		window.addEventListener('resize', fit);
		const script = document.createElement('script');
		script.src = '/sim/paint.js';
		script.onload = () => void paintDirect();
		document.head.appendChild(script);
		void refreshState();
		const es = new EventSource('/api/events');
		es.addEventListener('frame', (e) => {
			glassSeq = JSON.parse((e as MessageEvent).data).seq;
			void refreshState();
		});
		es.addEventListener('change', () => void paintDirect());
		es.addEventListener('push', (e) => {
			const p = JSON.parse((e as MessageEvent).data);
			pushes = [`${p.mode} push → ${p.status} (${Math.round(p.ms)} ms)`, ...pushes].slice(0, 5);
		});
		const timer = setInterval(refreshState, 5000);
		return () => {
			es.close();
			clearInterval(timer);
			window.removeEventListener('resize', fit);
		};
	});
	$effect(() => {
		if (view === 'direct' && host) void paintDirect();
	});
</script>

<svelte:head><title>Family Hub · Simulator</title></svelte:head>

<div class="sim">
	<header>
		<a href="/planner">← Planner</a>
		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={view === 'glass'} class:on={view === 'glass'} onclick={() => (view = 'glass')} disabled={!sim?.wall}>Glass (via Tesserae)</button>
			<button role="tab" aria-selected={view === 'direct'} class:on={view === 'direct'} onclick={() => (view = 'direct')}>Direct</button>
		</div>
	</header>

	<div class="body">
		<div class="panel" style={`width:${W * scale}px;height:${H * scale}px`}>
			{#if view === 'glass'}
				{#if sim?.wall?.hasFrame}
					<img src={`/sim/glass.png?v=${glassSeq}`} alt="Wall as rendered by Tesserae" width={W * scale} height={H * scale} />
					{#each sim.wall.regions as r (r.id)}
						<button
							class="region"
							class:flash={flash === r.id}
							data-region={r.id}
							aria-label={`Tap ${r.id}`}
							style={`left:${r.x * scale}px;top:${r.y * scale}px;width:${r.w * scale}px;height:${r.h * scale}px`}
							onclick={() => tapGlass(r)}
						></button>
					{/each}
				{:else}
					<p class="wait">Waiting for the first Tesserae frame… (setup: {sim?.bootstrap.state ?? '…'}{sim?.bootstrap.error ? ` — ${sim.bootstrap.error}` : ''})</p>
				{/if}
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="direct" style={`transform:scale(${scale})`} bind:this={host} onclick={tapDirect} data-testid="direct"></div>
			{/if}
		</div>

		<div class="buttons" role="group" aria-label="Wall side buttons">
			<button onclick={() => press('prev')} aria-label="Previous page">◀</button>
			<button onclick={() => press('home')} aria-label="Home">●</button>
			<button onclick={() => press('next')} aria-label="Next page">▶</button>
		</div>

		<aside>
			<h2>{view === 'glass' ? 'Fake E1003' : 'Direct render'}</h2>
			{#if view === 'glass' && sim?.wall}
				<p>Device <code>{sim.wall.id}</code> · {sim.wall.stats.connected ? 'polling 1 s' : 'offline'}</p>
				<p>Frames {sim.wall.stats.frames} · patches {sim.wall.stats.patches}</p>
				<p>
					Tap → glass: <strong data-testid="latency">{sim.wall.stats.lastLatencyMs ?? '–'} ms</strong>
					{#if sim.wall.stats.latencies.length > 1}<span class="muted">(median {median(sim.wall.stats.latencies)} ms, n={sim.wall.stats.latencies.length})</span>{/if}
				</p>
				<p>
					Settled: <strong>{sim.wall.stats.lastSettledMs ?? '–'} ms</strong>
					{#if sim.wall.stats.settled.length > 1}<span class="muted">(median {median(sim.wall.stats.settled)} ms)</span>{/if}
				</p>
				{#if sim.wall.stats.error}<p class="error">{sim.wall.stats.error}</p>{/if}
			{:else if view === 'direct'}
				<p class="muted">Same painter as the Tesserae code element; the calendar band is Tesserae’s own widget on the real wall.</p>
			{/if}
			<p>Last tap: <strong data-testid="outcome">{lastOutcome || '–'}</strong></p>
			{#if pushes.length}<h3>Repaints</h3><ul>{#each pushes as p, i (i)}<li>{p}</li>{/each}</ul>{/if}
			<p class="muted small">The glass view applies patches the way the firmware does. The ~0.4 s invert stands in for the panel’s tier-0 feedback; real refresh time is added on hardware.</p>
		</aside>
	</div>
</div>

<style>
	.buttons {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-self: center;
	}
	.buttons button {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 2px solid #1b1b1b;
		background: #fff;
		font-size: 20px;
		cursor: pointer;
	}
	:global(body) {
		margin: 0;
		font: 15px/1.4 system-ui, sans-serif;
		background: #e9e7e2;
		color: #1b1b1b;
	}
	.sim {
		padding: 10px 16px;
	}
	header {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}
	.tabs button {
		font: inherit;
		padding: 6px 12px;
		border: 1px solid #999;
		background: #fff;
		cursor: pointer;
	}
	.tabs button.on {
		background: #1b1b1b;
		color: #fff;
	}
	.body {
		display: flex;
		gap: 20px;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.panel {
		position: relative;
		background: #fff;
		box-shadow: 0 0 0 14px #2b2b2b, 0 8px 30px rgba(0, 0, 0, 0.35);
		border-radius: 4px;
		margin: 14px;
		overflow: hidden;
	}
	.panel img {
		display: block;
	}
	.region {
		position: absolute;
		background: transparent;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	.region:hover {
		outline: 2px dashed rgba(31, 95, 139, 0.6);
	}
	.region.flash {
		background: #000;
		mix-blend-mode: difference;
		filter: invert(1);
	}
	.direct {
		width: 1404px;
		height: 1872px;
		transform-origin: 0 0;
		cursor: pointer;
	}
	.wait {
		padding: 20px;
	}
	aside {
		max-width: 340px;
	}
	aside h2 {
		margin: 4px 0 8px;
	}
	.muted {
		color: #666;
	}
	.small {
		font-size: 0.85rem;
	}
	.error {
		color: #a14a1a;
	}
</style>
