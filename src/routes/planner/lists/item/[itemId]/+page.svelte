<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	const item = $derived(data.item);
	// The repeat fields show only when it repeats; the lead hint follows the chosen interval.
	let repeat = $state<'none' | 'after' | 'fixed'>('none');
	let every = $state(1);
	let unit = $state<'day' | 'week' | 'month' | 'year'>('month');
	// Without a repeat: no date, Now (pick up soon, no date) or by a date.
	let when = $state<'none' | 'now' | 'date'>('none');
	let shownId: number | null = null;
	$effect(() => {
		if (item.id !== shownId) {
			shownId = item.id;
			repeat = item.repeatMode ?? 'none';
			every = item.repeatEvery ?? 1;
			unit = item.repeatUnit ?? 'month';
			when = item.dueDate ? 'date' : item.nowSince ? 'now' : 'none';
		}
	});
	const DAYS = { day: 1, week: 7, month: 30.44, year: 365.25 };
	const autoLead = $derived(Math.min(30, Math.max(0, Math.round(every * DAYS[unit] * 0.1))));
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const doneErrors = $derived((form?.doneErrors ?? {}) as Record<string, string>);
	// Shopping items: name and notes only.
	const canPlan = $derived(data.list.kind !== 'grocery');
	// Links in the notes, shown as chips that open in a new tab (http and https only).
	let notes = $state('');
	$effect(() => {
		if (item.id === shownId) notes = item.notes ?? '';
	});
	const links = $derived(
		[...notes.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)]
			.map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''))
			.map((u) => (/^www\./i.test(u) ? `https://${u}` : u))
			.flatMap((u) => {
				try {
					const url = new URL(u);
					return url.protocol === 'http:' || url.protocol === 'https:' ? [{ href: url.href, label: url.hostname.replace(/^www\./, '') }] : [];
				} catch {
					return [];
				}
			})
	);
	/** Grow the notes box with its text (as it is typed, and when saved notes load). */
	let notesBox: HTMLTextAreaElement | undefined = $state();
	$effect(() => {
		void notes;
		const el = notesBox;
		if (!el) return;
		// After the value is in place (bind:value updates in its own effect).
		const id = requestAnimationFrame(() => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		});
		return () => cancelAnimationFrame(id);
	});
	const tone = (s: string | undefined) => (s === 'overdue' ? 'tone-0' : s === 'today' || s === 'soon' ? 'tone-2' : 'tone-1');
</script>

<BackLink href={`/planner/lists?list=${data.list.id}`} label={data.list.name} />
<!-- The circle marks it done, as on the list; a repeating one is done today. -->
<div class="head">
	{#if item.repeatEvery}
		<form method="POST" action="?/done" use:enhance={keep()}>
			<input type="hidden" name="itemId" value={item.id} />
			<input type="hidden" name="doneOn" value={data.today} />
			<button class="check" aria-label={`Done ${item.title} today`}><span class="box"></span></button>
		</form>
	{:else}
		<form method="POST" action="?/tick" use:enhance={keep()}>
			<input type="hidden" name="done" value={item.doneAt ? '0' : '1'} />
			<button class="check" class:on={item.doneAt} aria-pressed={Boolean(item.doneAt)} aria-label={item.doneAt ? `Put ${item.title} back on the list` : `Mark ${item.title} done`}
				><span class="box">{#if item.doneAt}<Glyph name="check" size={18} />{/if}</span></button
			>
		</form>
	{/if}
	<h1 class:done={item.doneAt}>{item.title}</h1>
</div>
{#if item.meta}
	<p class="status">
		<span class="pill {tone(item.meta.state)}">{item.meta.label}</span>
		{#if item.meta.repeat}<span class="muted">{item.meta.repeat}</span>{/if}
	</p>
{:else if item.nowSince}
	<p class="status"><span class="pill tone-0">Now</span></p>
{/if}
{#if data.isNew && item.repeatEvery}
	<p class="card hint">Check the due date. If you know when it was last done, use <strong>Done on…</strong> below and the next date is worked out from that.</p>
{/if}
{#if form?.notice}<p class="muted" role="status">{form.notice}</p>{/if}
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#if item.repeatEvery}
	<form class="card" method="POST" action="?/done" use:enhance={keep(['note'])}>
		<input type="hidden" name="itemId" value={item.id} />
		<div class="row">
			<label class="field grow">Done on <input type="date" name="doneOn" value={data.today} max={data.today} required /></label>
			<label class="field grow">Note <input name="note" placeholder="e.g. Ultra Tune, $389, 84,200 km" maxlength="200" /></label>
		</div>
		{#if doneErrors.doneOn}<p class="error">{doneErrors.doneOn}</p>{/if}
		{#if doneErrors.note}<p class="error">{doneErrors.note}</p>{/if}
		<div class="row">
			<button>Mark done</button>
			<button class="ghost" formaction="?/snooze" name="days" value="7" formnovalidate>Snooze a week</button>
			<button class="ghost" formaction="?/snooze" name="days" value="30" formnovalidate>Snooze a month</button>
			{#if item.repeatMode === 'fixed'}<button class="ghost" formaction="?/skip" formnovalidate>Skip this one</button>{/if}
		</div>
	</form>
{/if}

<form class="card" method="POST" action="?/save" use:enhance={keep()}>
	<input type="hidden" name="itemId" value={item.id} />
	<label class="field">Name <input name="title" value={item.title} maxlength="80" required /></label>
	{#if errors.title}<p class="error">{errors.title}</p>{/if}
	<label class="field"
		>Notes
		<textarea name="notes" rows="2" maxlength="2000" placeholder="Details, a link, a phone number…" bind:value={notes} bind:this={notesBox}></textarea>
	</label>
	{#if errors.notes}<p class="error">{errors.notes}</p>{/if}
	{#if links.length}
		<div class="weblinks">
			{#each links as l, i (i)}
				<a class="weblink" href={l.href} target="_blank" rel="noopener noreferrer"><Glyph name="link" size={16} /><span>{l.label}</span></a>
			{/each}
		</div>
	{/if}

	{#if canPlan}

	<label class="field"
		>Repeat
		<select name="repeat" bind:value={repeat}>
			<option value="none">Never</option>
			<option value="after">After it's done</option>
			<option value="fixed">On a fixed schedule</option>
		</select>
	</label>
	{#if repeat === 'none'}
		<input type="hidden" name="every" value="1" />
		<input type="hidden" name="unit" value="month" />
		<fieldset class="when">
			<legend>When</legend>
			<div class="choices">
				<label class="choice"><input type="radio" name="when" value="none" bind:group={when} />No date</label>
				<label class="choice tone-0"><input type="radio" name="when" value="now" bind:group={when} />Now</label>
				<label class="choice"><input type="radio" name="when" value="date" bind:group={when} />By a date</label>
			</div>
		</fieldset>
		<p class="muted small">
			{when === 'none' ? 'On the list, no rush.' : when === 'now' ? 'To pick up soon, with no set day. Goes to the top and into Coming up.' : 'Shows as due soon from a week before.'}
		</p>
		{#if when === 'date'}
			<label class="field">Due <input type="date" name="due" value={item.dueDate ?? ''} required /></label>
			{#if errors.due}<p class="error">{errors.due}</p>{/if}
		{/if}
	{:else}
		<label class="field">Next due <input type="date" name="due" value={item.dueDate ?? ''} /></label>
		{#if errors.due}<p class="error">{errors.due}</p>{/if}
		{#if !item.dueDate}<p class="muted small">Leave empty to count one interval from today.</p>{/if}
		<div class="row every">
			<span>Every</span>
			<input name="every" type="number" min="1" max="99" bind:value={every} aria-label="How many" required />
			<select name="unit" bind:value={unit} aria-label="Unit">
				<option value="day">{every === 1 ? 'day' : 'days'}</option>
				<option value="week">{every === 1 ? 'week' : 'weeks'}</option>
				<option value="month">{every === 1 ? 'month' : 'months'}</option>
				<option value="year">{every === 1 ? 'year' : 'years'}</option>
			</select>
		</div>
		{#if errors.every}<p class="error">{errors.every}</p>{/if}
		<p class="muted small">
			{repeat === 'after'
				? 'The next one is counted from the day it was done. Good for servicing and cleaning.'
				: 'Stays on the calendar even if it is done late. Good for bins, renewals and bills.'}
		</p>
	{/if}

	{#if repeat !== 'none' || when === 'date'}
	<label class="field"
		>Show it on the list
		<span class="row lead">
			<input name="lead" type="number" min="0" max="365" value={item.leadDays ?? ''} placeholder={String(repeat === 'none' ? 7 : autoLead)} aria-label="Days before it is due" />
			<span class="muted">days before it is due{item.leadDays === null ? ` (automatic: ${repeat === 'none' ? 7 : autoLead})` : ''}</span>
		</span>
	</label>
	{#if errors.lead}<p class="error">{errors.lead}</p>{/if}
	{/if}
	{#if repeat !== 'none'}<p class="muted small">Until then it waits under “Later”. Leave empty for automatic: a tenth of the interval, at most 30 days.</p>{/if}
	{/if}
	<button>Save</button>
</form>

{#if item.repeatEvery || data.log.length}
	<h2>History</h2>
	<div class="card">
		{#if data.stats?.count}
			<p class="muted small">Done {data.stats.count} time{data.stats.count === 1 ? '' : 's'}{data.stats.gap ? `, ${data.stats.gap}` : ''}.</p>
		{/if}
		{#each data.log as l (l.id)}
			<div class="log spread">
				<div>
					<strong>{l.kind === 'done' ? 'Done' : 'Skipped'} {l.when}</strong>
					<span class="muted">· {l.doneBy === 'wall' ? 'on the wall' : 'on a phone'}</span>
					{#if l.note}<div class="muted">{l.note}</div>{/if}
				</div>
				<form method="POST" action="?/removeLog" use:enhance={keep()}>
					<input type="hidden" name="logId" value={l.id} />
					<button class="link" aria-label={`Remove ${l.kind} ${l.when}`}>{l.id === data.latestLogId ? 'Undo' : 'Remove'}</button>
				</form>
			</div>
		{:else}
			<p class="muted">Not done yet.</p>
		{/each}
	</div>
{/if}

<details class="card">
	<summary>Delete item</summary>
	<form method="POST" action="?/remove">
		<button class="ghost danger">Delete “{item.title}”{data.log.length ? ' and its history' : ''}</button>
	</form>
</details>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: -8px;
	}
	.head h1 {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.head h1.done {
		text-decoration: line-through;
		text-decoration-color: var(--accent);
		color: var(--muted);
	}
	.head form {
		margin: 0;
	}
	.check {
		flex: none;
		width: 48px;
		height: 48px;
		padding: 0;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: 50%;
		color: var(--on-accent);
	}
	.check .box {
		width: 32px;
		height: 32px;
		box-sizing: border-box;
		border: 2.5px solid var(--ink);
		border-radius: 50%;
		display: grid;
		place-items: center;
	}
	.check.on .box {
		background: var(--accent);
		border-color: var(--accent);
	}
	.check:active .box {
		background: var(--line);
	}
	textarea {
		font: inherit;
		font-size: 17px;
		line-height: 1.4;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
		resize: none;
		overflow: hidden;
		min-height: 3.2em;
	}
	.weblinks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: -4px 0 14px;
	}
	.weblink {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		box-sizing: border-box;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--teal-soft);
		color: var(--teal-ink);
		font-weight: 600;
		font-size: 0.92rem;
		line-height: 1;
		text-decoration: none;
	}
	.weblink span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: -4px;
	}
	.when {
		border: 0;
		padding: 0;
		margin: 0 0 14px;
	}
	.when legend {
		font-weight: 600;
		margin-bottom: 6px;
	}
	.hint {
		font-size: 0.95rem;
	}
	.grow {
		flex: 1 1 160px;
		margin-bottom: 8px;
	}
	.small {
		font-size: 0.9rem;
		margin: -6px 0 14px;
	}
	.every,
	.lead {
		margin-bottom: 14px;
	}
	.every input,
	.lead input {
		width: 5.5em;
		font: inherit;
		font-size: 17px;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.every select {
		padding: 10px 12px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
	}
	.lead {
		margin-top: 6px;
		font-weight: 400;
	}
	.log {
		padding: 10px 0;
	}
	.log + .log {
		border-top: 1px solid var(--line);
	}
	.log form {
		margin: 0;
	}
	.danger {
		color: var(--warn);
	}
	details summary {
		font-weight: 600;
	}
	details form {
		margin-top: 12px;
	}
</style>
