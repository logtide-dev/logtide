<script lang="ts">
	import { layoutStore } from '$lib/stores/layout';
	import AlertsWorkspace from '$lib/components/alerts/AlertsWorkspace.svelte';

	let maxWidthClass = $state('max-w-7xl');
	let containerPadding = $state('px-6 py-8');

	$effect(() => {
		const a = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
		const b = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
		return () => {
			a();
			b();
		};
	});
</script>

<svelte:head>
	<title>Alerts - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<AlertsWorkspace />
</div>
