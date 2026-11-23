<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	// Home (ADR-38): the day at a glance. Cards follow the day: a running routine leads; before
	// one, the weather and today's events lead; once the routines are over, tomorrow shows.
	const h = $derived(data.home);
	type Section = 'now' | 'today' | 'weather' | 'todo' | 'lists' | 'week';
	const ORDER: Record<typeof h.phase, Section[]> = {
		routine: ['now', 'today', 'weather', 'todo', 'lists', 'week'],
		day: ['weather', 'today', 'now', 'todo', 'lists', 'week'],
		evening: ['now', 'today', 'weather', 'todo', 'lists', 'week']
	};
	const sections = $derived(ORDER[h.phase]);
	// First child marigold, then teal, plum, sky, tomato (as on Routines).
	const KID_TONES = [2, 1, 3, 4, 0];

	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		const refresh = setInterval(() => void invalidateAll(), 5 * 60_000); // routine windows, past events
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		return () => {
			clearInterval(t);
			clearInterval(refresh);
			es.close();
		};
	});

	/** "35 min", "2 h 10". */
	const ago = (iso: string) => {
		const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
		return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;
	};
	const RING = 2 * Math.PI * 17;
	const kidsShown = $derived(h.kids.filter((k) => k.routine || k.next));
	const hasNow = $derived(kidsShown.length > 0 || h.baby !== null);
</script>

<div class="eyebrow">{h.dateLabel}</div>
<h1>{h.greeting}</h1>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#each sections as s (s)}
	{#if s === 'weather' && h.weather}
		{@const w = h.weather}
		<section class="card weather tone-4" aria-label="Weather">
			<div class="wnow">
				<Glyph name={w.icon} size={44} label={w.label} />
				<div>
					<div class="temp">{Math.round(w.temp)}°</div>
					<div class="wline">
						{w.label}{#if w.high !== null && w.low !== null}{` · ${Math.round(w.low)}–${Math.round(w.high)}°`}{/if}{#if w.rain}<br />{w.rain}{/if}
					</div>
				</div>
			</div>
			{#if w.blocks}
				<ol class="blocks">
					{#each w.blocks as b (b.name)}
						<li>
							<span class="bname">{b.name}</span>
							<Glyph name={b.icon} size={22} label={b.label} />
							<b>{Math.round(b.temp)}°</b>
							{#if b.rain}<span class="chip-s">{b.rain.pct}%</span>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{:else if s === 'now' && hasNow}
		<section class="card now" aria-labelledby="h-now">
			<div class="head"><h2 id="h-now">{h.phase === 'evening' ? 'Tonight' : 'Now'}</h2><a href="/planner/routines">Routines</a></div>
			<ul class="rows">
				{#each kidsShown as k, ki (k.id)}
					{@const r = k.routine}
					{@const next = r?.steps.find((x) => !x.done)}
					<li class="kid tone-{KID_TONES[ki % 5]}">
						<a class="who" href="/planner/routines">
							<span class="ring">
								<svg viewBox="0 0 40 40" aria-hidden="true"
									><circle cx="20" cy="20" r="17" class="track" /><circle
										cx="20"
										cy="20"
										r="17"
										class="fill"
										stroke-dasharray={RING}
										stroke-dashoffset={r && r.total ? RING * (1 - r.done / r.total) : RING}
									/></svg
								>
								<Glyph name={k.icon} size={20} />
							</span>
							<span class="txt">
								<span class="nm">{k.name}{#if r}{` · ${r.name}`}{/if}</span>
								<span class="sub">
									{#if r && r.state === 'soon'}{`Starts ${r.window.split(' – ')[0]}${next ? ` · first: ${next.title}` : ''}`}
									{:else if next}{`Next: ${next.title} · ${r?.done}/${r?.total}`}
									{:else if r}{`All done${k.next ? ` · ${k.next.name} at ${k.next.start}` : ''}`}
									{:else if k.next}{`${k.next.name} at ${k.next.start}`}{/if}
								</span>
							</span>
						</a>
						{#if next && r?.state === 'now'}
							<form method="POST" action="?/step" use:enhance={keep()}>
								<input type="hidden" name="stepId" value={next.id} />
								<input type="hidden" name="done" value="1" />
								<button class="act" aria-label={`${next.title} done`}><Glyph name="check" size={18} />Done</button>
							</form>
						{/if}
					</li>
				{/each}
				{#if h.baby}
					{@const b = h.baby}
					<li class="kid tone-3">
						<a class="who" href="/planner/routines">
							<span class="ring solo"><Glyph name={b.running?.icon ?? b.icon} size={20} /></span>
							<span class="txt">
								<span class="nm">{b.name}{#if b.running}{` · ${b.running.title.toLowerCase()} ${ago(b.running.since)}`}{/if}</span>
								<span class="sub">
									{[b.last ? `${b.last.title} ${ago(b.last.at)} ago` : '', b.next && !b.running ? `next ${b.next.title}${b.next.time ? ` ${b.next.estimate ? '~' : ''}${b.next.time}` : ''}` : ''].filter(Boolean).join(' · ') || `${b.done}/${b.total} today`}
								</span>
							</span>
						</a>
						{#if b.running}
							<form method="POST" action="?/timer" use:enhance={keep()}>
								<input type="hidden" name="stepId" value={b.running.stepId} />
								<input type="hidden" name="op" value="stop" />
								<input type="hidden" name="ago" value="0" />
								<button class="act">Stop</button>
							</form>
						{:else if b.next?.timer}
							<form method="POST" action="?/timer" use:enhance={keep()}>
								<input type="hidden" name="stepId" value={b.next.stepId} />
								<input type="hidden" name="op" value="start" />
								<input type="hidden" name="ago" value="0" />
								<button class="act">Start</button>
							</form>
						{:else if b.next}
							<form method="POST" action="?/step" use:enhance={keep()}>
								<input type="hidden" name="stepId" value={b.next.stepId} />
								<input type="hidden" name="done" value="1" />
								<button class="act" aria-label={`${b.next.title} done`}><Glyph name="check" size={18} />{b.next.title}</button>
							</form>
						{/if}
					</li>
				{/if}
			</ul>
		</section>
	{:else if s === 'today'}
		<section class="card" aria-labelledby="h-today">
			<div class="head"><h2 id="h-today">Today</h2><a href="/planner/calendar">Calendar</a></div>
			{#if !h.calendar.connected}
				<p class="muted">No calendar connected. Add one in Tesserae (Settings → Calendar).</p>
			{:else}
				{#if h.calendar.today.length}
					<ul class="events">
						{#each h.calendar.today as e, i (i)}
							<li><span class="tm">{e.time ?? 'All day'}</span><span>{e.title}{#if e.location}<span class="muted">{` · ${e.location}`}</span>{/if}</span></li>
						{/each}
					</ul>
				{:else}
					<p class="muted">Nothing else on today.</p>
				{/if}
				{#if h.calendar.tomorrow}
					<h3 class="sub-h">Tomorrow</h3>
					{#if h.calendar.tomorrow.length}
						<ul class="events">
							{#each h.calendar.tomorrow as e, i (i)}
								<li><span class="tm">{e.time ?? 'All day'}</span><span>{e.title}</span></li>
							{/each}
						</ul>
					{:else}
						<p class="muted">Nothing on tomorrow.</p>
					{/if}
				{/if}
				{#if h.calendar.error}<p class="muted small">Some calendars did not load: {h.calendar.error}</p>{/if}
			{/if}
		</section>
	{:else if s === 'todo' && h.due.length}
		<section class="card" aria-labelledby="h-todo">
			<div class="head"><h2 id="h-todo">To do</h2><a href="/planner/lists">Lists</a></div>
			<ul class="todo">
				{#each h.due as i (i.id)}
					<li>
						<form method="POST" action="?/item" use:enhance={keep()}>
							<input type="hidden" name="itemId" value={i.id} />
							<button class="item" aria-pressed={i.done}>
								<span class="box">{#if i.done}<Glyph name="check" size={16} />{/if}</span>
								<span class="ttl">{i.title}</span>
								{#if i.due}<span class="due" class:late={i.late}>{i.due}</span>{/if}
							</button>
						</form>
					</li>
				{/each}
			</ul>
			{#if h.dueMore > 0}<a class="more" href="/planner/lists">{h.dueMore} more</a>{/if}
		</section>
	{:else if s === 'lists' && (h.lists.length || h.notes.length)}
		<section class="card" aria-labelledby="h-lists">
			<div class="head"><h2 id="h-lists">Lists and notes</h2></div>
			<ul class="links">
				{#each h.lists as l, li (l.id)}
					<li>
						<a href={`/planner/lists?list=${l.id}`} class="tone-{li % 5}">
							<span class="ico"><Glyph name={l.icon} size={20} /></span>
							<span class="nm">{l.name}</span>
							<span class="muted">{l.open ? `${l.open} item${l.open === 1 ? '' : 's'}` : 'Empty'}</span>
						</a>
					</li>
				{/each}
				{#each h.notes as n (n.id)}
					<li>
						<a href={`/planner/notes/${n.id}`} class="tone-2">
							<span class="ico"><Glyph name="note" size={20} /></span>
							<span class="nm">{n.title || n.preview || 'Untitled note'}</span>
							<span class="muted">{n.edited}</span>
						</a>
					</li>
				{/each}
			</ul>
			{#if h.listsMore || h.notesMore}
				<p class="more-row">
					{#if h.listsMore}<a href="/planner/lists">{h.listsMore} more list{h.listsMore === 1 ? '' : 's'}</a>{/if}
					{#if h.notesMore}<a href="/planner/notes">{h.notesMore} more note{h.notesMore === 1 ? '' : 's'}</a>{/if}
				</p>
			{/if}
		</section>
	{:else if s === 'week' && h.calendar.connected}
		<section class="card" aria-labelledby="h-week">
			<div class="head"><h2 id="h-week">This week</h2><a href="/planner/calendar">Calendar</a></div>
			<a class="week" href="/planner/calendar" aria-label="Open the calendar">
				{#each h.week as d (d.date)}
					{@const n = d.events.length + d.more}
					<span class="day" class:today={d.today} class:past={d.past}>
						<span class="wd">{d.weekday.slice(0, 1)}</span>
						<b>{d.day}</b>
						<span class="dots" aria-label={`${n} event${n === 1 ? '' : 's'}`}>{#each Array(Math.min(n, 4)) as _, j (j)}<i></i>{/each}</span>
					</span>
				{/each}
			</a>
		</section>
	{/if}
{/each}

<style>
	h1 {
		margin-bottom: 0.8rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 8px;
	}
	.head h2 {
		margin: 0;
		font-size: 1.2rem;
	}
	.head a,
	.more,
	.more-row a {
		font-weight: 500;
		font-size: 0.95rem;
		text-decoration: none;
	}
	.more {
		display: inline-block;
		margin-top: 8px;
	}
	.more-row {
		display: flex;
		gap: 16px;
		margin: 8px 0 0;
	}
	.small {
		font-size: 0.85rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* Weather: now on the left, the wall's four blocks (ADR-36) on the right or below. */
	.weather {
		background: var(--tone-soft);
		color: var(--tone-ink);
		display: grid;
		gap: 12px;
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.35;
	}
	.wnow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.temp {
		font-family: var(--serif);
		font-size: 2.2rem;
		font-weight: 650;
		line-height: 1;
	}
	.wline {
		font-size: 0.92rem;
	}
	.blocks {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		list-style: none;
		margin: 0;
		padding: 0;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.blocks li {
		display: grid;
		justify-items: center;
		gap: 2px;
		padding: 6px 0;
		border-radius: 14px;
		background: var(--card);
		color: var(--ink);
	}
	.bname {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.chip-s {
		font-size: 0.72rem;
		color: var(--sky-ink);
	}

	/* Now: one row per child (and the baby), the next step ticked in place. */
	.rows {
		display: grid;
		gap: 10px;
	}
	.kid {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		color: inherit;
		text-decoration: none;
	}
	.ring {
		position: relative;
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.5;
	}
	.ring svg {
		position: absolute;
		inset: 0;
		transform: rotate(-90deg);
	}
	.ring .track {
		fill: none;
		stroke: var(--tone-soft);
		stroke-width: 4;
	}
	.ring .fill {
		fill: none;
		stroke: var(--tone);
		stroke-width: 4;
		stroke-linecap: round;
	}
	.ring.solo {
		background: var(--tone-soft);
		border-radius: 50%;
	}
	.txt {
		display: grid;
		min-width: 0;
	}
	.nm {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 0.88rem;
		color: var(--muted);
	}
	.act {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 8px 14px;
		min-height: 40px;
		background: var(--tone);
		border-color: var(--tone);
		color: var(--card);
		white-space: nowrap;
		max-width: 9.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Calendar */
	.events {
		display: grid;
		gap: 6px;
	}
	.events li {
		display: grid;
		grid-template-columns: 4.6rem 1fr;
		gap: 8px;
		font-variant-numeric: tabular-nums;
	}
	.tm {
		color: var(--muted);
		font-size: 0.92rem;
	}
	.sub-h {
		margin: 12px 0 6px;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* To do: the whole row is the button, as on Lists. */
	.todo {
		display: grid;
		gap: 2px;
	}
	.item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 2px;
		min-height: 44px;
		background: none;
		border: 0;
		border-radius: 10px;
		color: var(--ink);
		font-weight: 500;
		text-align: left;
	}
	.box {
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 8px;
		border: 2px solid var(--line-strong);
		display: grid;
		place-items: center;
	}
	.item[aria-pressed='true'] .box {
		background: var(--teal);
		border-color: var(--teal);
		color: var(--card);
	}
	.item[aria-pressed='true'] .ttl {
		text-decoration: line-through;
		color: var(--muted);
	}
	.ttl {
		flex: 1;
		min-width: 0;
	}
	.due {
		font-size: 0.8rem;
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--sun-soft);
		color: var(--sun-ink);
		white-space: nowrap;
	}
	.due.late {
		background: var(--tomato-soft);
		color: var(--tomato-ink);
	}

	/* Lists and notes: one line each. */
	.links {
		display: grid;
		gap: 2px;
	}
	.links a {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		color: var(--ink);
		text-decoration: none;
	}
	.links .ico {
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--tone-soft);
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.5;
	}
	.links .nm {
		flex: 1;
	}
	.links .muted {
		font-size: 0.88rem;
		white-space: nowrap;
	}

	/* This week: Mon–Sun with a dot per event (up to four). */
	.week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 4px;
		text-decoration: none;
		color: var(--ink);
		text-align: center;
	}
	.day {
		display: grid;
		gap: 2px;
		padding: 7px 0 6px;
		border-radius: 14px;
		background: var(--bg);
		font-variant-numeric: tabular-nums;
	}
	.day.today {
		background: var(--ink);
		color: var(--card);
	}
	.day.past {
		opacity: 0.45;
	}
	.wd {
		font-size: 0.75rem;
		opacity: 0.75;
	}
	.dots {
		height: 6px;
		display: flex;
		gap: 2px;
		justify-content: center;
	}
	.dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--teal);
	}
	.day.today .dots i {
		background: var(--sun);
	}
</style>
