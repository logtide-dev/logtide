<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { currentOrganization } from '$lib/stores/organization';
	import { siemStore, dashboardStats, dashboardLoading, dashboardError, realtimeEnabled, lastSseEvent } from '$lib/stores/siem';
	import { getRecentDetections, type DetectionEvent, type TopThreat, type AffectedService, type MitreHeatmapCell } from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import TimeRangeButtons from '$lib/components/TimeRangeButtons.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { Skeleton, SkeletonTable } from '$lib/components/ui/skeleton';
	import StatsBar from '$lib/components/siem/dashboard/StatsBar.svelte';
	import TimelineWidget from '$lib/components/siem/dashboard/TimelineWidget.svelte';
	import RecentEventsTable from '$lib/components/siem/dashboard/RecentEventsTable.svelte';
	import TopThreatsCompact from '$lib/components/siem/dashboard/TopThreatsCompact.svelte';
	import AffectedServicesCompact from '$lib/components/siem/dashboard/AffectedServicesCompact.svelte';
	import MitreHeatmap from '$lib/components/siem/dashboard/MitreHeatmap.svelte';
	import EmptyStateSiem from '$lib/components/siem/shared/EmptyStateSiem.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Radio from '@lucide/svelte/icons/radio';
	import { onDestroy } from 'svelte';
	import { layoutStore } from '$lib/stores/layout';

	let lastLoadedOrg = $state<string | null>(null);
	let maxWidthClass = $state("max-w-7xl");
	let containerPadding = $state("px-4 py-6");

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
	let timeRange = $state<'24h' | '7d' | '30d'>('24h');
	let refreshing = $state(false);
	let recentEvents = $state<DetectionEvent[]>([]);
	let eventsLoading = $state(false);

	onDestroy(() => {
		siemStore.stopRealtimeUpdates();
	});

	async function loadDashboard() {
		if (!$currentOrganization) return;
		await siemStore.loadDashboard($currentOrganization.id);
		lastLoadedOrg = $currentOrganization.id;
	}

	async function loadRecentEvents() {
		if (!$currentOrganization) return;
		eventsLoading = true;
		try {
			const result = await getRecentDetections({
				organizationId: $currentOrganization.id,
				limit: 10,
			});
			recentEvents = result.detections;
		} catch (e) {
			console.error('Failed to load recent events:', e);
		} finally {
			eventsLoading = false;
		}
	}

	async function handleRefresh() {
		refreshing = true;
		await Promise.all([loadDashboard(), loadRecentEvents()]);
		refreshing = false;
		toastStore.success('Dashboard refreshed');
	}

	function handleTimeRangeChange(range: '24h' | '7d' | '30d') {
		timeRange = range;
		siemStore.setTimeRange(range);
		if ($currentOrganization) {
			siemStore.loadDashboard($currentOrganization.id);
		}
	}

	function handleThreatClick(threat: TopThreat) {
		goto(`/dashboard/security/incidents?ruleId=${encodeURIComponent(threat.ruleId)}`);
	}

	function handleServiceClick(service: AffectedService) {
		goto(`/dashboard/security/incidents?service=${encodeURIComponent(service.serviceName)}`);
	}

	function handleMitreClick(cell: MitreHeatmapCell) {
		goto(`/dashboard/security/incidents?technique=${encodeURIComponent(cell.technique)}`);
	}

	function handleEventClick(event: DetectionEvent) {
		if (event.incidentId) {
			// Navigate to the incident if the event is linked to one
			goto(`/dashboard/security/incidents/${event.incidentId}`);
		} else if (event.logId && event.projectId) {
			// Navigate to search with the specific log
			goto(`/dashboard/search?logId=${event.logId}&projectId=${event.projectId}`);
		} else if (event.logId) {
			// Navigate to search with just the log ID
			goto(`/dashboard/search?logId=${event.logId}`);
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization) {
			siemStore.clear();
			recentEvents = [];
			lastLoadedOrg = null;
			return;
		}

		if ($currentOrganization.id === lastLoadedOrg) return;

		loadDashboard();
		loadRecentEvents();
		siemStore.startRealtimeUpdates($currentOrganization.id);
	});

	$effect(() => {
		const event = $lastSseEvent;
		if (!event || !$currentOrganization) return;

		if (
			event.type === 'detection_created' ||
			event.type === 'incident_created' ||
			event.type === 'incident_updated'
		) {
			siemStore.loadDashboard($currentOrganization.id);
			loadRecentEvents();
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
	<title>Security Dashboard - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<!-- Header -->
	<div class="flex items-center justify-between mb-4">
		<div class="flex items-center gap-3">
			<Shield class="w-6 h-6 text-primary" />
			<h1 class="text-xl font-bold">Security Dashboard</h1>
			{#if $realtimeEnabled}
				<div class="flex items-center gap-1 text-xs text-emerald-500">
					<Radio class="w-3 h-3 animate-pulse" />
					<span>Live</span>
				</div>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<TimeRangeButtons
				options={[
					{ value: '24h', label: '24h' },
					{ value: '7d', label: '7d' },
					{ value: '30d', label: '30d' },
				]}
				value={timeRange}
				onChange={(v) => handleTimeRangeChange(v as typeof timeRange)}
			/>
			<Button variant="outline" size="sm" class="h-8" onclick={handleRefresh} disabled={refreshing || $dashboardLoading}>
				<RefreshCw class="w-3.5 h-3.5 mr-1.5 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>
	</div>

	{#if $dashboardLoading && !$dashboardStats}
		<!-- Stats bar skeleton -->
		<div class="flex gap-3 mb-4">
			{#each Array(4) as _}
				<Skeleton class="h-20 flex-1 rounded-lg" />
			{/each}
		</div>
		<!-- Timeline skeleton -->
		<Skeleton class="h-48 w-full rounded-lg mb-4" />
		<!-- Table skeleton -->
		<Skeleton class="h-64 w-full rounded-lg mb-4" />
		<!-- Bottom grid skeleton -->
		<div class="grid gap-4 md:grid-cols-2 mb-4">
			<Skeleton class="h-48 rounded-lg" />
			<Skeleton class="h-48 rounded-lg" />
		</div>
	{:else if $dashboardError}
		<div class="text-center py-24">
			<p class="text-destructive mb-4">{$dashboardError}</p>
			<Button onclick={loadDashboard}>Retry</Button>
		</div>
	{:else if !$dashboardStats}
		<div class="flex gap-3 mb-4">
			{#each Array(4) as _}
				<Skeleton class="h-20 flex-1 rounded-lg" />
			{/each}
		</div>
		<Skeleton class="h-48 w-full rounded-lg mb-4" />
		<Skeleton class="h-64 w-full rounded-lg mb-4" />
	{:else if isEmpty}
		<EmptyStateSiem
			type="incidents"
			title="No security events detected"
			description="Enable Sigma rules to start detecting security threats in your logs."
			actionLabel="Manage Sigma Rules"
			onAction={() => goto('/dashboard/security/rules')}
		/>
	{:else}
		<!-- Stats Bar -->
		<div class="mb-4">
			<StatsBar stats={$dashboardStats} />
		</div>

		<!-- Timeline -->
		<div class="mb-4">
			<TimelineWidget data={$dashboardStats?.timeline} {timeRange} />
		</div>

		<!-- Recent Events Table -->
		<div class="mb-4">
			<RecentEventsTable
				events={recentEvents}
				loading={eventsLoading}
				onEventClick={handleEventClick}
			/>
		</div>

		<!-- 2-Column Grid: Top Threats | Affected Services -->
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

		<!-- MITRE Heatmap - Full Width -->
		<div>
			<MitreHeatmap cells={$dashboardStats?.mitreHeatmap} onCellClick={handleMitreClick} />
		</div>
	{/if}
</div>
