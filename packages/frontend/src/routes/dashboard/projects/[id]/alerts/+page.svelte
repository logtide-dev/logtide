<script lang="ts">
	import { page } from '$app/state';
	import AlertsWorkspace from '$lib/components/alerts/AlertsWorkspace.svelte';

	const projectId = $derived(page.params.id ?? null);
</script>

<svelte:head>
	<title>Alerts - LogTide</title>
</svelte:head>

{#key projectId}
	<AlertsWorkspace embedded lockedProjectId={projectId} />
{/key}
