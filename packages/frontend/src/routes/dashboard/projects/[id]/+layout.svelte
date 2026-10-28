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
	import ProjectHealthPill from '$lib/components/projects/ProjectHealthPill.svelte';
	import ProjectSummaryTiles from '$lib/components/projects/ProjectSummaryTiles.svelte';
	import ProjectSideNav from '$lib/components/projects/ProjectSideNav.svelte';
	import { projectPageStore } from '$lib/stores/project-page';
	import { formatRelative } from '$lib/utils/datetime';
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

	// Tiles cover logs, errors, traces, uptime and incidents; these stay as plain links.
	const EXTRA_LINK_IDS = ['metrics', 'sessions', 'web-vitals'];

	const quickLinks = $derived(
		projectId ? projectQuickLinks(projectId).filter((l) => EXTRA_LINK_IDS.includes(l.id)) : []
	);

	function isMutedNow(i: { mute: { until: string | null; untilResolved: boolean } | null }): boolean {
		const m = i.mute;
		if (!m) return false;
		return m.untilResolved || (m.until !== null && new Date(m.until).getTime() > Date.now());
	}

	const pageState = $derived($projectPageStore);
	const health = $derived(pageState.projectId === projectId ? pageState.health : null);
	const pageLoading = $derived(pageState.projectId !== projectId || pageState.loading);
	const summary = $derived(pageState.projectId === projectId ? pageState.summary : null);
	const healthEntry = $derived(
		health
			? {
					status: health.status,
					openIssues: health.issues
						.filter((i) => i.resolvedAt === null)
						.map((i) => ({ checkKey: i.checkKey, severity: i.severity, muted: isMutedNow(i) })),
				}
			: undefined
	);
	const unmutedOpenCount = $derived(healthEntry ? healthEntry.openIssues.filter((i) => !i.muted).length : 0);

	// Health and tile numbers load once per project; a deleted project has no checks.
	$effect(() => {
		if (!browser || !projectId || !project) return;
		if (project.deletedAt) {
			projectPageStore.reset();
			return;
		}
		void projectPageStore.load(projectId);
	});

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

<div class="container mx-auto {containerPadding} {maxWidthClass} space-y-6">
	{#if error}
		<EmptyState variant="error" title="Could not load project" description={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={retry}>Retry</Button>
			{/snippet}
		</EmptyState>
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

		<PageHeader
			title={project.name}
			description={project.description || undefined}
			appliesTo="project"
			breadcrumbs={[{ label: 'Projects', href: '/dashboard/projects' }, { label: project.name }]}
		>
			{#snippet meta()}
				{#if !project.deletedAt}
					<ProjectHealthPill entry={healthEntry} />
					{#if health}
						<span class="text-xs text-muted-foreground" data-testid="project-last-event">
							{health.lastEventAt ? `Last event ${formatRelative(health.lastEventAt)}` : 'No events yet'}
						</span>
					{/if}
				{/if}
			{/snippet}
		</PageHeader>

		{#if !project.deletedAt && projectId}
			<div class="-mt-2 space-y-3">
				<ProjectSummaryTiles {projectId} {summary} loading={pageLoading} />
				{#if quickLinks.length > 0}
					<nav aria-label="More data" class="flex flex-wrap items-center gap-2 text-sm" data-testid="project-quick-links">
						<span class="text-muted-foreground">Also explore</span>
						{#each quickLinks as link (link.id)}
							<a href={link.href} class={buttonVariants({ variant: 'outline', size: 'sm' })}>{link.label}</a>
						{/each}
					</nav>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-6 md:flex-row md:items-start">
			{#if projectId}
				<ProjectSideNav
					{projectId}
					pathname={currentPath}
					hash={page.url.hash}
					issueCount={project.deletedAt ? 0 : unmutedOpenCount}
					deleted={!!project.deletedAt}
				/>
			{/if}
			<div class="min-w-0 flex-1">
				{#if project.deletedAt && !currentPath.endsWith('/settings')}
					<p class="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground" data-testid="health-paused">
						Health checks are paused while the project is deleted.
					</p>
				{:else}
					{@render children()}
				{/if}
			</div>
		</div>
	{:else}
		<PageSkeleton />
	{/if}
</div>
