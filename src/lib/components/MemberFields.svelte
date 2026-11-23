<script lang="ts">
	import GlyphPicker from './GlyphPicker.svelte';
	type M = { name: string; shortLabel: string; kind: string; icon: string; displayMode: string; active: boolean };
	let { m = null, errors = {} }: { m?: M | null; errors?: Record<string, string> } = $props();
</script>

<label class="field">Name <input name="name" value={m?.name ?? ''} required maxlength="60" /></label>
{#if errors.name}<p class="error">{errors.name}</p>{/if}
<label class="field">Short label (2–3 letters, shown on the wall) <input name="shortLabel" value={m?.shortLabel ?? ''} required maxlength="3" /></label>
{#if errors.shortLabel}<p class="error">{errors.shortLabel}</p>{/if}
<div class="row">
	<label class="field">Kind
		<select name="kind">
			<option value="child" selected={m?.kind !== 'adult' && m?.kind !== 'baby'}>Child</option>
			<option value="baby" selected={m?.kind === 'baby'}>Baby (day plan, ticked on phones)</option>
			<option value="adult" selected={m?.kind === 'adult'}>Adult</option>
		</select>
	</label>
	<label class="field">Wall display
		<select name="displayMode">
			<option value="picture" selected={m?.displayMode === 'picture'}>Picture (pre-reader, 6 big steps)</option>
			<option value="reader" selected={m?.displayMode !== 'picture'}>Reader (text, 8 steps)</option>
		</select>
	</label>
</div>
<div class="field">Glyph <GlyphPicker name="icon" value={m?.icon} /></div>
<label class="field"><input type="checkbox" name="active" checked={m?.active ?? true} /> Active</label>
