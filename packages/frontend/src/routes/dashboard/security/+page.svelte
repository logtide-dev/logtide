<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { onDestroy } from 'svelte';
	import type { Project } from '@logtide/shared';
	import { currentOrganization } from '$lib/stores/organization';
	import { scopeStore } from '$lib/stores/scope';
	import {
		siemStore,
		dashboardStats,
		dashboardLoading,
		dashboardError,
		realtimeEnabled,
		lastSseEvent,
	} from '$lib/stores/siem';
	import {
		getRecentDetections,
		type DetectionEvent,
		type TopThreat,
		type AffectedService,
		type MitreHeatmapCell,
	} from '$lib/api/siem';
	import { projectsAPI } from '$lib/api/projects';
	import { toastStore } from '$lib/stores/toast';
	import { layoutStore } from '$lib/stores/layout';
	import { stateTone } from '$lib/utils/severity';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import ScopeBar from '$lib/components/app/ScopeBar.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import StatsBar from '$lib/components/siem/dashboard/StatsBar.svelte';
	import TimelineWidget from '$lib/components/siem/dashboard/TimelineWidget.svelte';
	import RecentEventsTable from '$lib/components/siem/dashboard/RecentEventsTable.svelte';
	import TopThreatsCompact from '$lib/components/siem/dashboard/TopThreatsCompact.svelte';
	import AffectedServicesCompact from '$lib/components/siem/dashboard/AffectedServicesCompact.svelte';
	import MitreHeatmap from '$lib/components/siem/dashboard/MitreHeatmap.svelte';
	import DetectionPacksGalleryDialog from '$lib/components/DetectionPacksGalleryDialog.svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Radio from '@lucide/svelte/icons/radio';
	import { incidentsLink, detectionLink, toSecurityRange } from './overview-links';

	const SCOPE_PRESETS = ['24h', '7d', '30d'] as const;

	let maxWidthClass = $state('max-w-7xl');
	let containerPadding = $state('px-4 py-6');

	$effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
	$effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

	let projects = $state<Project[]>([]);
	let refreshing = $state(false);
	let recentEvents = $state<DetectionEvent[]>([]);
	let eventsLoading = $state(false);
	let showPacks = $state(false);

	// One project in the scope narrows the API call; none or several means all
	// projects (the SIEM dashboard accepts a single project only).
	const projectId = $derived($scopeStore.projectIds.length === 1 ? $scopeStore.projectIds[0] : undefined);
	const severalProjects = $derived($scopeStore.projectIds.length > 1);
	const securityRange = $derived(toSecurityRange($scopeStore.range));

	let loadKey = '';
	let eventsSequence = 0;

	// A burst of detections arrives as one stream event each: reload once
	// after the burst instead of once per event.
	const REALTIME_RELOAD_DELAY_MS = 1000;
	let realtimeReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleRealtimeReload() {
		if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
		realtimeReloadTimer = setTimeout(() => {
			realtimeReloadTimer = null;
			loadDashboard();
			loadRecentEvents();
		}, REALTIME_RELOAD_DELAY_MS);
	}

	onDestroy(() => {
		if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
		siemStore.stopRealtimeUpdates();
	});

	async function loadProjects(orgId: string) {
		try {
			const result = await projectsAPI.getProjects(orgId);
			if ($currentOrganization?.id === orgId) projects = result.projects;
		} catch (e) {
			console.error('Failed to load projects:', e);
			projects = [];
		}
	}

	async function loadDashboard() {
		const org = $currentOrganization;
		if (!org) return;
		siemStore.setTimeRange(securityRange);
		await siemStore.loadDashboard(org.id, projectId);
	}

	async function loadRecentEvents() {
		const org = $currentOrganization;
		if (!org) return;
		const sequence = ++eventsSequence;
		eventsLoading = true;
		try {
			const result = await getRecentDetections({
				organizationId: org.id,
				projectId,
				category: 'security',
				limit: 10,
			});
			if (sequence === eventsSequence) recentEvents = result.detections;
		} catch (e) {
			console.error('Failed to load recent events:', e);
		} finally {
			if (sequence === eventsSequence) eventsLoading = false;
		}
	}

	async function handleRefresh() {
		refreshing = true;
		await Promise.all([loadDashboard(), loadRecentEvents()]);
		refreshing = false;
		toastStore.success('Overview refreshed');
	}

	async function retry() {
		await Promise.all([loadDashboard(), loadRecentEvents()]);
	}

	function handleThreatClick(threat: TopThreat) {
		goto(incidentsLink({ ruleId: threat.ruleId }));
	}

	function handleServiceClick(service: AffectedService) {
		goto(incidentsLink({ service: service.serviceName }));
	}

	function handleMitreClick(cell: MitreHeatmapCell) {
		goto(incidentsLink({ technique: cell.technique }));
	}

	function handleEventClick(event: DetectionEvent) {
		const href = detectionLink(event);
		if (href) goto(href);
	}

	// Projects follow the organization.
	$effect(() => {
		const org = $currentOrganization;
		if (!browser || !org) {
			projects = [];
			return;
		}
		untrack(() => loadProjects(org.id));
	});

	// Data follows organization, project scope and time range.
	$effect(() => {
		const org = $currentOrganization;
		if (!browser || !org) {
			siemStore.clear();
			recentEvents = [];
			loadKey = '';
			return;
		}

		const key = `${org.id}|${projectId ?? ''}|${securityRange}`;
		if (key === loadKey) return;
		const orgChanged = !loadKey.startsWith(`${org.id}|`);
		loadKey = key;

		untrack(() => {
			loadDashboard();
			loadRecentEvents();
			if (orgChanged) siemStore.startRealtimeUpdates(org.id);
		});
	});

	$effect(() => {
		const event = $lastSseEvent;
		if (!event || !$currentOrganization) return;

		if (
			event.type === 'detection_created' ||
			event.type === 'incident_created' ||
			event.type === 'incident_updated'
		) {
			untrack(scheduleRealtimeReload);
		}
	});

	let isEmpty = $derived(
		$dashboardStats !== null &&
			!$dashboardStats.totalDetections &&
			!$dashboardStats.totalIncidents &&
			(!$dashboardStats.topThreats || $dashboardStats.topThreats.length === 0)
	);
</script>

<svelte:head>
	<title>Security overview - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<PageHeader
		title="Security overview"
		description="Detections and incidents found by your detection rules."
	>
		{#snippet meta()}
			{#if $realtimeEnabled}
				<span class="flex items-center gap-1 text-xs {stateTone('ok').text}">
					<Radio class="w-3 h-3 animate-pulse" aria-hidden="true" />
					<span>Live</span>
				</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			<ScopeBar mode="multi" {projects} presets={[...SCOPE_PRESETS]} hideZoneOnMobile />
			<Button
				variant="outline"
				size="sm"
				class="h-8 max-md:h-11 max-md:flex-1"
				onclick={handleRefresh}
				disabled={refreshing || $dashboardLoading}
			>
				<RefreshCw class="w-3.5 h-3.5 mr-1.5 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
				Refresh
			</Button>
			<Button variant="outline" size="sm" class="h-8 max-md:h-11 max-md:flex-1" href={incidentsLink({})}>View incidents</Button>
		{/snippet}
	</PageHeader>

	{#if severalProjects}
		<p class="mb-4 text-sm text-muted-foreground">Showing all projects</p>
	{/if}

	{#if $dashboardError}
		<EmptyState variant="error" title="Could not load the overview" description={$dashboardError}>
			{#snippet actions()}
				<Button onclick={retry}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else if !$dashboardStats}
		<div class="flex gap-3 mb-4">
			{#each Array(4) as _}
				<Skeleton class="h-20 flex-1 rounded-lg" />
			{/each}
		</div>
		<Skeleton class="h-48 w-full rounded-lg mb-4" />
		<Skeleton class="h-64 w-full rounded-lg mb-4" />
		<div class="grid gap-4 md:grid-cols-2 mb-4">
			<Skeleton class="h-48 rounded-lg" />
			<Skeleton class="h-48 rounded-lg" />
		</div>
	{:else if isEmpty}
		<EmptyState
			variant="setup"
			title="No detections yet"
			description="Enable detection rules to start finding threats in your logs"
		>
			{#snippet actions()}
				<Button onclick={() => goto('/dashboard/security/rules')}>Open detection rules</Button>
				<Button variant="outline" onclick={() => (showPacks = true)}>Browse detection packs</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="mb-4">
			<StatsBar stats={$dashboardStats} />
		</div>

		<div class="mb-4">
			<TimelineWidget data={$dashboardStats?.timeline} timeRange={securityRange} />
		</div>

		<div class="mb-4">
			<RecentEventsTable
				events={recentEvents}
				loading={eventsLoading}
				onEventClick={handleEventClick}
			/>
		</div>

		<div class="grid gap-4 md:grid-cols-2 mb-4">
			<TopThreatsCompact
				threats={$dashboardStats?.topThreats}
				onThreatClick={handleThreatClick}
			/>
			<AffectedServicesCompact
				services={$dashboardStats?.affectedServices}
				onServiceClick={handleServiceClick}
			/>
		</div>

		<div>
			<MitreHeatmap cells={$dashboardStats?.mitreHeatmap} onCellClick={handleMitreClick} />
		</div>
	{/if}

	{#if $currentOrganization}
		<DetectionPacksGalleryDialog
			bind:open={showPacks}
			organizationId={$currentOrganization.id}
			categories={['security']}
			onSuccess={retry}
		/>
	{/if}
</div>
