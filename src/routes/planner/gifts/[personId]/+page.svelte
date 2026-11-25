<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	const person = $derived(data.person);
	const personErrors = $derived((form?.personErrors ?? {}) as Record<string, string>);
	let menu = $state(false);
	let addInput: HTMLInputElement | undefined = $state();
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const bday = $derived(person.birthday ? person.birthday.split('-').map(Number) : [null, null]);

	// Show the change straight away; the server reply then moves the row.
	const flipping = new SvelteSet<number>();
	const flip =
		(id: number): SubmitFunction =>
		() => {
			flipping.add(id);
			navigator.vibrate?.(8);
			return async ({ update }) => {
				await update({ reset: false });
				flipping.delete(id);
			};
		};
	// Clear the box and keep the keyboard up for the next idea.
	const add: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success' && addInput) addInput.value = '';
			addInput?.focus();
		};
	const firstLine = (n: string | null) => n?.split('\n')[0] ?? '';
	const price = (p: number | null) => (p === null ? '' : `$${p.toLocaleString('en-AU')}`);

	onMount(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		return () => es.close();
	});
</script>

<BackLink href="/planner/gifts" label="Gifts" />
<div class="head">
	<div>
		<h1>{person.name}</h1>
		{#if person.birthdayLabel}<p class="muted sub">Birthday {person.birthdayLabel}</p>{/if}
	</div>
	<button class="ghost round" onclick={() => (menu = !menu)} aria-expanded={menu} aria-label="Person options"><Glyph name="more" size={22} /></button>
</div>
{#if person.notes && !menu}<p class="muted notes-line">{firstLine(person.notes)}</p>{/if}

{#if menu || form?.personErrors}
	<form class="card" method="POST" action="?/save" use:enhance={keep()}>
		<label class="field">Name <input name="name" value={person.name} maxlength="60" required /></label>
		{#if personErrors.name}<p class="error">{personErrors.name}</p>{/if}
		<div class="field">
			Birthday
			<div class="row bday">
				<select name="day" aria-label="Day" value={bday[0] ?? ''}>
					<option value="">Day</option>
					{#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}<option value={d}>{d}</option>{/each}
				</select>
				<select name="month" aria-label="Month" value={bday[1] ?? ''}>
					<option value="">Month</option>
					{#each MONTHS as m, i (m)}<option value={i + 1}>{m}</option>{/each}
				</select>
			</div>
		</div>
		{#if personErrors.day}<p class="error">{personErrors.day}</p>{/if}
		<label class="field">Notes <textarea name="notes" rows="3" maxlength="2000" placeholder="Sizes, likes, things they already have…">{person.notes ?? ''}</textarea></label>
		<button>Save</button>
	</form>
	<details class="card">
		<summary>Delete {person.name}</summary>
		<form method="POST" action="?/remove">
			<label class="row"><input type="checkbox" name="confirm" /> Delete {person.name} and every idea and gift recorded for them</label>
			{#if personErrors.confirm}<p class="error">{personErrors.confirm}</p>{/if}
			<button class="ghost danger">Delete</button>
		</form>
	</details>
{/if}

<form class="add" method="POST" action="?/addIdea" use:enhance={add}>
	<input bind:this={addInput} name="title" placeholder="Add an idea" aria-label="New idea" maxlength="80" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" required />
	<button aria-label="Add"><Glyph name="plus" size={20} /></button>
</form>
{#if form?.errors?.title}<p class="error">{form.errors.title}</p>{/if}
{#if form?.notice}<p class="muted" role="status">{form.notice}</p>{/if}
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#snippet details(i: (typeof data.ideas)[number])}
	<a class="open" href={`/planner/gifts/idea/${i.id}`}>
		<span class="title">{i.title}</span>
		{#if i.price !== null || i.notes || (i.status !== 'idea' && i.occasion)}
			<span class="meta muted">
				{#if i.status !== 'idea' && i.occasion}<span>{i.occasion}</span>{/if}
				{#if i.price !== null}<span>{price(i.price)}</span>{/if}
				{#if i.notes}<span class="note"><Glyph name={/(https?:\/\/|www\.)/i.test(i.notes) ? 'link' : 'note'} size={14} /> {firstLine(i.notes)}</span>{/if}
			</span>
		{/if}
	</a>
{/snippet}

<h2>Ideas</h2>
<ul class="items card">
	{#each data.ideas as i (i.id)}
		<li class:done={flipping.has(i.id)}>
			<form method="POST" action="?/status" use:enhance={flip(i.id)}>
				<input type="hidden" name="ideaId" value={i.id} />
				<input type="hidden" name="status" value="bought" />
				<button class="check" aria-label={`Mark ${i.title} bought`}><span class="box">{#if flipping.has(i.id)}<Glyph name="check" size={16} />{/if}</span></button>
			</form>
			{@render details(i)}
		</li>
	{:else}
		<li class="empty muted">No ideas yet. Add one when it comes up.</li>
	{/each}
</ul>

{#if data.bought.length}
	<h2>Bought</h2>
	<ul class="items card">
		{#each data.bought as i (i.id)}
			<!-- Keyed by -id: the same idea may still be settling from Ideas. -->
			<li class="done" class:undoing={flipping.has(-i.id)}>
				<form method="POST" action="?/status" use:enhance={flip(-i.id)}>
					<input type="hidden" name="ideaId" value={i.id} />
					<input type="hidden" name="status" value="idea" />
					<button class="check" aria-pressed="true" aria-label={`Put ${i.title} back to ideas`}><span class="box">{#if !flipping.has(-i.id)}<Glyph name="check" size={16} />{/if}</span></button>
				</form>
				{@render details(i)}
				<form method="POST" action="?/status" use:enhance={keep()}>
					<input type="hidden" name="ideaId" value={i.id} />
					<input type="hidden" name="status" value="given" />
					<button class="ghost given">Given</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

{#if data.given.length}
	<details class="history">
		<summary>Given ({data.given.reduce((n, g) => n + g.items.length, 0)})</summary>
		{#each data.given as g (g.occasion)}
			<h3>{g.occasion}</h3>
			<ul class="items card">
				{#each g.items as i (i.id)}
					<li>{@render details(i)}</li>
				{/each}
			</ul>
		{/each}
	</details>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.head h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.sub {
		margin: 2px 0 0;
	}
	.notes-line {
		margin: 6px 0 0;
	}
	.round {
		flex: none;
		width: 44px;
		height: 44px;
		padding: 0;
		display: grid;
		place-items: center;
		border-width: 1px;
		border-color: var(--line);
	}
	.bday {
		margin-top: 6px;
		flex-wrap: nowrap;
	}
	.bday select {
		flex: 1;
		font-size: 17px;
		font-weight: 400;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
	}
	textarea {
		font: inherit;
		font-size: 17px;
		line-height: 1.4;
	}
	.danger {
		color: var(--warn);
	}
	details.card summary {
		font-weight: 600;
	}
	details.card form {
		margin-top: 12px;
	}
	.add {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		gap: 8px;
		margin: 14px -16px 4px;
		padding: 8px 16px;
		background: var(--bg);
	}
	.add input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 17px;
		padding: 12px 18px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.add button {
		flex: none;
		width: 50px;
		height: 50px;
		padding: 0;
		display: grid;
		place-items: center;
	}
	h2 {
		margin: 18px 0 8px;
	}
	h3 {
		margin: 14px 4px 6px;
		font-size: 1rem;
		color: var(--muted);
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 2px 14px;
	}
	.items li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 56px;
	}
	.items li + li {
		border-top: 1px solid var(--line);
	}
	.items form {
		margin: 0;
		flex: none;
	}
	.items li > form:first-child {
		margin-left: -7px;
	}
	.check {
		width: 44px;
		height: 44px;
		padding: 0;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: 50%;
		-webkit-tap-highlight-color: transparent;
	}
	.box {
		width: 30px;
		height: 30px;
		box-sizing: border-box;
		border: 2.5px solid var(--ink);
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--on-accent);
		transition: background 0.12s, border-color 0.12s;
	}
	li.done .box {
		background: var(--accent);
		border-color: var(--accent);
	}
	li.done.undoing .box {
		background: transparent;
		border-color: var(--ink);
	}
	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 0;
		color: var(--ink);
		text-decoration: none;
	}
	.title {
		font-weight: 500;
		font-size: 1.08rem;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 0.85rem;
	}
	.note {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.given {
		padding: 6px 14px;
		font-size: 0.9rem;
	}
	.empty {
		padding: 14px 0;
	}
	.history {
		margin-top: 22px;
	}
	.history summary {
		cursor: pointer;
		color: var(--muted);
		font-weight: 600;
		padding: 6px 4px 4px;
	}
</style>
