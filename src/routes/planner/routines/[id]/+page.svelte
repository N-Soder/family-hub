<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import StepFields from '$lib/components/StepFields.svelte';
	import TemplateFields from '$lib/components/TemplateFields.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const idsOf = (json: string | null): number[] | null => (json ? (JSON.parse(json) as number[]) : null);
	const typeOf = (id: number) => data.dayTypes.find((d) => d.id === id);
	const toneOf = (id: number) => `tone-${(data.dayTypes.findIndex((d) => d.id === id) + 1) % 5}`;
	// Preview: which steps a given day type would get (null = show all steps).
	let preview = $state<number | null>(null);
	const shows = (json: string | null) => {
		const ids = idsOf(json);
		return preview === null || ids === null || ids.includes(preview);
	};
	const previewCount = $derived(data.steps.filter((s) => s.active && shows(s.dayTypeIdsJson)).length);
	const isPlan = $derived(data.template.kind === 'plan');
	const titleOf = (id: number | null) => data.steps.find((s) => s.id === id)?.title;
	const indexOf = (id: number | null) => data.steps.findIndex((s) => s.id === id);
	const fmtMin = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);
	/** A plan step's rule, as the phone shows it. */
	const whenLabel = (s: (typeof data.steps)[number], i: number) => {
		if (s.dueAfterStepId !== null) {
			const t = titleOf(s.dueAfterStepId);
			if (!t) return 'after a deleted step';
			const n = `${indexOf(s.dueAfterStepId) + 1}. ${t}`;
			const label = s.dueAfterMin ? `${fmtMin(s.dueAfterMin)} after ${n}` : `as soon as ${n}`;
			return indexOf(s.dueAfterStepId) > i ? `${label} ⚠ comes later` : label;
		}
		return s.dueAt ? `at ${s.dueAt}` : 'no time';
	};
	const timerLabel = (s: (typeof data.steps)[number]) => (s.timer ? ` · ⏱ ${s.usualMin ? `usually ${fmtMin(s.usualMin)}` : 'timer'}` : '');
</script>

<p><a href={`/planner/members/${data.member.id}`}>← {data.member.name}</a></p>
<h1>{data.template.name}</h1>
{#if form?.saved}<p role="status" class="muted">{form.saved}</p>{/if}

{#if isPlan}
<details class="card" open={Boolean(form?.errors)}>
	<summary><strong>Plan settings</strong> <span class="muted">{data.template.active ? 'in use' : 'not in use'}</span></summary>
	<form method="POST" action="?/save" use:enhance={keep()}>
		<label class="field">Name <input name="name" value={data.template.name} required maxlength="60" /></label>
		{#if form?.errors?.name}<p class="error">{form.errors.name}</p>{/if}
		<label class="field"><input type="checkbox" name="active" checked={data.template.active} /> In use (switches {data.member.name}’s other plans off)</label>
		<button>Save plan</button>
	</form>
</details>
{:else}
<details class="card" open={Boolean(form?.errors)}>
	<summary><strong>Routine settings</strong> <span class="muted">{data.template.windowStart}–{data.template.windowEnd}</span></summary>
	<form method="POST" action="?/save" use:enhance={keep()}>
		<TemplateFields t={data.template} errors={form?.errors ?? {}} />
		<button>Save routine</button>
	</form>
</details>
{/if}

<h2>Steps</h2>
{#if isPlan}
<p class="muted">Steps run top to bottom. Each one is at a time, or a gap after an earlier step (“3 h after Woke up”). Times follow the ticks made on the Routines tab; the wall shows the plan behind the {data.member.name} button and can’t tick it.</p>
{:else if data.dayTypes.length}
	<div class="preview">
		<span class="muted">Preview a day</span>
		<div class="choices">
			<button type="button" class="choice" aria-pressed={preview === null} onclick={() => (preview = null)}>All steps</button>
			{#each data.dayTypes as dt, ti (dt.id)}
				<button type="button" class="choice tone-{(ti + 1) % 5}" aria-pressed={preview === dt.id} onclick={() => (preview = dt.id)}><Glyph name={dt.glyph} size={18} /> {dt.name}</button>
			{/each}
		</div>
		{#if preview !== null}<p class="muted">{previewCount} step{previewCount === 1 ? '' : 's'} on a {typeOf(preview)?.name} day. Greyed steps are skipped.</p>{/if}
	</div>
{/if}
{#if !isPlan}<p class="muted">The wall shows {data.member.displayMode === 'picture' ? 6 : 8} steps for {data.member.name}; extra steps are listed as “more in the Planner”.</p>{/if}
{#if form?.stepErrors}<p class="error" role="alert">{Object.values(form.stepErrors)[0]}</p>{/if}
{#each data.steps as s, i (s.id)}
	<details class="card step" class:inactive={!s.active} class:skipped={!shows(s.dayTypeIdsJson)}>
		<summary>
			<span class="n">{i + 1}</span>
			<Glyph name={s.icon} size={26} />
			<strong>{s.title}</strong>
			<span class="tags">
				{#if isPlan}
				<span class="muted every">{whenLabel(s, i)}{timerLabel(s)}</span>
				{:else}
				{#each idsOf(s.dayTypeIdsJson) ?? [] as id (id)}
					{@const t = typeOf(id)}
					{#if t}<span class="pill {toneOf(id)}"><Glyph name={t.glyph} size={14} /> {t.name}</span>{/if}
				{:else}
					<span class="muted every">Every day</span>
				{/each}
				{/if}
				{#if !s.active}<span class="pill">inactive</span>{/if}
			</span>
		</summary>
		<form method="POST" action="?/saveStep" use:enhance={keep()}>
			<input type="hidden" name="stepId" value={s.id} />
			<StepFields step={s} dayTypes={data.dayTypes} plan={isPlan} earlier={data.steps.slice(0, i).map((e, n) => ({ id: e.id, title: `${n + 1}. ${e.title}` }))} />
			<div class="row">
				<button>Save step</button>
				<button class="ghost" formaction="?/up" disabled={i === 0}>Move up</button>
				<button class="ghost" formaction="?/down" disabled={i === data.steps.length - 1}>Move down</button>
				<button
					class="ghost danger"
					formaction="?/delete"
					formnovalidate
					onclick={(e) => {
						if (!confirm(`Delete “${s.title}”?`)) e.preventDefault();
					}}>Delete</button>
			</div>
		</form>
	</details>
{/each}

<details class="card" open={data.steps.length === 0}>
	<summary><strong>Add step</strong></summary>
	<form method="POST" action="?/addStep" use:enhance={keep(['title'])}>
		<StepFields dayTypes={data.dayTypes} plan={isPlan} earlier={data.steps.map((e, n) => ({ id: e.id, title: `${n + 1}. ${e.title}` }))} />
		<button>Add step</button>
	</form>
</details>

<style>
	summary {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.step form {
		margin-top: 12px;
	}
	.n {
		width: 1.6em;
		color: var(--muted);
	}
	.inactive,
	.skipped:not([open]) {
		opacity: 0.45;
	}
	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-left: auto;
	}
	.every {
		font-size: 0.85rem;
	}
	.preview {
		margin-bottom: 12px;
	}
	.preview > span {
		display: block;
		font-size: 0.85rem;
		margin-bottom: 4px;
	}
	.preview p {
		margin: 6px 0 0;
		font-size: 0.9rem;
	}
	.danger {
		margin-left: auto;
		color: var(--warn);
	}
</style>
