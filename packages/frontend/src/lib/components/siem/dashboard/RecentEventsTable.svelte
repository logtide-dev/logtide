<script lang="ts">
	import { goto } from '$app/navigation';
	import type { DetectionEvent } from '$lib/api/siem';
	import SeverityBadge from '../shared/SeverityBadge.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import Button from '$lib/components/ui/button/button.svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Clock from '@lucide/svelte/icons/clock';

	interface Props {
		events: DetectionEvent[];
		loading?: boolean;
		onEventClick?: (event: DetectionEvent) => void;
	}

	let { events, loading = false, onEventClick }: Props = $props();

	function truncate(str: string, len: number): string {
		if (str.length <= len) return str;
		return str.slice(0, len) + '...';
	}
</script>

<Card>
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Activity class="w-4 h-4 text-primary" />
			Recent security events
		</CardTitle>
		<Button variant="ghost" size="sm" onclick={() => goto('/dashboard/incidents?source=sigma')}>
			View all
			<ArrowRight class="w-3.5 h-3.5 ml-1" />
		</Button>
	</CardHeader>
	<CardContent class="p-0">
		{#if loading}
			<div class="flex items-center justify-center py-8 text-muted-foreground">
				<span class="text-sm">Loading events</span>
			</div>
		{:else if events.length === 0}
			<div class="flex flex-col items-center justify-center py-8 text-muted-foreground">
				<Activity class="w-8 h-8 mb-2 opacity-50" />
				<span class="text-sm">No recent events</span>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b bg-muted/30">
							<th class="text-left py-2 px-4 font-medium text-muted-foreground w-20">Severity</th>
							<th class="text-left py-2 px-4 font-medium text-muted-foreground w-40">Time</th>
							<th class="text-left py-2 px-4 font-medium text-muted-foreground">Rule</th>
							<th class="text-left py-2 px-4 font-medium text-muted-foreground w-32">Service</th>
						</tr>
					</thead>
					<tbody>
						{#each events.slice(0, 8) as event}
							<tr
								class="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
								onclick={() => onEventClick?.(event)}
							>
								<td class="py-2 px-4">
									<SeverityBadge severity={event.severity} size="sm" />
								</td>
								<td class="py-2 px-4">
									<div class="flex items-center gap-1 text-muted-foreground">
										<Clock class="w-3 h-3" />
										<span class="text-xs"><Timestamp value={event.time} precision="second" /></span>
									</div>
								</td>
								<td class="py-2 px-4">
									<span class="font-medium" title={event.ruleTitle}>
										{truncate(event.ruleTitle, 40)}
									</span>
								</td>
								<td class="py-2 px-4">
									<span class="font-mono text-xs text-muted-foreground">
										{event.service || '-'}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</CardContent>
</Card>
