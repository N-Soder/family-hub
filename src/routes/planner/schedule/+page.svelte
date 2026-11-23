<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import GlyphPicker from '$lib/components/GlyphPicker.svelte';
	import WeekPattern from '$lib/components/WeekPattern.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const typeOf = (id: number) => data.dayTypes.find((d) => d.id === id);
	const toneOf = (id: number) => `tone-${(data.dayTypes.findIndex((d) => d.id === id) + 1) % 5}`;
	const kid = $derived(data.children[0]?.member.name ?? 'Ari');
</script>

<h1>Schedule</h1>
<p class="lede">
	Day types change what is in a routine: a daycare morning adds “Pack bag”, a home morning does not.
</p>
<ol class="how">
	<li><strong>Set the week</strong> for each child below.</li>
	<li><strong>Tag the steps</strong> that only happen on some days: open a routine and tap a step.</li>
	<li><strong>Plans changed?</strong> Pick a different day type on <a href="/planner/routines">Routines</a>.</li>
	{#if data.calendar.connected}
		<li><strong>Or let the calendar say:</strong> an event named after a day type (“Daycare”, “{kid}: Home”) sets that day. <a href="#calendar">Details ↓</a></li>
	{/if}
</ol>

{#if form?.saved}<p role="status" class="muted">{form.saved}</p>{/if}
{#if form?.errors}<p class="error" role="alert">{Object.values(form.errors)[0]}</p>{/if}

{#each data.children as c (c.member.id)}
	<section class="card">
		<h2 class="who"><Glyph name={c.member.icon} size={24} /> {c.member.name}’s week</h2>
		<WeekPattern memberId={c.member.id} dayTypes={data.dayTypes} pattern={c.pattern} todayWeekday={data.todayWeekday} />

		{#if data.calendar.connected}
			{@const mine = data.calendar.days.filter((d) => d.memberId === c.member.id)}
			<h3>From the calendar</h3>
			{#if mine.length}
				<ul class="caldays">
					{#each mine as d (d.date)}
						{@const t = typeOf(d.dayTypeId)}
						<li class:hidden={d.hidden} class:today={d.date === data.calendar.today}>
							<span class="when">{d.date === data.calendar.today ? 'Today' : d.label}</span>
							{#if t}<span class="pill {toneOf(d.dayTypeId)}"><Glyph name={t.glyph} size={14} /> {t.name}</span>{/if}
							<span class="muted src">“{d.title}” · {d.feed}{#if d.hidden} · changed by hand on Routines{/if}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Nothing in the next two weeks. Name a calendar event after a day type and it shows here.</p>
			{/if}
		{/if}

		<h3>What changes by day</h3>
		{#each c.routines.filter((r) => r.filtered.length) as r (r.template.id)}
			<div class="routine">
				<a href={`/planner/routines/${r.template.id}`}><strong>{r.template.name}</strong> <span class="muted">Edit →</span></a>
				<ul>
					{#each r.filtered as s (s.id)}
						<li>
							<Glyph name={s.icon} size={20} />
							<span class="title">{s.title}</span>
							<span class="tags">
								{#each s.dayTypeIds as id (id)}
									{@const t = typeOf(id)}
									{#if t}<span class="pill {toneOf(id)}"><Glyph name={t.glyph} size={14} /> {t.name}</span>{/if}
								{/each}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<p class="muted">
				Every step shows every day.
				{#if c.routines.length}Open
					{#each c.routines as r, i (r.template.id)}{i ? ' or ' : ''}<a href={`/planner/routines/${r.template.id}`}>{r.template.name}</a>{/each}
					and tap a step to limit it to some days.
				{/if}
			</p>
		{/each}
	</section>
{:else}
	<p class="muted">No children yet. <a href="/planner/members">Add one</a>.</p>
{/each}

{#if data.calendar.connected}
	<h2 id="calendar">Calendar days</h2>
	<div class="card">
		<p>
			The wall’s calendar can set day types. Every few minutes Family Hub reads the same feeds as the wall and looks for events
			whose title is a day type’s name:
		</p>
		<ul class="rules">
			<li><strong>“Daycare”</strong> or <strong>“Daycare day”</strong> — that day for every child.</li>
			<li><strong>“{kid}: Home”</strong>, <strong>“{kid} Home”</strong> or <strong>“{kid}’s Home”</strong> — that day for {kid} only. A calendar named after a child works the same way.</li>
			<li>An all-day event that spans a week covers every day of it. Anything else in the calendar is ignored.</li>
		</ul>
		<p class="muted">
			A pick on <a href="/planner/routines">Routines</a> still wins for that day; tap it again to go back to the calendar. The week above
			fills in the days the calendar says nothing about.
		</p>
		{#if data.calendar.error}<p class="error" role="alert">Calendar: {data.calendar.error}</p>{/if}
	</div>
{/if}

<h2>Day types</h2>
<div class="card types">
	{#each data.dayTypes as dt (dt.id)}
		<details>
			<summary>
				<span class="chip {toneOf(dt.id)}"><Glyph name={dt.glyph} size={24} /></span>
				<strong>{dt.name}</strong>
				<span class="muted">{data.stepCounts[dt.id] ? `${data.stepCounts[dt.id]} tagged step${data.stepCounts[dt.id] === 1 ? '' : 's'}` : 'no tagged steps'}</span>
				<span class="edit muted">Edit</span>
			</summary>
			<form method="POST" action="?/save" use:enhance={keep()}>
				<input type="hidden" name="id" value={dt.id} />
				<label class="field">Name <input name="name" value={dt.name} required maxlength="60" /></label>
				<div class="field">Glyph <GlyphPicker name="glyph" value={dt.glyph} /></div>
				<button>Save</button>
			</form>
		</details>
	{/each}
	<details>
		<summary><strong>+ Add day type</strong></summary>
		<form method="POST" action="?/add" use:enhance={keep(['name'])}>
			<label class="field">Name <input name="name" required maxlength="60" placeholder="e.g. Grandma’s" /></label>
			<div class="field">Glyph <GlyphPicker name="glyph" value="home" /></div>
			<button>Add</button>
		</form>
	</details>
</div>

<style>
	.lede {
		margin: -0.4rem 0 0.6rem;
	}
	.how {
		margin: 0 0 1rem;
		padding-left: 1.3rem;
		color: var(--muted);
	}
	.how strong {
		color: var(--ink);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
	}
	h3 {
		font-size: 0.95rem;
		margin: 16px 0 6px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.routine a {
		color: inherit;
		text-decoration: none;
	}
	.routine ul {
		list-style: none;
		margin: 4px 0 10px;
		padding: 0;
	}
	.routine li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		flex-wrap: wrap;
	}
	.title {
		flex: 1;
		min-width: 8em;
	}
	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.caldays {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
	}
	.caldays li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		flex-wrap: wrap;
	}
	.caldays .when {
		min-width: 6.5em;
	}
	.caldays .today .when {
		font-weight: 600;
	}
	.caldays .hidden {
		opacity: 0.55;
	}
	.caldays .src {
		font-size: 0.85rem;
	}
	.rules {
		margin: 0 0 8px;
		padding-left: 1.3rem;
	}
	.rules li {
		margin: 4px 0;
	}
	.types details {
		border-top: 1px solid var(--line);
		padding: 10px 0;
	}
	.types details:first-child {
		border-top: none;
		padding-top: 0;
	}
	.types details:last-child {
		padding-bottom: 0;
	}
	summary {
		cursor: pointer;
		display: flex;
		gap: 10px;
		align-items: center;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.edit {
		margin-left: auto;
		font-size: 0.85rem;
	}
	details[open] .edit {
		visibility: hidden;
	}
	form {
		margin-top: 12px;
	}
</style>
