<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	// The quick add remembers who the last idea was for, so several can go in a row.
	let personId = $state('');
	let adding = $state(false); // the + Person form
	const summary = (p: (typeof data.people)[number]) =>
		[`${p.ideas} idea${p.ideas === 1 ? '' : 's'}`, p.bought ? `${p.bought} bought` : '', p.birthdayLabel ? `Birthday ${p.birthdayLabel}` : ''].filter(Boolean).join(' · ');

	onMount(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		return () => es.close();
	});
</script>

<div class="head">
	<h1>Gifts</h1>
	<button class="plain" onclick={() => (adding = !adding)} aria-expanded={adding}><Glyph name="plus" size={22} /> Person</button>
</div>

{#if adding || form?.personErrors || !data.people.length}
	<form class="card" method="POST" action="?/addPerson" use:enhance>
		<label class="field"
			>{data.people.length ? 'Add a person' : 'Who do you buy for? Add the first person.'}
			<input name="name" placeholder="e.g. Mum" maxlength="60" autocomplete="off" required />
		</label>
		{#if form?.personErrors?.name}<p class="error">{form.personErrors.name}</p>{/if}
		<button>Add</button>
	</form>
{/if}

{#if data.people.length}
	<form class="card quick" method="POST" action="?/addIdea" use:enhance={keep(['title'])}>
		<div class="row">
			<select name="personId" bind:value={personId} aria-label="For" required>
				<option value="" disabled>For…</option>
				{#each data.people as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
			</select>
			<input class="grow" name="title" placeholder="Gift idea" aria-label="Gift idea" maxlength="80" autocomplete="off" autocapitalize="sentences" required />
			<button class="plain add" aria-label="Add idea"><Glyph name="plus" size={24} /></button>
		</div>
		{#if form?.ideaErrors}<p class="error">{Object.values(form.ideaErrors)[0]}</p>{/if}
	</form>
{/if}
{#if form?.notice}<p class="muted" role="status">{form.notice}</p>{/if}
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

{#each data.occasions as o (o.occasion)}
	<div class="card occasion spread">
		<div>
			<strong>{o.occasion}</strong>
			<div class="muted">{o.bought} bought for {o.people} {o.people === 1 ? 'person' : 'people'}</div>
		</div>
		<form method="POST" action="?/given" use:enhance={keep()}>
			<input type="hidden" name="occasion" value={o.occasion} />
			<button class="plain">Mark all given</button>
		</form>
	</div>
{/each}

{#if data.people.length}
	<ul class="people card">
		{#each data.people as p, i (p.id)}
			<li>
				<a href={`/planner/gifts/${p.id}`} class="tone-{i % 5}">
					<span class="initial">{p.name.slice(0, 1).toUpperCase()}</span>
					<span class="who">
						<strong>{p.name}</strong>
						<span class="muted">
							{summary(p)}
						</span>
					</span>
					<span class="go"><Glyph name="back" size={18} /></span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.head {
		margin-bottom: 14px;
	}
	.head h1 {
		margin: 0;
	}
	.go {
		display: grid;
		transform: rotate(180deg);
		color: var(--line-strong);
		--glyph-bg-opacity: 0;
	}
	/* Plain text actions in accent, no pill (ADR-39, docs/design.md). */
	.plain {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
		padding: 0 4px;
		background: none;
		border: none;
		color: var(--accent-ink);
		--glyph-bg-opacity: 0;
	}
	.head .plain {
		margin-right: -4px;
	}
	/* Quick add: one quiet row in a card, fields without boxes. 17px so iOS does not zoom. */
	.quick {
		padding: 4px 6px 4px 16px;
	}
	.quick .row {
		flex-wrap: nowrap;
		gap: 0;
		margin: 0;
	}
	.quick select,
	.quick .grow {
		min-width: 0;
		font: inherit;
		font-size: 17px;
		padding: 12px 10px 12px 0;
		border: none;
		background: none;
		color: var(--ink);
	}
	.quick select {
		flex: 0 1 34%;
		margin-right: 12px;
		border-right: 1px solid var(--line);
	}
	.quick .grow {
		flex: 1 1 auto;
	}
	.quick .grow::placeholder {
		color: var(--muted);
		opacity: 1;
	}
	.quick .add {
		flex: none;
		width: 44px;
		justify-content: center;
		padding: 0;
	}
	.occasion {
		align-items: center;
		gap: 12px;
	}
	.occasion form {
		margin: 0;
	}
	.people {
		list-style: none;
		padding: 0;
		overflow: hidden;
	}
	.people li + li {
		border-top: 1px solid var(--line);
	}
	.people a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		color: var(--ink);
		text-decoration: none;
	}
	.initial {
		flex: none;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--tone-soft);
		color: var(--tone-ink);
		font-weight: 700;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.who .muted {
		font-size: 0.9rem;
	}
</style>
