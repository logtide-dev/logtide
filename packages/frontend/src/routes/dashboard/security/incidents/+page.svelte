<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentOrganization } from '$lib/stores/organization';
	import { siemStore, realtimeEnabled, lastSseEvent } from '$lib/stores/siem';
	import { listIncidents, type Incident, type IncidentStatus, type Severity } from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import { onDestroy } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import Spinner from '$lib/components/Spinner.svelte';
	import IncidentCard from '$lib/components/siem/incidents/IncidentCard.svelte';
	import IncidentFilters from '$lib/components/siem/incidents/IncidentFilters.svelte';
	import EmptyStateSiem from '$lib/components/siem/shared/EmptyStateSiem.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Radio from '@lucide/svelte/icons/radio';

	// Cleanup SSE connection on component destroy
	onDestroy(() => {
		siemStore.stopRealtimeUpdates();
	});

	// State
	let incidents = $state<Incident[]>([]);
	let loading = $state(false);
	let error = $state('');
	let lastLoadedOrg = $state<string | null>(null);
	let refreshing = $state(false);

	// Filters
	let statusFilter = $state<IncidentStatus[]>([]);
	let severityFilter = $state<Severity[]>([]);
	let serviceFilter = $state('');
	let techniqueFilter = $state('');

	// Pagination
	let currentPage = $state(1);
	let pageSize = $state(20);
	let hasMore = $state(false);

	// Initialize filters from URL params
	$effect(() => {
		if (!browser) return;

		const params = $page.url.searchParams;
		const statusParam = params.getAll('status');
		const severityParam = params.getAll('severity');
		const serviceParam = params.get('service');
		const techniqueParam = params.get('technique');

		if (statusParam.length > 0) {
			statusFilter = statusParam as IncidentStatus[];
		}
		if (severityParam.length > 0) {
			severityFilter = severityParam as Severity[];
		}
		if (serviceParam) {
			serviceFilter = serviceParam;
		}
		if (techniqueParam) {
			techniqueFilter = techniqueParam;
		}
	});

	async function loadIncidents() {
		if (!$currentOrganization) return;

		loading = true;
		error = '';

		try {
			const response = await listIncidents({
				organizationId: $currentOrganization.id,
				status: statusFilter.length > 0 ? statusFilter : undefined,
				severity: severityFilter.length > 0 ? severityFilter : undefined,
				service: serviceFilter || undefined,
				technique: techniqueFilter || undefined,
				limit: pageSize,
				offset: (currentPage - 1) * pageSize,
			});

			incidents = response.incidents;
			hasMore = response.incidents.length === pageSize;
			lastLoadedOrg = $currentOrganization.id;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load incidents';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	async function handleRefresh() {
		refreshing = true;
		await loadIncidents();
		refreshing = false;
		toastStore.success('Incidents refreshed');
	}

	function handleStatusChange(statuses: IncidentStatus[]) {
		statusFilter = statuses;
		currentPage = 1;
		updateUrl();
		loadIncidents();
	}

	function handleSeverityChange(severities: Severity[]) {
		severityFilter = severities;
		currentPage = 1;
		updateUrl();
		loadIncidents();
	}

	function handleServiceChange(service: string) {
		serviceFilter = service;
		currentPage = 1;
		updateUrl();
		loadIncidents();
	}

	function handleTechniqueChange(technique: string) {
		techniqueFilter = technique;
		currentPage = 1;
		updateUrl();
		loadIncidents();
	}

	function handleResetFilters() {
		statusFilter = [];
		severityFilter = [];
		serviceFilter = '';
		techniqueFilter = '';
		currentPage = 1;
		updateUrl();
		loadIncidents();
	}

	function updateUrl() {
		const params = new URLSearchParams();
		statusFilter.forEach((s) => params.append('status', s));
		severityFilter.forEach((s) => params.append('severity', s));
		if (serviceFilter) {
			params.append('service', serviceFilter);
		}
		if (techniqueFilter) {
			params.append('technique', techniqueFilter);
		}
		const newUrl = params.toString() ? `?${params.toString()}` : '';
		goto(`/dashboard/security/incidents${newUrl}`, { replaceState: true, keepFocus: true });
	}

	function handlePreviousPage() {
		if (currentPage > 1) {
			currentPage--;
			loadIncidents();
		}
	}

	function handleNextPage() {
		if (hasMore) {
			currentPage++;
			loadIncidents();
		}
	}

	function handleIncidentClick(incident: Incident) {
		goto(`/dashboard/security/incidents/${incident.id}`);
	}

	$effect(() => {
		if (!browser || !$currentOrganization) {
			incidents = [];
			lastLoadedOrg = null;
			return;
		}

		if ($currentOrganization.id === lastLoadedOrg) return;

		loadIncidents();

		// Start real-time updates
		siemStore.startRealtimeUpdates($currentOrganization.id);
	});

	// React to SSE events and reload incidents when needed
	$effect(() => {
		const event = $lastSseEvent;
		if (!event) return;

		// When incident events come in, reload the list to get fresh data
		if (
			event.type === 'incident_created' ||
			event.type === 'incident_updated' ||
			event.type === 'incident_deleted'
		) {
			loadIncidents();
		}
	});

	const activeFiltersCount = $derived(
		statusFilter.length +
			severityFilter.length +
			(serviceFilter ? 1 : 0) +
			(techniqueFilter ? 1 : 0)
	);
</script>

<svelte:head>
	<title>Security Incidents - LogWard</title>
</svelte:head>

<div class="container mx-auto px-6 py-8 max-w-7xl">
	<!-- Header -->
	<div class="flex items-start justify-between mb-6">
		<div>
			<div class="flex items-center gap-3 mb-2">
				<Button variant="ghost" size="icon" onclick={() => goto('/dashboard/security')}>
					<ArrowLeft class="w-5 h-5" />
				</Button>
				<Shield class="w-8 h-8 text-primary" />
				<h1 class="text-3xl font-bold tracking-tight">Security Incidents</h1>
			</div>
			<p class="text-muted-foreground ml-14">
				View and manage security incidents across your organization
			</p>
		</div>
		<div class="flex items-center gap-3">
			{#if $realtimeEnabled}
				<div class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
					<Radio class="w-3.5 h-3.5 animate-pulse" />
					<span>Live</span>
				</div>
			{/if}
			<Button variant="outline" onclick={handleRefresh} disabled={refreshing || loading}>
				<RefreshCw class="w-4 h-4 mr-2 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<div class="mb-6 flex items-center justify-between">
		<IncidentFilters
			{statusFilter}
			{severityFilter}
			{serviceFilter}
			{techniqueFilter}
			onStatusChange={handleStatusChange}
			onSeverityChange={handleSeverityChange}
			onServiceChange={handleServiceChange}
			onTechniqueChange={handleTechniqueChange}
			onReset={handleResetFilters}
		/>
		{#if incidents.length > 0}
			<p class="text-sm text-muted-foreground">
				Showing {incidents.length} incident{incidents.length !== 1 ? 's' : ''}
				{#if activeFiltersCount > 0}
					(filtered)
				{/if}
			</p>
		{/if}
	</div>

	<!-- Content -->
	{#if loading && incidents.length === 0}
		<div class="flex items-center justify-center py-24">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading incidents...</span>
		</div>
	{:else if error}
		<div class="text-center py-24">
			<p class="text-destructive mb-4">{error}</p>
			<Button onclick={loadIncidents}>Retry</Button>
		</div>
	{:else if incidents.length === 0}
		<EmptyStateSiem
			type="incidents"
			title={activeFiltersCount > 0 ? 'No incidents match your filters' : 'No incidents found'}
			description={activeFiltersCount > 0
				? 'Try adjusting your filters or wait for new detection events.'
				: 'Security incidents are automatically created when Sigma rules detect threats in your logs.'}
			actionLabel={activeFiltersCount > 0 ? 'Clear Filters' : 'View Sigma Rules'}
			onAction={activeFiltersCount > 0 ? handleResetFilters : () => goto('/dashboard/alerts')}
		/>
	{:else}
		<!-- Incident List -->
		<div class="space-y-4">
			{#each incidents as incident}
				<IncidentCard {incident} onclick={() => handleIncidentClick(incident)} />
			{/each}
		</div>

		<!-- Pagination -->
		<div class="mt-6 flex items-center justify-between">
			<div class="text-sm text-muted-foreground">
				Page {currentPage}
			</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={handlePreviousPage}
					disabled={currentPage === 1 || loading}
				>
					<ChevronLeft class="w-4 h-4 mr-1" />
					Previous
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={handleNextPage}
					disabled={!hasMore || loading}
				>
					Next
					<ChevronRight class="w-4 h-4 ml-1" />
				</Button>
			</div>
		</div>
	{/if}
</div>
