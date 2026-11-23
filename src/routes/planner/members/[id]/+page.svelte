<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import MemberFields from '$lib/components/MemberFields.svelte';
	import TemplateFields from '$lib/components/TemplateFields.svelte';
	import WeekPattern from '$lib/components/WeekPattern.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<p><a href="/planner/members">← Members</a></p>
<h1>{data.member.name}</h1>
{#if form?.saved}<p role="status" class="muted">{form.saved}</p>{/if}

<form method="POST" action="?/save" use:enhance={keep()} class="card">
	<MemberFields m={data.member} errors={form?.errors ?? {}} />
	<button>Save</button>
</form>

{#if data.member.kind === 'baby'}
<h2>Day plans</h2>
<div class="card">
	{#each data.templates as t (t.id)}
		<a class="tpl" href={`/planner/routines/${t.id}`}>
			<strong>{t.name}</strong>
			<span class="muted">{t.active ? 'in use' : 'not in use'}</span>
		</a>
	{:else}
		<p class="muted">No plan yet. Add one, then its steps: a time each (“at 7:00”) or a gap after an earlier step (“3 h after Woke up”).</p>
	{/each}
</div>
<p class="muted hint">The first plan in use shows on the wall behind the {data.member.name} button and on the Routines tab, where you tick it.</p>
<details class="card" open={Boolean(form?.templateErrors) || data.templates.length === 0}>
	<summary><strong>Add plan</strong></summary>
	<form method="POST" action="?/addPlan">
		<label class="field">Name <input name="name" placeholder="6–9 months" required maxlength="60" /></label>
		{#if form?.templateErrors?.name}<p class="error">{form.templateErrors.name}</p>{/if}
		<input type="hidden" name="active" value="on" />
		<button>Add plan</button>
	</form>
</details>
{:else}
<h2>Week</h2>
<div class="card">
	<WeekPattern memberId={data.member.id} dayTypes={data.dayTypes} pattern={data.pattern} todayWeekday={data.todayWeekday} />
	<p class="muted hint">Day types decide which steps show. <a href="/planner/schedule">See the whole schedule →</a></p>
</div>

<h2>Routines</h2>
<div class="card">
	{#each data.templates as t (t.id)}
		<a class="tpl" href={`/planner/routines/${t.id}`}>
			<strong>{t.name}</strong>
			<span class="muted">{t.windowStart}–{t.windowEnd}{t.active ? '' : ' · inactive'}</span>
		</a>
	{:else}
		<p class="muted">No routines yet.</p>
	{/each}
</div>
<details class="card" open={Boolean(form?.templateErrors)}>
	<summary><strong>Add routine</strong></summary>
	<form method="POST" action="?/addTemplate">
		<TemplateFields errors={form?.templateErrors ?? {}} />
		<button>Add routine</button>
	</form>
</details>
{/if}

<style>
	.hint {
		margin: 10px 0 0;
		font-size: 0.9rem;
	}
	.tpl {
		display: flex;
		justify-content: space-between;
		padding: 10px 0;
		border-top: 1px solid var(--line);
		color: inherit;
		text-decoration: none;
	}
	.tpl:first-child {
		border-top: none;
	}
	summary {
		cursor: pointer;
		margin-bottom: 10px;
	}
</style>
