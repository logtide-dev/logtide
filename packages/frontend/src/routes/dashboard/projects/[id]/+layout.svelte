<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { currentOrganization } from '$lib/stores/organization';
	import { projectsAPI } from '$lib/api/projects';
	import { toastStore } from '$lib/stores/toast';
	import Card from '$lib/components/ui/card/card.svelte';
	import CardContent from '$lib/components/ui/card/card-content.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	let project = $state<any>(null);
	let loading = $state(false);
	let error = $state('');
	let lastLoadedKey = $state<string | null>(null);

	const projectId = $derived($page.params.id);

	const currentPath = $derived($page.url.pathname);
	const currentTab = $derived(() => {
		if (currentPath.endsWith('/alerts')) return 'alerts';
		if (currentPath.endsWith('/settings')) return 'settings';
		return 'logs';
	});

	async function loadProject(orgId: string, projId: string) {
		loading = true;
		error = '';

		try {
			const response = await projectsAPI.getProjects(orgId);
			const foundProject = response.projects.find((p) => p.id === projId);

			if (!foundProject) {
				error = 'Project not found';
				toastStore.error('Project not found');
				goto('/dashboard/projects');
				return;
			}

			project = foundProject;
			lastLoadedKey = `${orgId}-${projId}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load project';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization || !projectId) {
			project = null;
			lastLoadedKey = null;
			return;
		}

		const key = `${$currentOrganization.id}-${projectId}`;
		if (key === lastLoadedKey) return;

		loadProject($currentOrganization.id, projectId);
	});

	// Handle tab change
	function handleTabChange(tab: string) {
		const basePath = `/projects/${projectId}`;
		if (tab === 'logs') {
			goto(basePath);
		} else {
			goto(`${basePath}/${tab}`);
		}
	}
</script>

<div class="container mx-auto px-6 py-8 max-w-7xl space-y-6">
	{#if error}
		<Card>
			<CardContent class="py-12 text-center">
				<p class="text-destructive">{error}</p>
			</CardContent>
		</Card>
	{:else if project}
		<div>
			<h1 class="text-3xl font-bold tracking-tight">{project.name}</h1>
			{#if project.description}
				<p class="text-muted-foreground mt-2">{project.description}</p>
			{/if}
		</div>

		<Tabs.Root value={currentTab()} onValueChange={handleTabChange}>
			<Tabs.List class="grid w-full grid-cols-3">
				<Tabs.Trigger value="logs">Logs</Tabs.Trigger>
				<Tabs.Trigger value="alerts">Alerts</Tabs.Trigger>
				<Tabs.Trigger value="settings">Settings</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<div>
			{@render children()}
		</div>
	{:else}
		<div class="flex items-center justify-center py-12">
			<Spinner size="lg" />
			<span class="ml-3 text-muted-foreground">Loading project...</span>
		</div>
	{/if}
</div>
