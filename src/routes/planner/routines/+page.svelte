<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import PlanCard from '$lib/components/PlanCard.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	// One person at a time; each phone remembers who was picked last.
	const PICK_KEY = 'fh-routines-member';
	let picked = $state<number | null>(null);
	const current = $derived(data.board.find((b) => b.member.id === picked)?.member.id ?? data.board[0]?.member.id ?? null);
	function pick(id: number) {
		picked = id;
		try {
			localStorage.setItem(PICK_KEY, String(id));
		} catch {
			/* private mode: just not remembered */
		}
	}

	// Live: wall taps and other Planner sessions refresh this board.
	onMount(() => {
		try {
			const saved = Number(localStorage.getItem(PICK_KEY));
			if (saved) picked = saved;
		} catch {
			/* no storage: first member */
		}
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		return () => es.close();
	});
	const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : '');
	/** "18:30" → "6:30", with "pm" on the end time only: "6:30 – 9:00 pm". */
	const clock = (t: string) => {
		const [h, m] = t.split(':').map(Number);
		return { text: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, pm: h >= 12 };
	};
	const span = (a: string, b: string) => {
		const [x, y] = [clock(a), clock(b)];
		const ap = (pm: boolean) => (pm ? 'pm' : 'am');
		return x.pm === y.pm ? `${x.text} – ${y.text} ${ap(y.pm)}` : `${x.text} ${ap(x.pm)} – ${y.text} ${ap(y.pm)}`;
	};
	type Board = (typeof data.board)[number];
	/** The routine on the wall now, else every routine today. */
	const progress = (b: Board) => {
		if (b.plan) return { done: b.plan.rows.filter((r) => r.done).length, total: b.plan.rows.length };
		const rs = b.routines.some((r) => r.running) ? b.routines.filter((r) => r.running) : b.routines;
		const steps = rs.flatMap((r) => r.steps);
		return { done: steps.filter((s) => s.completedAt).length, total: steps.length };
	};
	const RING = 2 * Math.PI * 24;
	// First child marigold, then teal, plum, sky, tomato.
	const MEMBER_TONES = [2, 1, 3, 4, 0];
</script>

<div class="eyebrow">{data.dateLabel}</div>
<div class="spread"><h1>Routines</h1><a class="button ghost kidlink" href="/planner/kids"><Glyph name="star" size={18} />Kid view</a></div>
{#if form?.notice}<p class="muted" role="status">{form.notice}</p>{/if}
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#if data.board.length > 1}
	<div class="who-pick" role="tablist" aria-label="Whose routines">
		{#each data.board as b, mi (b.member.id)}
			{@const p = progress(b)}
			<button role="tab" class="pick tone-{MEMBER_TONES[mi % 5]}" aria-selected={current === b.member.id} onclick={() => pick(b.member.id)}>
				<span class="mini"><Glyph name={b.member.icon} size={20} /></span>
				{b.member.name}
				{#if p.total}<span class="count">{p.done}/{p.total}</span>{/if}
			</button>
		{/each}
	</div>
{/if}

{#each data.board as b, mi (b.member.id)}
	{@const p = progress(b)}
	{#if b.member.id === current}
	<section class="member" role="tabpanel">
		<div class="card who tone-{MEMBER_TONES[mi % 5]}">
			<span class="avatar"><Glyph name={b.member.icon} size={32} /></span>
			<div class="name">
				<h2>{b.member.name}</h2>
				{#if b.member.kind === 'baby'}
					{#if b.plan}<span class="muted">{b.plan.template.name}</span>{/if}
				{:else if b.dayType}<span class="pill day"><Glyph name={b.dayType.glyph} size={16} />{b.dayType.name} day</span>{/if}
			</div>
			{#if p.total}
				<div class="ring" role="img" aria-label={`${p.done} of ${p.total} steps done`}>
					<svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true"
						><circle cx="29" cy="29" r="24" class="track" /><circle
							cx="29"
							cy="29"
							r="24"
							class="fill"
							stroke-dasharray={`${(RING * p.done) / p.total} ${RING}`}
							transform="rotate(-90 29 29)"
						/></svg
					>
					<span>{p.done}/{p.total}</span>
				</div>
			{/if}
		</div>

		{#if b.member.kind === 'baby'}
			{#if b.plan}
				<PlanCard plan={b.plan} {form} />
			{:else}
				<p class="muted">No day plan yet. <a href={`/planner/members/${b.member.id}`}>Add one</a>.</p>
			{/if}
		{:else}
		<form method="POST" action="?/override" use:enhance={keep()} class="setup today">
			<input type="hidden" name="memberId" value={b.member.id} />
			<span class="label">Today is</span>
			<div class="choices">
				{#each data.dayTypes as dt, ti (dt.id)}
					{@const on = b.dayType?.id === dt.id}
					{@const usual = b.usualDayTypeId === dt.id}
					<!-- Tapping the usual type, or the current pick, goes back to the calendar or the weekly pattern. -->
					<button class="choice tone-{(ti + 1) % 5}" name="dayTypeId" value={on || usual ? '' : dt.id} aria-pressed={on}>
						<Glyph name={dt.glyph} size={18} />
						{dt.name}
						{#if usual}<span class="note">{b.calendarDay ? 'calendar' : 'usual'}</span>{/if}
					</button>
				{/each}
			</div>
			{#if b.override}
				<p class="muted changed">Changed for today only. Tomorrow follows <a href="/planner/schedule">the week</a> again.</p>
			{:else if b.calendarDay}
				<p class="muted changed">Set by the calendar (“{b.calendarDay.title}”).</p>
			{/if}
		</form>

		{#each b.routines as r (r.occurrence.id)}
			<div class="rhead">
				<h3>{r.template.name}</h3>
				<span class="muted">{span(r.template.windowStart, r.template.windowEnd)}</span>
				{#if r.running}<span class="pill live tone-1"><span class="dot"></span>On the wall now</span>{/if}
			</div>
			<ul class="card steps">
				{#each r.steps as s, si (s.id)}
					<li class:done={s.completedAt}>
						<form method="POST" action="?/toggle" use:enhance={keep()}>
							<input type="hidden" name="stepId" value={s.id} />
							<input type="hidden" name="done" value={s.completedAt ? '0' : '1'} />
							<button class="tick" aria-pressed={Boolean(s.completedAt)} aria-label={`${s.completedAt ? 'Untick' : 'Tick'} ${s.titleSnapshot}`} data-step={s.titleSnapshot}>
								{#if s.completedAt}<Glyph name="check" size={18} />{/if}
							</button>
						</form>
						<span class="chip tone-{si % 5}"><Glyph name={s.iconSnapshot} size={26} /></span>
						<span class="title">
							<span class="t">{s.titleSnapshot}</span>
							{#if s.completedAt}<span class="muted when">{fmt(s.completedAt)} · {s.completedBy}</span>{/if}
						</span>
					</li>
				{:else}
					<li class="muted quiet">No steps today.</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No routines today.</p>
		{/each}
		{/if}
	</section>
	{/if}
{:else}
	<p class="muted">No members yet. <a href="/planner/members">Add one</a>.</p>
{/each}

<style>
	.kidlink {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--card);
		color: var(--ink);
		border-color: var(--line-strong);
		--glyph-bg: var(--sun);
		--glyph-bg-opacity: 0.8;
	}
	.who-pick {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		margin: 0 0 16px;
		padding-bottom: 2px;
	}
	.pick {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 6px 16px 6px 6px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
		font-weight: 600;
		font-size: 1rem;
	}
	.pick[aria-selected='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--card);
	}
	.mini {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--tone);
		color: var(--card);
		--glyph-bg: var(--card);
		--glyph-bg-opacity: 0.45;
	}
	.count {
		font-size: 0.85rem;
		font-weight: 500;
		opacity: 0.75;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 0;
	}
	.avatar {
		flex: none;
		width: 58px;
		height: 58px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--tone);
		color: var(--card);
		--glyph-bg: var(--card);
		--glyph-bg-opacity: 0.45;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.name h2 {
		margin: 0 0 4px;
		font-size: 1.6rem;
		line-height: 1.1;
	}
	.day {
		--glyph-bg: var(--tone);
		font-size: 0.85rem;
	}
	.ring {
		position: relative;
		flex: none;
		width: 58px;
		height: 58px;
	}
	.ring svg circle {
		fill: none;
		stroke-width: 7;
	}
	.ring .track {
		stroke: var(--line);
	}
	.ring .fill {
		stroke: var(--accent);
		stroke-linecap: round;
		transition: stroke-dasharray 0.3s ease;
	}
	.ring span {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 0.95rem;
	}
	.today {
		margin: 14px 4px 0;
	}
	.today .label {
		display: block;
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--muted);
		margin-bottom: 6px;
	}
	.changed {
		font-size: 0.85rem;
		margin: 6px 0 0;
	}
	.rhead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		margin: 24px 4px 10px;
	}
	.rhead h3 {
		margin: 0;
		font-family: var(--serif);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-weight: 650;
		font-size: 1.45rem;
	}
	.live {
		margin-left: auto;
		align-self: center;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--tone);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 4px 14px;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
	}
	.steps li + li {
		border-top: 1px solid var(--line);
	}
	.steps form {
		margin: 0;
	}
	.tick {
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 50%;
		border: 2.5px solid var(--ink);
		background: var(--card);
		color: var(--on-accent);
		display: grid;
		place-items: center;
		transition: background 0.15s, border-color 0.15s;
	}
	li.done .tick {
		background: var(--accent);
		border-color: var(--accent);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.t {
		font-size: 1.08rem;
		font-weight: 600;
	}
	li.done .t {
		font-weight: 500;
		color: var(--muted);
		text-decoration: line-through;
		text-decoration-color: var(--accent);
		text-decoration-thickness: 2px;
	}
	.when {
		font-size: 0.82rem;
	}
	.quiet {
		padding: 14px 0;
	}
</style>
