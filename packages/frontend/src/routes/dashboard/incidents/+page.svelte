<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { OrganizationMemberWithUser, IncidentListItem } from '@logtide/shared';
	import { currentOrganization } from '$lib/stores/organization';
	import { authStore } from '$lib/stores/auth';
	import { scopeStore, readScopeFromUrl } from '$lib/stores/scope';
	import { siemStore, incidents, incidentsLoading, incidentsError, incidentsErrorCode, incidentsTotal, sseStatus } from '$lib/stores/siem';
	import { layoutStore } from '$lib/stores/layout';
	import { toastStore } from '$lib/stores/toast';
	import { projectsAPI } from '$lib/api/projects';
	import { organizationsAPI } from '$lib/api/organizations';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import ScopeBar from '$lib/components/app/ScopeBar.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import IncidentFilterBar from '$lib/components/siem/incidents/IncidentFilterBar.svelte';
	import IncidentsTable from '$lib/components/siem/incidents/IncidentsTable.svelte';
	import IncidentBulkBar from '$lib/components/siem/incidents/IncidentBulkBar.svelte';
	import {
		parseInboxUrl,
		serializeInboxUrl,
		toInboxFilters,
		type InboxUrlState,
	} from '$lib/components/siem/incidents/incident-model';
	import {
		clampPage,
		clearedState,
		hasActiveFilters,
		matchesInbox,
		runBulk,
	} from '$lib/components/siem/incidents/inbox-controller';
	import type { BulkAction } from '$lib/api/incidents';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	const PAGE_SIZE = 25;

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

	let projects = $state<{ id: string; name: string }[]>([]);
	let members = $state<OrganizationMemberWithUser[]>([]);
	let lookupsReady = $state(false);
	let lookupsOrg: string | null = null;
	let selected = $state<string[]>([]);
	let bulkBusy = $state(false);

	const orgId = $derived($currentOrganization?.id ?? null);
	const userId = $derived($authStore.user?.id ?? null);
	const projectNames = $derived(Object.fromEntries(projects.map((p) => [p.id, p.name])));

	// The URL is the source of truth for filters and page; the project scope comes
	// from the shared scope store, which ScopeBar keeps in step with the URL.
	const inbox = $derived.by<InboxUrlState>(() => {
		const parsed = parseInboxUrl(page.url, userId);
		const fromUrl = readScopeFromUrl(page.url).projectIds;
		return { ...parsed, projectIds: fromUrl ?? $scopeStore.projectIds };
	});

	const filters = $derived(orgId && lookupsReady ? toInboxFilters(inbox, orgId, PAGE_SIZE) : null);
	const filtersKey = $derived(filters ? JSON.stringify(filters) : '');
	const filtered = $derived(hasActiveFilters(inbox));

	// Projects and members, once per organization.
	$effect(() => {
		const id = orgId;
		if (!id || id === lookupsOrg) return;
		lookupsOrg = id;
		lookupsReady = false;
		untrack(() => {
			void (async () => {
				const [p, m] = await Promise.allSettled([
					projectsAPI.getProjects(id),
					organizationsAPI.getOrganizationMembers(id),
				]);
				if (lookupsOrg !== id) return;
				projects = p.status === 'fulfilled' ? p.value.projects.map((x) => ({ id: x.id, name: x.name })) : [];
				members = m.status === 'fulfilled' ? m.value.members : [];
				lookupsReady = true;
			})();
		});
	});

	// Load whenever the effective filters change; a change also drops the selection.
	$effect(() => {
		const key = filtersKey;
		const f = filters;
		if (!key || !f || !orgId) return;
		const id = orgId;
		untrack(() => {
			selected = [];
			void siemStore.loadIncidents(id, withoutOrg(f));
		});
	});

	function withoutOrg(f: NonNullable<typeof filters>) {
		const { organizationId: _ignored, ...rest } = f;
		return rest;
	}

	// A shared link can carry a page past the end: clamp it once the total is known.
	$effect(() => {
		if ($incidentsLoading || !lookupsReady) return;
		const total = $incidentsTotal;
		const current = untrack(() => inbox.page);
		const clamped = clampPage(current, total, PAGE_SIZE);
		if (total > 0 && clamped !== current) untrack(() => update({ page: clamped }));
	});

	// Realtime: one stream per organization, rows filtered through the current state.
	$effect(() => {
		const id = orgId;
		if (!id || !lookupsReady) return;
		untrack(() => void siemStore.startRealtimeUpdates(id));
		return () => siemStore.stopRealtimeUpdates();
	});
	$effect(() => {
		const state = inbox;
		const uid = userId;
		siemStore.setIncidentMatcher((i: IncidentListItem) => matchesInbox(i, state, uid));
		return () => siemStore.setIncidentMatcher(null);
	});

	function update(patch: Partial<InboxUrlState>) {
		const next: InboxUrlState = { ...inbox, ...patch };
		if (!('page' in patch)) next.page = 1;
		selected = [];
		void goto(serializeInboxUrl(next, page.url), { replaceState: true, keepFocus: true, noScroll: true });
	}

	// A stale assignee in a shared link is rejected with 400 invalid_assignee: drop it,
	// which changes the filters and so refetches.
	$effect(() => {
		const code = $incidentsErrorCode;
		if (code === 'invalid_assignee' && untrack(() => inbox.assignee) !== 'anyone') {
			untrack(() => update({ assignee: 'anyone' }));
		}
	});

	function reset() {
		update({ ...clearedState(inbox) });
	}

	function reload(silent = false) {
		if (!orgId || !filters) return;
		void siemStore.loadIncidents(orgId, withoutOrg(filters), { silent });
	}

	async function bulk(action: BulkAction, assigneeId?: string | null) {
		if (!orgId || selected.length === 0 || bulkBusy) return;
		bulkBusy = true;
		const ids = [...selected];
		const titles = new Map($incidents.map((i) => [i.id, i.title]));
		try {
			const outcome = await runBulk({
				organizationId: orgId,
				ids,
				action,
				assigneeId,
				titleOf: (id) => titles.get(id) ?? 'Unknown incident',
			});
			if (outcome.tone === 'success') toastStore.success(outcome.message);
			else toastStore.warning(outcome.message);
			selected = [];
			reload(true);
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : 'Could not update incidents');
		} finally {
			bulkBusy = false;
		}
	}

	const live = $derived(
		$sseStatus === 'live'
			? { text: 'Live', dot: 'bg-success' }
			: $sseStatus === 'reconnecting' || $sseStatus === 'connecting'
				? { text: $sseStatus === 'connecting' ? 'Connecting' : 'Reconnecting', dot: 'bg-warning' }
				: $sseStatus === 'disconnected'
					? { text: 'Disconnected', dot: 'bg-destructive' }
					: null
	);

	function reconnect() {
		if (orgId) void siemStore.startRealtimeUpdates(orgId);
	}
</script>

<svelte:head>
	<title>Incidents - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<PageHeader
		title="Incidents"
		description="Security detections, alert rules and uptime outages in one inbox."
		appliesTo="organization"
	>
		{#snippet meta()}
			{#if live}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
					role="status"
					data-testid="connection-pill"
				>
					<span class="size-1.5 rounded-full {live.dot}" aria-hidden="true"></span>
					{live.text}
				</span>
				{#if $sseStatus === 'disconnected'}
					<Button variant="ghost" size="sm" onclick={reconnect}>Reconnect</Button>
				{/if}
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if lookupsReady}
				<ScopeBar mode="multi" {projects} showTime={false} />
			{/if}
			<Button variant="outline" size="sm" class="gap-2" onclick={() => reload(true)}>
				<RefreshCw class="w-4 h-4" aria-hidden="true" />
				Refresh
			</Button>
		{/snippet}
	</PageHeader>

	<div class="space-y-4">
		<IncidentFilterBar
			status={inbox.status}
			severity={inbox.severity}
			source={inbox.source}
			assignee={inbox.assignee}
			service={inbox.service}
			technique={inbox.technique}
			ruleId={inbox.ruleId}
			onChange={update}
			onReset={reset}
		/>

		<IncidentBulkBar
			count={selected.length}
			{members}
			busy={bulkBusy}
			onAcknowledge={() => bulk('acknowledge')}
			onResolve={() => bulk('resolve')}
			onAssign={(uid) => bulk('assign', uid)}
			onClear={() => (selected = [])}
		/>

		{#if $incidentsError && !$incidentsLoading}
			<EmptyState variant="error" title="Could not load incidents" description={$incidentsError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => reload()}>Retry</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<IncidentsTable
				incidents={$incidents}
				{members}
				{projectNames}
				loading={$incidentsLoading || !lookupsReady}
				bind:selected
				total={$incidentsTotal}
				page={inbox.page}
				pageSize={PAGE_SIZE}
				onPageChange={(p) => update({ page: p })}
			>
				{#snippet empty()}
					{#if filtered}
						<div class="space-y-3 py-6">
							<p class="font-medium text-foreground">No incidents match these filters</p>
							<Button variant="outline" size="sm" onclick={reset}>Clear filters</Button>
						</div>
					{:else}
						<div class="space-y-3 py-6">
							<p class="font-medium text-foreground">No incidents</p>
							<p class="mx-auto max-w-md text-sm">
								Incidents appear here when a detection rule matches, an alert rule fires or a monitor goes down.
							</p>
							<div class="flex flex-wrap items-center justify-center gap-2">
								<Button size="sm" href="/dashboard/alerts?create=1">Create alert</Button>
								<Button variant="outline" size="sm" href="/dashboard/security/rules">Open detection rules</Button>
							</div>
						</div>
					{/if}
				{/snippet}
			</IncidentsTable>
		{/if}
	</div>
</div>
