<script lang="ts">
	type T = { name: string; kind: string; windowStart: string; windowEnd: string; daysOfWeek: number; active: boolean };
	let { t = null, errors = {} }: { t?: T | null; errors?: Record<string, string> } = $props();
	const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const mask = $derived(t?.daysOfWeek ?? 127);
</script>

<label class="field">Name <input name="name" value={t?.name ?? ''} required maxlength="60" /></label>
{#if errors.name}<p class="error">{errors.name}</p>{/if}
<div class="row">
	<label class="field">Kind
		<select name="kind">
			{#each [['morning', 'Morning'], ['after_school', 'After school'], ['bedtime', 'Bedtime'], ['custom', 'Custom']] as [v, l] (v)}
				<option value={v} selected={(t?.kind ?? 'morning') === v}>{l}</option>
			{/each}
		</select>
	</label>
	<label class="field">Starts <input type="time" name="windowStart" value={t?.windowStart ?? '06:30'} required /></label>
	<label class="field">Ends <input type="time" name="windowEnd" value={t?.windowEnd ?? '09:00'} required /></label>
</div>
{#if errors.windowStart || errors.windowEnd}<p class="error">{errors.windowStart ?? errors.windowEnd}</p>{/if}
<p class="muted small">An end before the start runs past midnight and counts for the day it starts.</p>
<fieldset class="days">
	<legend>Days</legend>
	{#each DAYS as d, i (d)}
		<label><input type="checkbox" name="days" value={i} checked={(mask & (1 << i)) !== 0} /> {d}</label>
	{/each}
</fieldset>
{#if errors.days}<p class="error">{errors.days}</p>{/if}
<label class="field"><input type="checkbox" name="active" checked={t?.active ?? true} /> Active</label>

<style>
	.days {
		border: none;
		padding: 0;
		margin: 0 0 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	legend {
		font-weight: 600;
		padding: 0;
		margin-bottom: 4px;
	}
	.small {
		font-size: 0.85rem;
		margin-top: -6px;
	}
</style>
