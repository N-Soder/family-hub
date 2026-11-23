<script lang="ts">
	import Glyph from './Glyph.svelte';
	import GlyphPicker from './GlyphPicker.svelte';
	type DT = { id: number; name: string; glyph: string };
	type Step = {
		title: string;
		icon: string | null;
		dayTypeIdsJson: string | null;
		active: boolean;
		dueAt?: string | null;
		dueAfterStepId?: number | null;
		dueAfterMin?: number | null;
		timer?: boolean;
		usualMin?: number | null;
	};
	// `plan`: a baby's plan step, which gets a "When" instead of day types; `earlier` are the
	// steps it can follow (the ones before it in the plan).
	let {
		step = null,
		dayTypes,
		plan = false,
		earlier = []
	}: { step?: Step | null; dayTypes: DT[]; plan?: boolean; earlier?: Array<{ id: number; title: string }> } = $props();
	const initialWhen = (): 'none' | 'at' | 'after' => (step?.dueAfterStepId ? 'after' : step?.dueAt ? 'at' : earlier.length ? 'after' : 'at');
	let when = $state(initialWhen());
	const initialTimer = () => (step?.timer ? 'on' : 'off');
	let timer = $state(initialTimer());
	const initial = (): number[] => (step?.dayTypeIdsJson ? (JSON.parse(step.dayTypeIdsJson) as number[]) : []);
	// No day types picked means "every day" (stored as null).
	let picked = $state<number[]>(initial());
	const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
	const summary = $derived(
		picked.length === 0
			? 'Shows every day.'
			: `Only on ${dayTypes
					.filter((d) => picked.includes(d.id))
					.map((d) => d.name)
					.join(' and ')} days.`
	);
</script>

<label class="field">Title <input name="title" value={step?.title ?? ''} required maxlength="60" /></label>
<div class="field">Glyph <GlyphPicker name="icon" value={step?.icon ?? 'star'} /></div>
{#if plan}
<fieldset>
	<legend>When</legend>
	<div class="choices">
		<label class="choice"><input type="radio" name="when" value="at" bind:group={when} /> At a time</label>
		<label class="choice"><input type="radio" name="when" value="after" bind:group={when} disabled={!earlier.length} /> After a step</label>
		<label class="choice"><input type="radio" name="when" value="none" bind:group={when} /> No time</label>
	</div>
	{#if when === 'at'}
		<label class="field inline">At <input type="time" name="dueAt" value={step?.dueAt ?? '07:00'} required /></label>
	{:else if when === 'after'}
		<!-- One line that reads as a sentence: [60] min after [1. Milk ▾]. -->
		<div class="after">
			<input type="number" name="dueAfterMin" min="0" max="720" step="5" value={step?.dueAfterMin ?? 60} required aria-label="Minutes after" />
			<span>min after</span>
			<select name="dueAfterStepId" required aria-label="Step it follows">
				{#each earlier as e (e.id)}
					<option value={e.id} selected={step?.dueAfterStepId === e.id}>{e.title}</option>
				{/each}
			</select>
		</div>
		<p class="muted hint">Its time moves when that step is ticked. 0 min = as soon as it’s ticked (“milk when she wakes”). For a step whose length varies, like waking from a nap, pick “No time” and tick it when it happens.</p>
	{:else}
		<p class="muted hint">No guess: tick it when it happens. Steps after it show “after …” until then.</p>
	{/if}
</fieldset>
<fieldset>
	<legend>Timer</legend>
	<div class="choices">
		<label class="choice"><input type="radio" name="timer" value="off" bind:group={timer} /> Off · a tick</label>
		<label class="choice"><input type="radio" name="timer" value="on" bind:group={timer} /> Start → stop</label>
	</div>
	{#if timer === 'on'}
		<div class="after">
			<span>Usually lasts</span>
			<input type="number" name="usualMin" min="1" max="720" step="5" value={step?.usualMin ?? ''} placeholder="60" aria-label="Usually lasts, minutes" />
			<span>min</span>
		</div>
		<p class="muted hint">For a nap: start it when she goes down, stop it when she wakes. Steps “after” it count from the stop. “Usually lasts” gives a ~ guess for them while it runs; leave it empty for no guess.</p>
	{/if}
</fieldset>
{:else}
<fieldset>
	<legend>Shows on</legend>
	<div class="choices">
		<button type="button" class="choice" aria-pressed={picked.length === 0} onclick={() => (picked = [])}>Every day</button>
		{#each dayTypes as dt, ti (dt.id)}
			<label class="choice tone-{(ti + 1) % 5}">
				<input type="checkbox" name="dayTypes" value={dt.id} checked={picked.includes(dt.id)} onchange={() => toggle(dt.id)} />
				<Glyph name={dt.glyph} size={18} />
				{dt.name}
			</label>
		{/each}
	</div>
	<p class="muted hint">{summary}</p>
</fieldset>
{/if}
<label class="field"><input type="checkbox" name="active" checked={step?.active ?? true} /> Active</label>

<style>
	fieldset {
		border: none;
		padding: 0;
		margin: 0 0 12px;
	}
	legend {
		font-weight: 600;
		padding: 0;
		margin-bottom: 6px;
	}
	.inline {
		margin-top: 10px;
		align-items: center;
	}
	.after {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 10px;
		margin-top: 10px;
		font-weight: 600;
	}
	.after input,
	.after select {
		font: inherit;
		font-weight: 400;
		font-size: 17px;
		padding: 11px 14px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.after input {
		width: 5.5em;
	}
	.after select {
		min-width: 0;
		max-width: 100%;
	}
	.hint {
		margin: 6px 0 0;
		font-size: 0.85rem;
	}
</style>
