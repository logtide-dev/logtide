<script lang="ts">
	import type { IncidentListItem, OrganizationMemberWithUser } from '@logtide/shared';
	import type { AlertRule } from '$lib/api/alerts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import MitreTacticBadge from '$lib/components/siem/shared/MitreTacticBadge.svelte';
	import MitreTechniqueBadge from '$lib/components/siem/shared/MitreTechniqueBadge.svelte';
	import IpReputationCard from '$lib/components/siem/enrichment/IpReputationCard.svelte';
	import GeoIpCard from '$lib/components/siem/enrichment/GeoIpCard.svelte';
	import GeoIpMap from '$lib/components/siem/enrichment/GeoIpMap.svelte';
	import { buildMatchedLogsUrl, summarizeRule } from '$lib/components/alerts/alert-model';
	import AssigneePicker from './AssigneePicker.svelte';
	import { buildTraceUrl, formatIncidentDuration } from './incident-model';

	interface Props {
		incident: IncidentListItem;
		members: OrganizationMemberWithUser[];
		rule?: AlertRule | null;
		onAssign: (userId: string | null) => void;
	}

	let { incident, members, rule = null, onAssign }: Props = $props();

	const tactics = $derived(incident.mitreTactics ?? []);
	const techniques = $derived(incident.mitreTechniques ?? []);
	const services = $derived(incident.affectedServices ?? []);

	// The matched-logs window covers the whole incident, never less than the rule window.
	const matchedLogsUrl = $derived.by(() => {
		if (!rule) return null;
		const last = new Date(incident.lastEventAt).getTime();
		const created = new Date(incident.createdAt).getTime();
		const spanMinutes =
			Number.isFinite(last) && Number.isFinite(created) && last > created
				? Math.ceil((last - created) / 60000)
				: 0;
		return buildMatchedLogsUrl({
			projectId: rule.projectId ?? incident.projectId,
			query: rule.query,
			service: rule.service,
			levels: rule.level,
			metadataFilters: rule.metadataFilters,
			triggeredAt: incident.lastEventAt,
			windowMinutes: Math.max(rule.timeWindow, spanMinutes),
		});
	});
</script>

<div class="space-y-6">
	<Card>
		<CardHeader class="pb-3">
			<CardTitle class="text-base font-semibold">Details</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4">
			<div>
				<p class="mb-1 text-xs font-medium text-muted-foreground">Created</p>
				<span class="text-sm"><Timestamp value={incident.createdAt} precision="minute" showZone /></span>
			</div>
			{#if incident.resolvedAt}
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground">Resolved</p>
					<span class="text-sm"><Timestamp value={incident.resolvedAt} precision="minute" showZone /></span>
				</div>
			{/if}
			<div>
				<p class="mb-1 text-xs font-medium text-muted-foreground">Duration</p>
				<span class="text-sm">{formatIncidentDuration(incident.createdAt, incident.resolvedAt)}</span>
			</div>
			<div>
				<p class="mb-1 text-xs font-medium text-muted-foreground">Assignee</p>
				<AssigneePicker {members} value={incident.assigneeId} onChange={onAssign} />
			</div>
			<div>
				<p class="mb-1 text-xs font-medium text-muted-foreground">Project</p>
				<span class="text-sm">{incident.project?.name ?? 'All projects'}</span>
			</div>
			{#if incident.traceId}
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground">Trace</p>
					<a
						class="break-all font-mono text-xs text-primary-text hover:underline"
						href={buildTraceUrl(incident.traceId, incident.projectId)}
					>
						{incident.traceId}
					</a>
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if incident.source === 'sigma'}
		{#if services.length > 0}
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base font-semibold">Affected services</CardTitle>
				</CardHeader>
				<CardContent>
					<div class="flex flex-wrap gap-2">
						{#each services as service (service)}
							<Badge variant="outline" class="font-mono text-xs">{service}</Badge>
						{/each}
					</div>
				</CardContent>
			</Card>
		{/if}
		{#if tactics.length > 0 || techniques.length > 0}
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base font-semibold">MITRE ATT&amp;CK</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if tactics.length > 0}
						<div>
							<p class="mb-2 text-xs font-medium text-muted-foreground">Tactics</p>
							<div class="flex flex-wrap gap-1">
								{#each tactics as tactic (tactic)}
									<MitreTacticBadge {tactic} />
								{/each}
							</div>
						</div>
					{/if}
					{#if techniques.length > 0}
						<div>
							<p class="mb-2 text-xs font-medium text-muted-foreground">Techniques</p>
							<div class="flex flex-wrap gap-1">
								{#each techniques as technique (technique)}
									<MitreTechniqueBadge {technique} />
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		{/if}
		{#if incident.ipReputation && Object.keys(incident.ipReputation).length > 0}
			<IpReputationCard ipReputation={incident.ipReputation as never} />
		{/if}
		{#if incident.geoData && Object.keys(incident.geoData).length > 0}
			<GeoIpCard geoData={incident.geoData as never} />
			<GeoIpMap geoData={incident.geoData as never} />
		{/if}
	{:else if incident.source === 'alert'}
		<Card>
			<CardHeader class="pb-3">
				<CardTitle class="text-base font-semibold">Alert rule</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3">
				{#if rule}
					<div>
						<p class="text-sm font-medium">{rule.name}</p>
						<p class="text-sm text-muted-foreground">{summarizeRule(rule)}</p>
					</div>
					<div class="flex flex-wrap gap-3 text-sm">
						<a class="text-primary-text hover:underline" href={`/dashboard/alerts?edit=${encodeURIComponent(rule.id)}`}>
							Open rule
						</a>
						{#if matchedLogsUrl}
							<a class="text-primary-text hover:underline" href={matchedLogsUrl}>Show matched logs</a>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						{#if incident.sourceRef?.name}{incident.sourceRef.name}: {/if}Rule no longer exists
					</p>
				{/if}
			</CardContent>
		</Card>
	{:else if incident.source === 'monitor'}
		<Card>
			<CardHeader class="pb-3">
				<CardTitle class="text-base font-semibold">Uptime monitor</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2 text-sm">
				{#if incident.monitorId}
					<p>
						<a class="text-primary-text hover:underline" href={`/dashboard/uptime/${encodeURIComponent(incident.monitorId)}`}>
							View monitor
						</a>
					</p>
					<p>
						<a
							class="text-primary-text hover:underline"
							href={`/dashboard/uptime/${encodeURIComponent(incident.monitorId)}#response-time`}
						>
							View response time
						</a>
					</p>
				{:else}
					<p class="text-muted-foreground">Monitor no longer exists</p>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>
