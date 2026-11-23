<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	const idea = $derived(data.idea);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let status = $state<'idea' | 'bought' | 'given'>('idea');
	let notes = $state('');
	let shownId: number | null = null;
	$effect(() => {
		if (idea.id !== shownId) {
			shownId = idea.id;
			status = idea.status;
			notes = idea.notes ?? '';
		}
	});
	// Links in the notes as chips that open in a new tab (http and https only), as on list items.
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
</script>

<p><a href={`/planner/gifts/${data.person.id}`}>← {data.person.name}</a></p>
<h1>{idea.title}</h1>
{#if form?.notice}<p class="muted" role="status">{form.notice}</p>{/if}
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<form class="card" method="POST" action="?/save" use:enhance={keep()}>
	<fieldset class="status">
		<legend>Status</legend>
		<div class="choices">
			<label class="choice"><input type="radio" name="status" value="idea" bind:group={status} />Idea</label>
			<label class="choice"><input type="radio" name="status" value="bought" bind:group={status} />Bought</label>
			<label class="choice"><input type="radio" name="status" value="given" bind:group={status} />Given</label>
		</div>
	</fieldset>
	<label class="field">Name <input name="title" value={idea.title} maxlength="80" required /></label>
	{#if errors.title}<p class="error">{errors.title}</p>{/if}
	<label class="field"
		>Notes
		<textarea name="notes" rows="3" maxlength="2000" placeholder="Where to buy it, a link, size, colour…" bind:value={notes}></textarea>
	</label>
	{#if errors.notes}<p class="error">{errors.notes}</p>{/if}
	{#if links.length}
		<div class="weblinks">
			{#each links as l, i (i)}
				<a class="weblink" href={l.href} target="_blank" rel="noopener noreferrer"><Glyph name="link" size={16} /><span>{l.label}</span></a>
			{/each}
		</div>
	{/if}
	<div class="row two">
		<label class="field">Price <input name="price" inputmode="decimal" value={idea.price ?? ''} placeholder="$" maxlength="10" /></label>
		<label class="field">Occasion <input name="occasion" value={idea.occasion ?? ''} placeholder={data.suggested} maxlength="40" /></label>
	</div>
	{#if errors.price}<p class="error">{errors.price}</p>{/if}
	{#if errors.occasion}<p class="error">{errors.occasion}</p>{/if}
	<p class="muted small">Left empty, the occasion is filled in when it is bought: {data.suggested}.</p>
	<button>Save</button>
</form>

<details class="card">
	<summary>Delete idea</summary>
	<form method="POST" action="?/remove">
		<button class="ghost danger">Delete “{idea.title}”</button>
	</form>
</details>

<style>
	h1 {
		overflow-wrap: anywhere;
	}
	.status {
		border: 0;
		padding: 0;
		margin: 0 0 14px;
	}
	.status legend {
		font-weight: 600;
		margin-bottom: 6px;
	}
	textarea {
		font: inherit;
		font-size: 17px;
		line-height: 1.4;
		min-height: 4.4em;
	}
	.two {
		flex-wrap: nowrap;
		align-items: flex-start;
	}
	.two .field {
		flex: 1 1 0;
		min-width: 0;
	}
	.two .field:first-child {
		flex: 0 0 32%;
	}
	.small {
		font-size: 0.9rem;
		margin: -6px 0 14px;
	}
	.weblinks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: -4px 0 14px;
	}
	.weblink {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		height: 34px;
		box-sizing: border-box;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--teal-soft);
		color: var(--teal-ink);
		font-weight: 600;
		font-size: 0.92rem;
		text-decoration: none;
	}
	.weblink span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
