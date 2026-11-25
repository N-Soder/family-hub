<script lang="ts">
	import ListsPage from '$lib/components/ListsPage.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<ListsPage {data} {form} />
