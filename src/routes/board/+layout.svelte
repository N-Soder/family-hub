<script lang="ts">
	import '$lib/theme.css';
	let { children } = $props();
</script>

<svelte:head><title>Family Hub · Board</title></svelte:head>

{@render children()}
