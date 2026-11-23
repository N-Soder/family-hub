<script lang="ts">
	// Two-tone icon from the shared set ($lib/glyphs, built by scripts/build-icons.ts).
	// The back layer takes --glyph-bg (default: the text colour) at --glyph-bg-opacity.
	import { ICONS as all } from '$lib/glyphs';
	let { name, size = 24, label }: { name: string | null | undefined; size?: number; label?: string } = $props();
	const icon = $derived(all[name ?? 'star'] ?? all.star);
</script>

<svg class="glyph" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}
	>{#if icon.bg}<path class="bg" d={icon.bg} />{/if}{#if icon.fg}<path d={icon.fg} />{/if}{#if icon.stroke}<path
			d={icon.stroke}
			fill="none"
			stroke="currentColor"
			stroke-width="16"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>{/if}</svg
>

<style>
	.glyph {
		flex: none;
	}
	.bg {
		fill: var(--glyph-bg, currentColor);
		opacity: var(--glyph-bg-opacity, 0.3);
	}
</style>
