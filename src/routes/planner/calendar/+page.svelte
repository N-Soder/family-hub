<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	// Calendar files change when Tesserae refreshes its feeds; the change feed covers taps and
	// edits, so also re-read every few minutes while the page is open.
	onMount(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		const t = setInterval(() => invalidateAll(), 5 * 60_000);
		return () => {
			es.close();
			clearInterval(t);
		};
	});
	const person = $derived(new Map(data.people.map((p, i) => [p.name.toLowerCase(), { icon: p.icon, tone: i % 5 }])));
	type Ev = (typeof data.calendar.today)[number];
</script>

<div class="eyebrow">{data.dateLabel}</div>
<h1>Calendar</h1>

{#snippet who(e: Ev, size: number)}
	{@const p = person.get(e.feed.toLowerCase())}
	{#if p}<span class="who tone-{p.tone}"><Glyph name={p.icon} {size} label={e.feed} /></span>{/if}
{/snippet}

{#if !data.calendar.connected}
	<section class="card empty">
		<span class="chip tone-2"><Glyph name="calendar" size={26} /></span>
		<p>No calendar yet. Calendars added to the wall in Tesserae show up here too.</p>
	</section>
{:else}
	<h2>Today</h2>
	<ul class="card events">
		{#each data.calendar.today as e (e.title + e.start)}
			<li class:past={e.past}>
				{#if e.time}<span class="when">{e.time}</span>{:else}<span class="when"><span class="pill tone-2">All day</span></span>{/if}
				<span class="what">
					<span class="title">{@render who(e, 20)}{e.title}</span>
					{#if e.location}<span class="where muted"><Glyph name="pin" size={15} />{e.location}</span>{/if}
				</span>
			</li>
		{:else}
			<li class="quiet muted">Nothing on today.</li>
		{/each}
	</ul>

	<h2>Coming up</h2>
	<ol class="days">
		{#each data.calendar.upcoming as d (d.date)}
			<li class="day" class:card={d.events.length} class:blank={!d.events.length}>
				<div class="dlabel">
					<span class="wd">{d.weekday}</span>
					<span class="muted">{d.label}</span>
				</div>
				{#if d.events.length}
					<ul class="devs">
						{#each d.events as e (e.title + e.start)}
							<li>
								<span class="dtime">{e.time ?? 'All day'}</span>
								<span class="title">{@render who(e, 18)}{e.title}{#if e.location}<span class="muted">{' · '}{e.location}</span>{/if}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<span class="muted free">Nothing on</span>
				{/if}
			</li>
		{/each}
	</ol>
	{#if data.calendar.error}<p class="muted">Calendar: {data.calendar.error}</p>{/if}
{/if}

<style>
	.empty {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.empty p {
		margin: 0;
	}
	h2 {
		margin: 22px 0 10px;
	}
	.events {
		list-style: none;
		margin: 0;
		padding: 4px 16px;
	}
	.events li {
		display: flex;
		gap: 14px;
		padding: 12px 0;
		align-items: baseline;
	}
	.events li + li {
		border-top: 1px solid var(--line);
	}
	.when {
		flex: none;
		width: 78px;
		font-weight: 700;
		color: var(--accent-ink);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.title {
		font-weight: 500;
		font-size: 1.05rem;
	}
	.where {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.9rem;
	}
	.past {
		opacity: 0.6;
	}
	.past .when {
		color: var(--muted);
		font-weight: 500;
	}
	.quiet {
		padding: 14px 0;
	}
	.who {
		display: inline-grid;
		place-items: center;
		vertical-align: -4px;
		margin-right: 6px;
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.45;
	}
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.day {
		display: flex;
		gap: 14px;
		margin: 0;
	}
	.day.blank {
		padding: 2px 16px;
		align-items: baseline;
	}
	.dlabel {
		flex: none;
		width: 78px;
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.blank .dlabel {
		flex-direction: row;
		gap: 6px;
		width: auto;
		color: var(--muted);
	}
	.wd {
		font-family: var(--serif);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-weight: 650;
		font-size: 1.15rem;
	}
	.blank .wd {
		font-size: 1rem;
	}
	.dlabel .muted {
		font-size: 0.85rem;
	}
	.free {
		font-size: 0.9rem;
	}
	.devs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.devs li {
		display: flex;
		flex-direction: column;
	}
	.dtime {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--accent-ink);
	}
	.devs .title {
		font-size: 1rem;
	}
</style>
