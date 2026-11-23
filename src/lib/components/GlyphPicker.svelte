<script lang="ts">
	import Glyph from './Glyph.svelte';
	import { GLYPH_NAMES } from '$lib/glyphs';
	let { name, value = 'star' }: { name: string; value?: string | null } = $props();
</script>

<div class="glyphs" role="radiogroup">
	{#each GLYPH_NAMES as g (g)}
		<label title={g}>
			<input type="radio" {name} value={g} checked={g === (value ?? 'star')} />
			<Glyph name={g} size={26} />
		</label>
	{/each}
</div>

<style>
	.glyphs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	label {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 1.5px solid var(--line-strong);
		border-radius: 14px;
		background: var(--card);
		cursor: pointer;
		--glyph-bg: var(--accent);
		--glyph-bg-opacity: 0.25;
	}
	label:has(input:checked) {
		border-color: var(--accent-ink);
		background: var(--accent-ink);
		color: var(--card);
		--glyph-bg: var(--card);
		--glyph-bg-opacity: 0.4;
	}
	label:has(input:focus-visible) {
		outline: 3px solid var(--sun);
		outline-offset: 2px;
	}
	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
</style>
