<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import MemberFields from '$lib/components/MemberFields.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<h1>Members</h1>
<div class="card">
	{#each data.members as m (m.id)}
		<a class="member" href={`/planner/members/${m.id}`}>
			<Glyph name={m.icon} size={28} />
			<strong>{m.name}</strong>
			<span class="muted">{m.shortLabel} · {m.kind} · {m.displayMode}{m.active ? '' : ' · inactive'}</span>
		</a>
	{/each}
</div>
<p class="muted">With one child the wall shows that child’s routine directly. The first active child (by order) is the wall’s home page.</p>

<details class="card" open={Boolean(form?.errors)}>
	<summary><strong>Add member</strong></summary>
	<form method="POST" action="?/add" use:enhance={keep(['name', 'shortLabel', 'id'])}>
		<MemberFields errors={form?.errors ?? {}} />
		<button>Add member</button>
	</form>
</details>
{#if form?.added}<p role="status">Added {form.added}.</p>{/if}

<style>
	.member {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		color: inherit;
		text-decoration: none;
		border-top: 1px solid var(--line);
	}
	.member:first-child {
		border-top: none;
	}
	summary {
		cursor: pointer;
		margin-bottom: 10px;
	}
</style>
