<script lang="ts">
	import Glyph from './Glyph.svelte';
	// The one back link at the top of a Planner page: a chevron and where it goes ("< Lists").
	let { href, label }: { href: string; label: string } = $props();
</script>

<a class="back" {href}><Glyph name="back" size={20} />{label}</a>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-height: 44px;
		margin: -6px 0 -4px -6px;
		color: var(--accent-ink);
		text-decoration: none;
		font-weight: 600;
	}
</style>
