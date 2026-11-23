<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// The Board (ADR-30): colour, live, a tap ticks. Landscape first (a TV or a tablet on its
	// side); one column in portrait. Data comes from the server; the live feed and a timer
	// reload it, so what a phone or the wall changes shows within a second.

	const b = $derived(data.board);
	const KID_TONES = [2, 1, 3, 4, 0];
	const LOCK_MS = 700;

	let clock = $state('');
	function tick() {
		clock = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: b.tz }).format(new Date()).replace(/\s/g, ' ');
	}
	let live = $state(false);
	onMount(() => {
		tick();
		const t = setInterval(tick, 10_000);
		const refresh = setInterval(() => void invalidateAll(), 5 * 60_000); // routine windows, "past" greying
		let es: EventSource | null = null;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			es = new EventSource('/api/events');
			es.onopen = () => {
				live = true;
				void invalidateAll();
			};
			es.addEventListener('change', () => {
				clearTimeout(debounce);
				debounce = setTimeout(() => void invalidateAll(), 150);
			});
			es.onerror = () => {
				live = false;
				es?.close();
				retry = setTimeout(connect, 5000);
			};
		};
		connect();
		return () => {
			clearInterval(t);
			clearInterval(refresh);
			clearTimeout(retry);
			es?.close();
		};
	});

	// A tap shows at once; the server answer (and the live feed) settles it.
	const pending = new SvelteMap<string, boolean>();
	const locked = new Map<string, number>();
	const stepDone = (s: { id: number; done: boolean }) => pending.get(`s${s.id}`) ?? s.done;
	const itemDone = (i: { id: number; done: boolean }) => pending.get(`i${i.id}`) ?? i.done;

	async function post(action: 'step' | 'item', key: string, body: FormData, done: boolean) {
		if ((locked.get(key) ?? 0) > Date.now()) return;
		locked.set(key, Date.now() + LOCK_MS);
		pending.set(key, done);
		try {
			const res = await fetch(`?/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			if (deserialize(await res.text()).type !== 'success') throw new Error('failed');
			await invalidateAll();
		} catch {
			/* the next refresh shows the truth */
		}
		pending.delete(key);
	}
	function toggleStep(s: { id: number; done: boolean }) {
		const body = new FormData();
		body.set('stepId', String(s.id));
		body.set('done', stepDone(s) ? '0' : '1');
		void post('step', `s${s.id}`, body, !stepDone(s));
	}
	function toggleItem(i: { id: number; done: boolean }) {
		const body = new FormData();
		body.set('itemId', String(i.id));
		void post('item', `i${i.id}`, body, !itemDone(i));
	}
	const windArrow = (deg: number) => `rotate(${deg}deg)`;
</script>

<main class="board">
	<header>
		<div class="date">
			<h1>{b.dateLabel}</h1>
			<p class="clock" aria-live="off">{clock}<span class="live" class:on={live} title={live ? 'Live' : 'Reconnecting'}></span></p>
		</div>
		{#if b.weather}
			{@const w = b.weather}
			<div class="weather">
				<Glyph name={w.icon} size={56} label={w.label} />
				<div>
					<div class="temp">{Math.round(w.temp)}°<span class="range">{#if w.high !== null && w.low !== null}{Math.round(w.low)}–{Math.round(w.high)}°{/if}</span></div>
					<div class="wline">{w.label}{#if w.rain} · {w.rain}{/if}{#if w.wind} · <span class="arrow" style:transform={windArrow(w.wind.toward)}>↑</span> {w.wind.from} {w.wind.kmh} km/h{#if w.wind.change}, {w.wind.change.from} from {w.wind.change.at}{/if}{/if}</div>
				</div>
			</div>
		{/if}
	</header>

	<section class="now" aria-label="Routines">
		{#each b.kids as k, ki (k.id)}
			<article class="card kid tone-{KID_TONES[ki % 5]}">
				<h2><span class="who"><Glyph name={k.icon} size={30} /></span>{k.name}
					{#if k.dayType}<span class="pill"><Glyph name={k.dayType.glyph} size={16} /> {k.dayType.name}</span>{/if}
				</h2>
				{#if k.routine}
					{@const r = k.routine}
					<p class="sub">
						<strong>{r.name}</strong> · {r.window}
						{#if r.state === 'soon'}<span class="pill soft">Coming up</span>{:else}<span class="count">{r.steps.filter(stepDone).length} of {r.total}</span>{/if}
					</p>
					<ul class="steps" class:soon={r.state === 'soon'}>
						{#each r.steps as s, si (s.id)}
							<li>
								<button class="row tone-{si % 5}" class:done={stepDone(s)} aria-pressed={stepDone(s)} onclick={() => toggleStep(s)}>
									<span class="chip"><Glyph name={s.icon} size={30} /></span>
									<span class="title">{s.title}</span>
									<span class="tick">{#if stepDone(s)}<Glyph name="check" size={22} />{/if}</span>
								</button>
							</li>
						{:else}
							<li class="muted">Nothing on the list today.</li>
						{/each}
					</ul>
					{#if r.state === 'now' && r.total && r.steps.every(stepDone)}<p class="alldone">All done!</p>{/if}
				{:else if k.next}
					<p class="sub">Next: <strong>{k.next.name}</strong> at {k.next.start}</p>
				{:else}
					<p class="sub muted">Nothing more today.</p>
				{/if}
			</article>
		{/each}
		{#if b.baby}
			{@const p = b.baby}
			<article class="card kid baby tone-3">
				<h2><span class="who"><Glyph name={p.icon} size={30} /></span>{p.name} <span class="pill soft">{p.plan}</span></h2>
				{#if p.running}
					<p class="sub big"><Glyph name={p.running.icon} size={26} /> {p.running.title}{#if p.running.since} since {p.running.since}{/if}</p>
				{:else if p.next}
					<p class="sub big">Next: <Glyph name={p.next.icon} size={26} /> {p.next.title}{#if p.next.time} · {p.next.estimate ? '~' : ''}{p.next.time}{:else if p.next.waiting} · after {p.next.waiting}{/if}</p>
				{:else}
					<p class="sub muted">Day plan finished.</p>
				{/if}
				<p class="muted small">{p.done} of {p.total} today · ticked on phones</p>
			</article>
		{/if}
	</section>

	<section class="side" aria-label="To do and lists">
		<article class="card">
			<h2>To do</h2>
			<ul class="items">
				{#each b.todo as i (i.id)}
					<li>
						<button class="row small" class:done={itemDone(i)} aria-pressed={itemDone(i)} onclick={() => toggleItem(i)}>
							<span class="box">{#if itemDone(i)}<Glyph name="check" size={18} />{/if}</span>
							<span class="title">{i.title}</span>
							{#if i.due}<span class="due" class:late={i.late}>{i.due}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="muted">Nothing urgent.</li>
				{/each}
				{#if b.todoMore}<li class="muted">+{b.todoMore} more</li>{/if}
			</ul>
		</article>
		{#each b.lists as l (l.id)}
			<article class="card">
				<h2><Glyph name={l.icon} size={22} /> {l.name} <span class="count">{l.items.filter((i) => !itemDone(i)).length}</span></h2>
				<ul class="items">
					{#each l.items as i (i.id)}
						<li>
							<button class="row small" class:done={itemDone(i)} aria-pressed={itemDone(i)} onclick={() => toggleItem(i)}>
								<span class="box">{#if itemDone(i)}<Glyph name="check" size={18} />{/if}</span>
								<span class="title">{i.title}</span>
								{#if i.due}<span class="due" class:late={i.late}>{i.due}</span>{/if}
							</button>
						</li>
					{:else}
						<li class="muted">Nothing on the list.</li>
					{/each}
				</ul>
			</article>
		{/each}
	</section>

	<section class="week" aria-label="This week">
		{#each b.week as d (d.date)}
			<article class="cell" class:today={d.today} class:past={d.past}>
				<h3><span class="wd">{d.weekday}</span> <span class="dnum">{d.day}</span>{#if d.today}<span class="badge">Today</span>{/if}</h3>
				<ul>
					{#each d.events as e, i (i)}
						<li class:past={e.past} class:todo={e.kind === 'todo'}>
							{#if e.icon}<Glyph name={e.icon} size={16} />{:else if e.kind === 'todo'}<span class="dot"></span>{/if}
							{#if e.time}<span class="t">{e.time}</span>{/if}
							<span class="et">{e.title}</span>
						</li>
					{/each}
					{#if d.more}<li class="muted">+{d.more} more</li>{/if}
				</ul>
			</article>
		{/each}
		<article class="cell next">
			<h3><span class="wd">Next week</span><span class="badge soft">{b.nextWeek.count} {b.nextWeek.count === 1 ? 'thing' : 'things'}</span></h3>
			<ul>
				{#each b.nextWeek.events as e, i (i)}
					<li class:todo={e.kind === 'todo'}><span class="t">{e.weekday}</span><span class="et">{e.title}</span></li>
				{/each}
				{#if b.nextWeek.count > b.nextWeek.events.length}<li class="muted">+{b.nextWeek.count - b.nextWeek.events.length} more</li>{/if}
			</ul>
		</article>
		{#if !b.calendar}<p class="muted nocal">No calendar connected: the week shows dated to-dos only.</p>{/if}
	</section>
</main>

<style>
	:global(html) {
		/* Scale with the screen: readable from across a kitchen on a TV, normal on a tablet. */
		font-size: clamp(15px, 0.55vw + 10px, 26px);
	}
	.board {
		min-height: 100vh;
		padding: 1.2rem 1.4rem 1.6rem;
		box-sizing: border-box;
		display: grid;
		gap: 1.1rem;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		grid-template-areas:
			'head head'
			'now side'
			'week week';
		align-content: start;
	}
	@media (max-aspect-ratio: 1/1), (max-width: 760px) {
		.board {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'head' 'now' 'side' 'week';
			padding: 1rem 16px 1.4rem;
		}
	}
	header {
		grid-area: head;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: 2.3rem;
		margin: 0;
	}
	.clock {
		margin: 0.1rem 0 0;
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.live {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--line-strong);
	}
	.live.on {
		background: var(--teal);
	}
	.weather {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		color: var(--ink);
	}
	.temp {
		font: 700 2.2rem/1 var(--sans);
	}
	.range {
		font-size: 1rem;
		font-weight: 500;
		color: var(--muted);
		margin-left: 0.6rem;
	}
	.wline {
		color: var(--muted);
		margin-top: 0.25rem;
	}
	.arrow {
		display: inline-block;
		font-weight: 700;
	}
	.now {
		grid-area: now;
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	.side {
		grid-area: side;
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	.week {
		grid-area: week;
	}
	.card {
		background: var(--card);
		border-radius: 18px;
		box-shadow: var(--shadow);
		padding: 1rem 1.1rem;
	}
	h2 {
		font-size: 1.35rem;
		margin: 0 0 0.4rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.who {
		display: inline-grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: var(--tone-soft);
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.45;
	}
	.pill {
		font: 600 0.85rem var(--sans);
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--tone-soft);
		color: var(--tone-ink);
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.pill.soft {
		background: var(--bg);
		color: var(--muted);
	}
	.count {
		margin-left: auto;
		font-weight: 600;
		color: var(--muted);
	}
	.sub {
		margin: 0 0 0.6rem;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.sub strong {
		color: var(--ink);
	}
	.sub.big {
		font-size: 1.25rem;
		color: var(--ink);
	}
	.small {
		font-size: 0.9rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.steps li + li,
	.items li + li {
		margin-top: 0.35rem;
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--card);
		color: var(--ink);
		font: 600 1.15rem var(--sans);
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}
	.row.small {
		font-size: 1.05rem;
		padding: 0.5rem 0.6rem;
		font-weight: 500;
	}
	.row:active {
		transform: scale(0.99);
	}
	.row.done {
		background: var(--tone-soft, var(--bg));
		border-color: transparent;
	}
	.row.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}
	.steps.soon .row {
		opacity: 0.85;
	}
	.chip {
		display: inline-grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		border-radius: 12px;
		background: var(--tone-soft);
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.45;
	}
	.title {
		flex: 1;
		min-width: 0;
	}
	.tick,
	.box {
		display: inline-grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		border: 2px solid var(--line-strong);
		color: var(--on-accent);
	}
	.box {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 8px;
	}
	.row.done .tick,
	.row.done .box {
		background: var(--accent);
		border-color: var(--accent);
	}
	.due {
		font-size: 0.85rem;
		color: var(--muted);
		white-space: nowrap;
	}
	.due.late {
		color: var(--warn);
		font-weight: 600;
	}
	.alldone {
		margin: 0.6rem 0 0;
		font: 650 1.4rem var(--serif);
		color: var(--tone-ink);
	}
	.week {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.7rem;
	}
	/* A TV: the eight cells in one row so the whole board fits 16:9 without scrolling. */
	@media (min-width: 1500px) and (min-aspect-ratio: 3/2) {
		.week {
			grid-template-columns: repeat(8, minmax(0, 1fr));
		}
		.cell {
			min-height: 6.5rem;
		}
	}
	@media (max-width: 760px) {
		.week {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.cell {
		background: var(--card);
		border-radius: 14px;
		box-shadow: var(--shadow);
		padding: 0.7rem 0.8rem;
		min-height: 7.5rem;
	}
	.cell.past {
		opacity: 0.55;
	}
	.cell.today {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.cell h3 {
		margin: 0 0 0.4rem;
		font: 600 0.95rem var(--sans);
		color: var(--muted);
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}
	.dnum {
		font: 650 1.4rem var(--serif);
		color: var(--ink);
	}
	.badge {
		margin-left: auto;
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
	}
	.badge.soft {
		background: var(--bg);
		color: var(--muted);
	}
	.cell li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.95rem;
		line-height: 1.3;
		padding: 0.12rem 0;
	}
	.cell li.past {
		color: var(--muted);
		text-decoration: line-through;
	}
	.cell .t {
		color: var(--muted);
		white-space: nowrap;
		min-width: 3.6em;
		font-size: 0.85rem;
	}
	.cell .et {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--sun);
		flex: none;
	}
	.nocal {
		grid-column: 1 / -1;
		margin: 0;
	}
	.muted {
		color: var(--muted);
	}
</style>
