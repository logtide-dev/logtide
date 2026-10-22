<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type {
		DetectionEvent,
		IncidentComment,
		IncidentHistoryEntry,
		IncidentListItem,
		OrganizationMemberWithUser,
	} from '@logtide/shared';
	import { currentOrganization } from '$lib/stores/organization';
	import { siemStore, incidents, lastSseEvent } from '$lib/stores/siem';
	import { layoutStore } from '$lib/stores/layout';
	import { toastStore } from '$lib/stores/toast';
	import { incidentsAPI, type IncidentPatch, type IncidentSourceEvent } from '$lib/api/incidents';
	import { alertsAPI, type AlertRule } from '$lib/api/alerts';
	import { organizationsAPI } from '$lib/api/organizations';
	import { exportIncidentToPdf } from '$lib/utils/siem';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import IncidentStatusBadge from '$lib/components/siem/incidents/IncidentStatusBadge.svelte';
	import IncidentSourceBadge from '$lib/components/siem/incidents/IncidentSourceBadge.svelte';
	import IncidentTimeline from '$lib/components/siem/incidents/IncidentTimeline.svelte';
	import IncidentSourcePanel from '$lib/components/siem/incidents/IncidentSourcePanel.svelte';
	import IncidentDetailActions from '$lib/components/siem/incidents/IncidentDetailActions.svelte';
	import {
		buildMergedTimeline,
		buildPublishToStatusPageUrl,
	} from '$lib/components/siem/incidents/incident-model';

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

	let incident = $state<IncidentListItem | null>(null);
	let detections = $state<DetectionEvent[]>([]);
	let comments = $state<IncidentComment[]>([]);
	let history = $state<IncidentHistoryEntry[]>([]);
	let sourceEvents = $state<IncidentSourceEvent[]>([]);
	let members = $state<OrganizationMemberWithUser[]>([]);
	let rule = $state<AlertRule | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let loadError = $state('');
	let busy = $state(false);

	const orgId = $derived($currentOrganization?.id ?? null);
	const incidentId = $derived(page.params.id ?? null);
	// Derived so the realtime effect only reruns when the id itself changes.
	const loadedId = $derived(incident?.id ?? null);
	const entries = $derived(
		buildMergedTimeline({ detections, comments, history, sourceEvents })
	);

	// Sequence guard: only the newest request may write state.
	let loadSeq = 0;
	let loadedKey = '';
	let membersOrg: string | null = null;

	async function loadMembers(org: string) {
		if (membersOrg === org) return;
		membersOrg = org;
		try {
			members = (await organizationsAPI.getOrganizationMembers(org)).members;
		} catch {
			members = [];
		}
	}

	async function loadRule(org: string, ruleId: string | null) {
		if (!ruleId) {
			rule = null;
			return;
		}
		try {
			rule = (await alertsAPI.getAlertRule(ruleId, org)).alertRule;
		} catch {
			// A deleted rule is expected: the source panel shows its fallback.
			rule = null;
		}
	}

	async function loadIncident(opts: { silent?: boolean } = {}) {
		const org = orgId;
		const id = incidentId;
		if (!org || !id) return;
		const seq = ++loadSeq;
		if (!opts.silent) {
			loading = true;
			notFound = false;
			loadError = '';
		}
		try {
			const [detail] = await Promise.all([incidentsAPI.get(id, org), loadMembers(org)]);
			if (seq !== loadSeq) return;
			incident = detail.incident;
			detections = detail.detections;
			comments = detail.comments;
			history = detail.history;
			sourceEvents = detail.sourceEvents;
			siemStore.seedIncidents([detail.incident]);
			if (!opts.silent && detail.incident.source === 'alert') {
				await loadRule(org, detail.incident.alertRuleId);
			}
		} catch (e) {
			if (seq !== loadSeq) return;
			if (opts.silent) return;
			const status = (e as { status?: number }).status;
			if (status === 404) notFound = true;
			else loadError = e instanceof Error ? e.message : 'Could not load incident';
			incident = null;
		} finally {
			if (seq === loadSeq && !opts.silent) loading = false;
		}
	}

	// Load when the organization or the route id changes.
	$effect(() => {
		const key = orgId && incidentId ? `${orgId}:${incidentId}` : '';
		if (!key || key === loadedKey) return;
		loadedKey = key;
		untrack(() => {
			incident = null;
			rule = null;
			void loadIncident();
		});
	});

	// Realtime: this incident only; created events never belong on this page.
	$effect(() => {
		const org = orgId;
		const id = loadedId;
		if (!org || !id) return;
		untrack(() => {
			siemStore.setIncidentMatcher(() => false);
			void siemStore.startRealtimeUpdates(org, { incidentId: id });
		});
		return () => {
			siemStore.setIncidentMatcher(null);
			siemStore.stopRealtimeUpdates();
		};
	});

	// A stream update for this incident merges into the header without a reload.
	$effect(() => {
		const row = $incidents.find((i) => i.id === untrack(() => incident?.id));
		if (!row) return;
		untrack(() => {
			if (!incident) return;
			if (new Date(row.updatedAt).getTime() > new Date(incident.updatedAt).getTime()) {
				incident = { ...incident, ...row };
			}
		});
	});

	// New detections or updates also change the timeline: refresh it silently.
	let lastEvent: unknown = null;
	$effect(() => {
		const ev = $lastSseEvent;
		if (!ev || ev === lastEvent) return;
		lastEvent = ev;
		if (ev.type === 'detection_created' || ev.type === 'incident_updated') {
			untrack(() => void loadIncident({ silent: true }));
		}
	});

	async function apply(patch: IncidentPatch, message: string) {
		if (!incident || !orgId || busy) return;
		busy = true;
		try {
			const updated = await incidentsAPI.update(incident.id, orgId, patch);
			incident = { ...incident, ...updated };
			siemStore.seedIncidents([incident]);
			toastStore.success(message);
			await loadIncident({ silent: true });
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not update incident');
		} finally {
			busy = false;
		}
	}

	const acknowledge = () => apply({ status: 'investigating' }, 'Incident acknowledged');
	const resolve = () => apply({ status: 'resolved' }, 'Incident resolved');
	const reopen = () => apply({ status: 'open' }, 'Incident reopened');
	const falsePositive = () => apply({ status: 'false_positive' }, 'Marked as false positive');
	const assign = (userId: string | null) =>
		apply({ assigneeId: userId }, userId ? 'Assignee updated' : 'Assignee removed');

	function publish() {
		if (incident) void goto(buildPublishToStatusPageUrl(incident));
	}

	async function exportPdf() {
		if (!incident) return;
		try {
			await exportIncidentToPdf({
				incident: incident as never,
				detections: detections as never,
				comments: comments as never,
				history: history as never,
			});
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not export PDF');
		}
	}

	async function remove() {
		if (!incident || !orgId) return;
		try {
			await incidentsAPI.remove(incident.id, orgId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not delete incident');
			throw e;
		}
		siemStore.removeIncident(incident.id);
		toastStore.success('Incident deleted');
		await goto('/dashboard/incidents');
	}

	function commentAdded(comment: IncidentComment) {
		comments = [...comments, comment];
		void loadIncident({ silent: true });
	}
</script>

<svelte:head>
	<title>{incident ? `${incident.title} - LogTide` : 'Incident - LogTide'}</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	{#if loading}
		<div class="space-y-4" aria-busy="true" aria-label="Loading incident">
			<Skeleton class="h-4 w-48" />
			<Skeleton class="h-8 w-2/3" />
			<div class="grid gap-6 lg:grid-cols-3">
				<Skeleton class="h-96 lg:col-span-2" />
				<Skeleton class="h-96" />
			</div>
		</div>
	{:else if notFound}
		<EmptyState
			variant="no-results"
			title="Incident not found"
			description="It may have been deleted, or it belongs to another organization."
		>
			{#snippet actions()}
				<Button variant="outline" href="/dashboard/incidents">Back to incidents</Button>
			{/snippet}
		</EmptyState>
	{:else if loadError}
		<EmptyState variant="error" title="Could not load incident" description={loadError}>
			{#snippet actions()}
				<Button variant="outline" onclick={() => loadIncident()}>Retry</Button>
				<Button variant="outline" href="/dashboard/incidents">Back to incidents</Button>
			{/snippet}
		</EmptyState>
	{:else if incident}
		<PageHeader
			title={incident.title}
			description={incident.description ?? undefined}
			breadcrumbs={[{ label: 'Incidents', href: '/dashboard/incidents' }, { label: incident.title }]}
		>
			{#snippet meta()}
				<SeverityBadge kind="severity" value={incident!.severity} />
				<IncidentStatusBadge status={incident!.status} />
				<IncidentSourceBadge source={incident!.source} />
			{/snippet}
			{#snippet actions()}
				<IncidentDetailActions
					incident={incident!}
					{busy}
					onAcknowledge={acknowledge}
					onResolve={resolve}
					onReopen={reopen}
					onFalsePositive={falsePositive}
					onPublish={publish}
					onExportPdf={exportPdf}
					onDelete={remove}
				/>
			{/snippet}
		</PageHeader>

		<div class="grid gap-6 lg:grid-cols-3">
			<div class="lg:col-span-2">
				<IncidentTimeline
					{entries}
					{members}
					organizationId={orgId ?? ''}
					incidentId={incident.id}
					onCommentAdded={commentAdded}
				/>
			</div>
			<IncidentSourcePanel {incident} {members} {rule} onAssign={assign} />
		</div>
	{/if}
</div>
