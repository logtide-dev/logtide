<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentOrganization } from '$lib/stores/organization';
	import {
		getIncident,
		updateIncident,
		type Incident,
		type DetectionEvent,
		type IncidentComment,
		type IncidentHistoryEntry,
	} from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import {
		Select,
		SelectTrigger,
		SelectContent,
		SelectItem,
		SelectValue,
	} from '$lib/components/ui/select';
	import Spinner from '$lib/components/Spinner.svelte';
	import SeverityBadge from '$lib/components/siem/shared/SeverityBadge.svelte';
	import MitreTacticBadge from '$lib/components/siem/shared/MitreTacticBadge.svelte';
	import MitreTechniqueBadge from '$lib/components/siem/shared/MitreTechniqueBadge.svelte';
	import IncidentStatusBadge from '$lib/components/siem/incidents/IncidentStatusBadge.svelte';
	import IncidentStatusDropdown from '$lib/components/siem/incidents/IncidentStatusDropdown.svelte';
	import IncidentActionsDropdown from '$lib/components/siem/incidents/IncidentActionsDropdown.svelte';
	import IncidentCommentsThread from '$lib/components/siem/incidents/IncidentCommentsThread.svelte';
	import IncidentHistoryTimeline from '$lib/components/siem/incidents/IncidentHistoryTimeline.svelte';
	import DetectionEventsList from '$lib/components/siem/incidents/DetectionEventsList.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Clock from '@lucide/svelte/icons/clock';
	import Server from '@lucide/svelte/icons/server';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import User from '@lucide/svelte/icons/user';
	import FileText from '@lucide/svelte/icons/file-text';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import History from '@lucide/svelte/icons/history';

	// State
	let incident = $state<Incident | null>(null);
	let detections = $state<DetectionEvent[]>([]);
	let comments = $state<IncidentComment[]>([]);
	let history = $state<IncidentHistoryEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let activeTab = $state('detections');

	// SSE connection
	let eventSource = $state<EventSource | null>(null);

	const incidentId = $derived($page.params.id);

	async function loadIncident() {
		if (!$currentOrganization || !incidentId) return;

		loading = true;
		error = '';

		try {
			const response = await getIncident(incidentId, $currentOrganization.id);
			incident = response.incident;
			detections = response.detections;
			comments = response.comments;
			history = response.history;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load incident';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	function handleIncidentUpdate(updatedIncident: Incident) {
		incident = updatedIncident;
		// Reload to get updated history
		loadIncident();
	}

	function handleCommentAdded(comment: IncidentComment) {
		comments = [...comments, comment];
		// Reload to get updated history
		loadIncident();
	}

	function handleLogClick(logId: string, projectId: string) {
		// Navigate to log search with the specific log ID and project ID
		goto(`/dashboard/search?logId=${logId}&projectId=${projectId}`);
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('it-IT', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function formatDuration(start: string, end: string | null): string {
		if (!end) return 'Ongoing';
		const startDate = new Date(start);
		const endDate = new Date(end);
		const diffMs = endDate.getTime() - startDate.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
		if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''}`;
		return `${diffMins} minute${diffMins > 1 ? 's' : ''}`;
	}

	// Initialize SSE for real-time updates
	function startSSE() {
		if (!browser || !$currentOrganization || !incidentId) return;

		const token = localStorage.getItem('session_token');
		if (!token) return;

		const params = new URLSearchParams({
			organizationId: $currentOrganization.id,
			incidentId: incidentId,
			token: token,
		});

		// Note: This requires a backend SSE endpoint
		// eventSource = new EventSource(`/api/v1/siem/events?${params.toString()}`);
		// eventSource.onmessage = (event) => { ... };
	}

	function stopSSE() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization || !incidentId) {
			incident = null;
			detections = [];
			comments = [];
			history = [];
			return;
		}

		loadIncident();
		// startSSE(); // Enable when SSE endpoint is ready

		return () => {
			stopSSE();
		};
	});
</script>

<svelte:head>
	<title>{incident?.title || 'Incident'} - LogWard</title>
</svelte:head>

<div class="container mx-auto px-6 py-8 max-w-7xl">
	{#if loading}
		<div class="flex items-center justify-center py-24">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading incident...</span>
		</div>
	{:else if error}
		<div class="text-center py-24">
			<p class="text-destructive mb-4">{error}</p>
			<div class="flex items-center justify-center gap-4">
				<Button variant="outline" onclick={() => goto('/dashboard/security/incidents')}>
					Back to Incidents
				</Button>
				<Button onclick={loadIncident}>Retry</Button>
			</div>
		</div>
	{:else if incident}
		<!-- Header -->
		<div class="mb-6">
			<div class="flex items-center gap-3 mb-4">
				<Button
					variant="ghost"
					size="icon"
					onclick={() => goto('/dashboard/security/incidents')}
				>
					<ArrowLeft class="w-5 h-5" />
				</Button>
				<div class="flex-1">
					<div class="flex items-center gap-3 flex-wrap">
						<h1 class="text-2xl font-bold tracking-tight">{incident.title}</h1>
						<SeverityBadge severity={incident.severity} />
						<IncidentStatusBadge status={incident.status} />
					</div>
					{#if incident.description}
						<p class="text-muted-foreground mt-1">{incident.description}</p>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					<IncidentStatusDropdown {incident} onUpdate={handleIncidentUpdate} />
					<IncidentActionsDropdown {incident} />
				</div>
			</div>
		</div>

		<!-- Main Content: 2 columns on large screens -->
		<div class="grid gap-6 lg:grid-cols-3">
			<!-- Left Column: Tabs with detection events, comments, history -->
			<div class="lg:col-span-2">
				<Tabs bind:value={activeTab}>
					<TabsList class="mb-4">
						<TabsTrigger value="detections" class="gap-2">
							<AlertTriangle class="w-4 h-4" />
							Detections
							<Badge variant="secondary" class="ml-1">{detections.length}</Badge>
						</TabsTrigger>
						<TabsTrigger value="comments" class="gap-2">
							<MessageSquare class="w-4 h-4" />
							Comments
							<Badge variant="secondary" class="ml-1">{comments.length}</Badge>
						</TabsTrigger>
						<TabsTrigger value="history" class="gap-2">
							<History class="w-4 h-4" />
							History
							<Badge variant="secondary" class="ml-1">{history.length}</Badge>
						</TabsTrigger>
					</TabsList>

					<TabsContent value="detections">
						<DetectionEventsList {detections} onLogClick={handleLogClick} />
					</TabsContent>

					<TabsContent value="comments">
						<IncidentCommentsThread
							{comments}
							incidentId={incident.id}
							organizationId={$currentOrganization?.id ?? ''}
							onCommentAdded={handleCommentAdded}
						/>
					</TabsContent>

					<TabsContent value="history">
						<IncidentHistoryTimeline {history} />
					</TabsContent>
				</Tabs>
			</div>

			<!-- Right Column: Metadata -->
			<div class="space-y-6">
				<!-- Incident Details -->
				<Card>
					<CardHeader class="pb-3">
						<CardTitle class="text-base font-semibold flex items-center gap-2">
							<FileText class="w-4 h-4" />
							Details
						</CardTitle>
					</CardHeader>
					<CardContent class="space-y-4">
						<!-- Created -->
						<div>
							<p class="text-xs font-medium text-muted-foreground mb-1">Created</p>
							<div class="flex items-center gap-2">
								<Clock class="w-4 h-4 text-muted-foreground" />
								<span class="text-sm">{formatDate(incident.createdAt)}</span>
							</div>
						</div>

						<!-- Resolved -->
						{#if incident.resolvedAt}
							<div>
								<p class="text-xs font-medium text-muted-foreground mb-1">Resolved</p>
								<div class="flex items-center gap-2">
									<Clock class="w-4 h-4 text-muted-foreground" />
									<span class="text-sm">{formatDate(incident.resolvedAt)}</span>
								</div>
							</div>
						{/if}

						<!-- Duration -->
						<div>
							<p class="text-xs font-medium text-muted-foreground mb-1">Duration</p>
							<span class="text-sm">
								{formatDuration(incident.createdAt, incident.resolvedAt)}
							</span>
						</div>

						<!-- Detection Count -->
						<div>
							<p class="text-xs font-medium text-muted-foreground mb-1">Detection Events</p>
							<div class="flex items-center gap-2">
								<AlertTriangle class="w-4 h-4 text-destructive" />
								<span class="text-sm font-semibold">{incident.detectionCount}</span>
							</div>
						</div>

						<!-- Assignee -->
						<div>
							<p class="text-xs font-medium text-muted-foreground mb-1">Assignee</p>
							{#if incident.assigneeId}
								<div class="flex items-center gap-2">
									<User class="w-4 h-4 text-muted-foreground" />
									<span class="text-sm">Assigned</span>
								</div>
							{:else}
								<span class="text-sm text-muted-foreground">Unassigned</span>
							{/if}
						</div>

						<!-- Trace ID -->
						{#if incident.traceId}
							<div>
								<p class="text-xs font-medium text-muted-foreground mb-1">Trace ID</p>
								<span class="text-xs font-mono break-all">{incident.traceId}</span>
							</div>
						{/if}
					</CardContent>
				</Card>

				<!-- Affected Services -->
				{#if incident.affectedServices && incident.affectedServices.length > 0}
					<Card>
						<CardHeader class="pb-3">
							<CardTitle class="text-base font-semibold flex items-center gap-2">
								<Server class="w-4 h-4" />
								Affected Services
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="flex flex-wrap gap-2">
								{#each incident.affectedServices as service}
									<Badge variant="outline" class="font-mono text-xs">
										{service}
									</Badge>
								{/each}
							</div>
						</CardContent>
					</Card>
				{/if}

				<!-- MITRE ATT&CK -->
				{#if (incident.mitreTactics && incident.mitreTactics.length > 0) || (incident.mitreTechniques && incident.mitreTechniques.length > 0)}
					<Card>
						<CardHeader class="pb-3">
							<CardTitle class="text-base font-semibold">MITRE ATT&CK</CardTitle>
						</CardHeader>
						<CardContent class="space-y-3">
							{#if incident.mitreTactics && incident.mitreTactics.length > 0}
								<div>
									<p class="text-xs font-medium text-muted-foreground mb-2">Tactics</p>
									<div class="flex flex-wrap gap-1">
										{#each incident.mitreTactics as tactic}
											<MitreTacticBadge {tactic} />
										{/each}
									</div>
								</div>
							{/if}
							{#if incident.mitreTechniques && incident.mitreTechniques.length > 0}
								<div>
									<p class="text-xs font-medium text-muted-foreground mb-2">Techniques</p>
									<div class="flex flex-wrap gap-1">
										{#each incident.mitreTechniques as technique}
											<MitreTechniqueBadge {technique} />
										{/each}
									</div>
								</div>
							{/if}
						</CardContent>
					</Card>
				{/if}

				<!-- IP Reputation (if enriched) -->
				{#if incident.ipReputation && Object.keys(incident.ipReputation).length > 0}
					<Card>
						<CardHeader class="pb-3">
							<CardTitle class="text-base font-semibold">IP Reputation</CardTitle>
						</CardHeader>
						<CardContent>
							<pre class="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(incident.ipReputation, null, 2)}</pre>
						</CardContent>
					</Card>
				{/if}

				<!-- GeoIP Data (if enriched) -->
				{#if incident.geoData && Object.keys(incident.geoData).length > 0}
					<Card>
						<CardHeader class="pb-3">
							<CardTitle class="text-base font-semibold">Geographic Data</CardTitle>
						</CardHeader>
						<CardContent>
							<pre class="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(incident.geoData, null, 2)}</pre>
						</CardContent>
					</Card>
				{/if}
			</div>
		</div>
	{:else}
		<div class="text-center py-24">
			<p class="text-muted-foreground mb-4">Incident not found</p>
			<Button onclick={() => goto('/dashboard/security/incidents')}>
				Back to Incidents
			</Button>
		</div>
	{/if}
</div>
