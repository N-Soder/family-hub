<script lang="ts">
	import GlyphPicker from './GlyphPicker.svelte';
	type Values = { name?: string; kind?: string; icon?: string };
	let { values = {}, errors = {} }: { values?: Values; errors?: Record<string, string> } = $props();
	const kinds = [
		['grocery', 'Shopping'],
		['todo', 'To-do'],
		['other', 'Other']
	];
</script>

<label class="field"
	>Name
	<input name="name" value={values.name ?? ''} maxlength="60" required />
	{#if errors.name}<span class="error">{errors.name}</span>{/if}
</label>
<label class="field"
	>Kind
	<select name="kind">
		{#each kinds as [v, label] (v)}
			<option value={v} selected={(values.kind ?? 'grocery') === v}>{label}</option>
		{/each}
	</select>
</label>
<div class="field">
	<strong>Glyph</strong>
	<GlyphPicker name="icon" value={values.icon ?? 'bag'} />
	{#if errors.icon}<span class="error">{errors.icon}</span>{/if}
</div>

<style>
	.field {
		margin: 0 0 12px;
	}
	.field strong {
		display: block;
		margin-bottom: 4px;
	}
</style>
