<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { currentOrganization } from '$lib/stores/organization';
	import { projectsAPI } from '$lib/api/projects';
	import { toastStore } from '$lib/stores/toast';
	import Card from '$lib/components/ui/card/card.svelte';
	import CardContent from '$lib/components/ui/card/card-content.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import * as Tabs from '$lib/components/ui/tabs';
	import { layoutStore } from '$lib/stores/layout';

	const HARD_DELETE_GRACE_DAYS = 30;

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	let project = $state<any>(null);
	let capabilities = $state<{ hasWebVitals: boolean; hasSessions: boolean }>({ hasWebVitals: false, hasSessions: false });
	let loading = $state(false);
	let restoring = $state(false);
	let error = $state('');
	let lastLoadedKey = $state<string | null>(null);
	let maxWidthClass = $state("max-w-7xl");
	let containerPadding = $state("px-6 py-8");

	$effect(() => {
		const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
			maxWidthClass = value;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
			containerPadding = value;
		});
		return unsubscribe;
	});

	const projectId = $derived(page.params.id);

	const currentPath = $derived(page.url.pathname);

	const validTabs = ['overview', 'performance', 'sessions', 'alerts', 'settings'];

	const currentTab = $derived.by(() => {
		const segments = currentPath.split('/');
		// Check from last to first for a valid tab (handles sub-routes like /sessions/abc123)
		for (let i = segments.length - 1; i >= 0; i--) {
			if (validTabs.includes(segments[i])) return segments[i];
		}
		return 'overview';
	});

	const visibleTabs = $derived.by(() => {
		const tabs: Array<{ value: string; label: string }> = [
			{ value: 'overview', label: 'Overview' },
		];
		if (capabilities.hasWebVitals) {
			tabs.push({ value: 'performance', label: 'Performance' });
		}
		if (capabilities.hasSessions) {
			tabs.push({ value: 'sessions', label: 'Sessions' });
		}
		tabs.push({ value: 'alerts', label: 'Alerts' });
		// A soft-deleted project is read-only; its settings cannot be edited.
		if (!project?.deletedAt) {
			tabs.push({ value: 'settings', label: 'Settings' });
		}
		return tabs;
	});

	async function loadProject(orgId: string, projId: string) {
		loading = true;
		error = '';

		try {
			const [response, caps] = await Promise.all([
				// includeDeleted so a soft-deleted project stays viewable (read-only)
				// during the grace window — its logs/traces/metrics are still around.
				projectsAPI.getProjects(orgId, { includeDeleted: true }),
				projectsAPI.getProjectCapabilities(projId).catch(() => ({ hasWebVitals: false, hasSessions: false })),
			]);

			const foundProject = response.projects.find((p) => p.id === projId);

			if (!foundProject) {
				error = 'Project not found';
				toastStore.error('Project not found');
				goto('/dashboard/projects');
				return;
			}

			project = foundProject;
			capabilities = caps;
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
		const basePath = `/dashboard/projects/${projectId}`;
		goto(`${basePath}/${tab}`);
	}

	// Date (en-US, project convention) the project is permanently purged.
	const purgeDate = $derived.by(() => {
		if (!project?.deletedAt) return null;
		const d = new Date(project.deletedAt);
		d.setDate(d.getDate() + HARD_DELETE_GRACE_DAYS);
		return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	});

	async function restoreProject() {
		if (!$currentOrganization || !projectId) return;
		restoring = true;
		try {
			await projectsAPI.restoreProject($currentOrganization.id, projectId);
			toastStore.success('Project restored successfully.');
			lastLoadedKey = null; // force the loader to refetch
			await loadProject($currentOrganization.id, projectId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to restore project');
		} finally {
			restoring = false;
		}
	}
</script>

<div class="container mx-auto {containerPadding} {maxWidthClass} space-y-6">
	{#if error}
		<Card>
			<CardContent class="py-12 text-center">
				<p class="text-destructive">{error}</p>
			</CardContent>
		</Card>
	{:else if project}
		{#if project.deletedAt}
			<div class="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div class="text-sm">
					<p class="font-medium">This project is deleted (read-only)</p>
					<p class="text-muted-foreground">
						Its logs, traces and metrics stay available
						{#if purgeDate}until they are permanently deleted on {purgeDate}{:else}for 30 days{/if}.
						Restore the project to make it active again.
					</p>
				</div>
				<Button variant="outline" size="sm" class="gap-2 shrink-0" disabled={restoring} onclick={restoreProject}>
					{#if restoring}
						<Spinner size="sm" />
					{:else}
						<RotateCcw class="w-4 h-4" />
					{/if}
					Restore
				</Button>
			</div>
		{/if}
		<div>
			<h1 class="text-3xl font-bold tracking-tight">{project.name}</h1>
			{#if project.description}
				<p class="text-muted-foreground mt-2">{project.description}</p>
			{/if}
		</div>

		<Tabs.Root value={currentTab} onValueChange={handleTabChange}>
			<Tabs.List class="grid w-full" style="grid-template-columns: repeat({visibleTabs.length}, minmax(0, 1fr))">
				{#each visibleTabs as tab (tab.value)}
					<Tabs.Trigger value={tab.value}>{tab.label}</Tabs.Trigger>
				{/each}
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
