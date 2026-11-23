<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	onMount(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('change', (e) => {
			if (JSON.parse(e.data).reason === 'note') invalidateAll();
		});
		return () => es.close();
	});
</script>

<div class="head">
	<h1>Notes</h1>
	<form method="POST" action="?/create">
		<button class="plain"><Glyph name="plus" size={22} /> New note</button>
	</form>
</div>

{#if data.notes.length}
	<ul class="notes card">
		{#each data.notes as n, i (n.id)}
			<li>
				<a href={`/planner/notes/${n.id}`} class="tone-{i % 5}">
					<Glyph name="note" size={24} />
					<span class="text">
						<strong class:untitled={!n.title}>{n.title || 'Untitled'}</strong>
						{#if n.preview}<span class="preview">{n.preview}</span>{/if}
						<span class="muted when">Edited {n.edited.toLowerCase()}</span>
					</span>
					<span class="go"><Glyph name="back" size={18} /></span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">No notes yet. Notes are shared with everyone who uses the Planner.</p>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 14px;
	}
	.head h1 {
		margin: 0;
	}
	.head form {
		margin: 0;
	}
	/* Plain text action in accent, no pill (ADR-39, docs/design.md). */
	.plain {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
		margin-right: -4px;
		padding: 0 4px;
		background: none;
		border: none;
		color: var(--accent-ink);
		--glyph-bg-opacity: 0;
	}
	.notes {
		list-style: none;
		padding: 0;
		overflow: hidden;
	}
	.notes li + li {
		border-top: 1px solid var(--line);
	}
	.notes a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		color: var(--ink);
		text-decoration: none;
	}
	/* Colour on the icon only. */
	.notes a > :global(.glyph) {
		color: var(--tone-ink);
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.35;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.text strong,
	.preview {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.untitled {
		color: var(--muted);
		font-weight: 600;
	}
	.preview {
		color: var(--ink);
		opacity: 0.8;
	}
	.when {
		font-size: 0.85rem;
	}
	.go {
		display: grid;
		transform: rotate(180deg);
		color: var(--line-strong);
		--glyph-bg-opacity: 0;
	}
</style>
