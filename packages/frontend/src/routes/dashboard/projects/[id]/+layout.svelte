<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { currentOrganization } from '$lib/stores/organization';
	import { projectsAPI } from '$lib/api/projects';
	import { toastStore } from '$lib/stores/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import PageSkeleton from '$lib/components/shell/PageSkeleton.svelte';
	import { projectQuickLinks } from '$lib/components/shell/project-links';
	import { formatDateShort } from '$lib/utils/datetime';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import * as Tabs from '$lib/components/ui/tabs';
	import { layoutStore } from '$lib/stores/layout';

	const HARD_DELETE_GRACE_DAYS = 30;

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	let project = $state<any>(null);
	let loading = $state(false);
	let restoring = $state(false);
	let error = $state('');
	let lastLoadedKey = $state<string | null>(null);
	// Keys already redirected away from, so the not-found fallback fires once.
	let redirectedKey: string | null = null;
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

	// Performance and Sessions live on the top-level Web vitals and Sessions
	// pages now; the quick links below point there.
	const validTabs = ['overview', 'alerts', 'settings'];

	const currentTab = $derived.by(() => {
		const segments = currentPath.split('/');
		for (let i = segments.length - 1; i >= 0; i--) {
			if (validTabs.includes(segments[i])) return segments[i];
		}
		return 'overview';
	});

	const visibleTabs = $derived.by(() => {
		const tabs: Array<{ value: string; label: string }> = [
			{ value: 'overview', label: 'Overview' },
			{ value: 'alerts', label: 'Alerts' },
		];
		// A soft-deleted project is read-only; its settings cannot be edited.
		if (!project?.deletedAt) {
			tabs.push({ value: 'settings', label: 'Settings' });
		}
		return tabs;
	});

	const quickLinks = $derived(projectId ? projectQuickLinks(projectId) : []);

	async function loadProject(orgId: string, projId: string) {
		loading = true;
		error = '';

		try {
			// includeDeleted so a soft-deleted project stays viewable (read-only)
			// during the grace window: its logs, traces and metrics are still around.
			const response = await projectsAPI.getProjects(orgId, { includeDeleted: true });

			const foundProject = response.projects.find((p) => p.id === projId);

			if (!foundProject) {
				// Unknown id, or a project of another organization after a switch.
				project = null;
				lastLoadedKey = `${orgId}-${projId}`;
				if (redirectedKey !== lastLoadedKey) {
					redirectedKey = lastLoadedKey;
					toastStore.error('Project not found');
					goto('/dashboard/projects');
				}
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

	function retry() {
		if (!$currentOrganization || !projectId) return;
		lastLoadedKey = null;
		loadProject($currentOrganization.id, projectId);
	}

	// Handle tab change
	function handleTabChange(tab: string) {
		const basePath = `/dashboard/projects/${projectId}`;
		goto(`${basePath}/${tab}`);
	}

	// Date the project is permanently purged.
	const purgeDate = $derived.by(() => {
		if (!project?.deletedAt) return null;
		const d = new Date(project.deletedAt);
		d.setDate(d.getDate() + HARD_DELETE_GRACE_DAYS);
		return formatDateShort(d);
	});

	async function restoreProject() {
		if (!$currentOrganization || !projectId) return;
		restoring = true;
		try {
			await projectsAPI.restoreProject($currentOrganization.id, projectId);
			toastStore.success('Project restored');
			lastLoadedKey = null; // force the loader to refetch
			await loadProject($currentOrganization.id, projectId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to restore project');
		} finally {
			restoring = false;
		}
	}
</script>

{#snippet retryAction()}
	<Button variant="outline" size="sm" onclick={retry}>Retry</Button>
{/snippet}

<div class="container mx-auto {containerPadding} {maxWidthClass} space-y-6">
	{#if error}
		<EmptyState variant="error" title="Could not load project" description={error} actions={retryAction} />
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
			<PageHeader
				title={project.name}
				description={project.description || undefined}
				appliesTo="project"
				breadcrumbs={[{ label: 'Projects', href: '/dashboard/projects' }, { label: project.name }]}
			/>

			<nav aria-label="Project data" class="-mt-2 flex flex-wrap gap-2" data-testid="project-quick-links">
				{#each quickLinks as link (link.id)}
					<a href={link.href} class={buttonVariants({ variant: 'outline', size: 'sm' })}>{link.label}</a>
				{/each}
			</nav>
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
		<PageSkeleton />
	{/if}
</div>
