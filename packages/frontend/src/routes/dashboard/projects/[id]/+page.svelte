<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	const projectId = $derived(page.params.id);

	onMount(() => {
		goto(`/dashboard/projects/${projectId}/overview`, { replaceState: true });
	});
</script>
