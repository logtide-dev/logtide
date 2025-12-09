<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import SeverityBadge from '../shared/SeverityBadge.svelte';
	import IncidentStatusBadge from './IncidentStatusBadge.svelte';
	import MitreTacticBadge from '../shared/MitreTacticBadge.svelte';
	import type { Incident } from '$lib/api/siem';
	import Clock from '@lucide/svelte/icons/clock';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Server from '@lucide/svelte/icons/server';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import User from '@lucide/svelte/icons/user';

	interface Props {
		incident: Incident;
		onclick?: () => void;
	}

	let { incident, onclick }: Props = $props();

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('it-IT', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function formatTimeAgo(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 60) {
			return `${diffMins}m ago`;
		} else if (diffHours < 24) {
			return `${diffHours}h ago`;
		} else {
			return `${diffDays}d ago`;
		}
	}
</script>

<Card
	class="cursor-pointer hover:bg-accent/50 transition-colors"
	role="button"
	tabindex="0"
	onclick={onclick}
	onkeypress={(e) => e.key === 'Enter' && onclick?.()}
>
	<CardContent class="p-4">
		<div class="flex items-start justify-between gap-4">
			<!-- Left: Main content -->
			<div class="flex-1 min-w-0">
				<!-- Title and badges -->
				<div class="flex items-center gap-2 mb-2 flex-wrap">
					<h3 class="font-semibold text-base truncate">{incident.title}</h3>
					<SeverityBadge severity={incident.severity} size="sm" />
					<IncidentStatusBadge status={incident.status} size="sm" />
				</div>

				<!-- Description -->
				{#if incident.description}
					<p class="text-sm text-muted-foreground line-clamp-2 mb-2">
						{incident.description}
					</p>
				{/if}

				<!-- Metadata row -->
				<div class="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
					<!-- Detection count -->
					<div class="flex items-center gap-1">
						<AlertTriangle class="w-3 h-3" />
						<span>{incident.detectionCount} detection{incident.detectionCount !== 1 ? 's' : ''}</span>
					</div>

					<!-- Affected services -->
					{#if incident.affectedServices && incident.affectedServices.length > 0}
						<div class="flex items-center gap-1">
							<Server class="w-3 h-3" />
							<span class="font-mono">{incident.affectedServices.slice(0, 2).join(', ')}</span>
							{#if incident.affectedServices.length > 2}
								<span>+{incident.affectedServices.length - 2}</span>
							{/if}
						</div>
					{/if}

					<!-- Time -->
					<div class="flex items-center gap-1" title={formatDate(incident.createdAt)}>
						<Clock class="w-3 h-3" />
						<span>{formatTimeAgo(incident.createdAt)}</span>
					</div>

					<!-- Assignee -->
					{#if incident.assigneeId}
						<div class="flex items-center gap-1">
							<User class="w-3 h-3" />
							<span>Assigned</span>
						</div>
					{/if}
				</div>

				<!-- MITRE Tactics -->
				{#if incident.mitreTactics && incident.mitreTactics.length > 0}
					<div class="flex items-center gap-1 mt-2 flex-wrap">
						{#each incident.mitreTactics.slice(0, 3) as tactic}
							<MitreTacticBadge {tactic} />
						{/each}
						{#if incident.mitreTactics.length > 3}
							<Badge variant="outline" class="text-xs">
								+{incident.mitreTactics.length - 3} more
							</Badge>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Right: Arrow -->
			<div class="flex-shrink-0 self-center">
				<ChevronRight class="w-5 h-5 text-muted-foreground" />
			</div>
		</div>
	</CardContent>
</Card>
