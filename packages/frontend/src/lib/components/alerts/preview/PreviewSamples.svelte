<script lang="ts">
	import type { PreviewIncident } from "$lib/api/alerts";
	import { Badge } from "$lib/components/ui/badge";
	import Button from "$lib/components/ui/button/button.svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import Clock from "@lucide/svelte/icons/clock";
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";

	interface Props {
		incidents: PreviewIncident[];
	}

	let { incidents }: Props = $props();

	let expandedIncidents = $state<Set<string>>(new Set());

	function toggleIncident(incidentId: string) {
		const newSet = new Set(expandedIncidents);
		if (newSet.has(incidentId)) {
			newSet.delete(incidentId);
		} else {
			newSet.add(incidentId);
		}
		expandedIncidents = newSet;
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case "debug":
				return "bg-gray-100 text-gray-800";
			case "info":
				return "bg-blue-100 text-blue-800";
			case "warn":
				return "bg-yellow-100 text-yellow-800";
			case "error":
				return "bg-red-100 text-red-800";
			case "critical":
				return "bg-purple-100 text-purple-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	}

	function formatTime(dateStr: string): string {
		const d = new Date(dateStr);
		return d.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	}

	function formatLogTime(dateStr: string): string {
		const d = new Date(dateStr);
		return d.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	}
</script>

<div class="space-y-2">
	{#if incidents.length === 0}
		<div class="text-center py-6 text-muted-foreground text-sm">
			No sample incidents to display.
		</div>
	{:else}
		{#each incidents.slice(0, 5) as incident}
			<div class="border rounded-lg overflow-hidden">
				<button
					type="button"
					onclick={() => toggleIncident(incident.id)}
					class="w-full px-3 py-2 flex items-center justify-between bg-muted/50 hover:bg-muted/80 transition-colors text-left"
				>
					<div class="flex items-center gap-3">
						<AlertTriangle class="w-4 h-4 text-orange-500" />
						<div class="text-sm">
							<span class="font-medium">
								{formatTime(incident.startTime)}
							</span>
							<span class="text-muted-foreground ml-2">
								{incident.durationMinutes} min duration
							</span>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<Badge variant="outline" class="text-xs">
							Peak: {incident.peakValue} logs
						</Badge>
						{#if expandedIncidents.has(incident.id)}
							<ChevronUp class="w-4 h-4 text-muted-foreground" />
						{:else}
							<ChevronDown class="w-4 h-4 text-muted-foreground" />
						{/if}
					</div>
				</button>

				{#if expandedIncidents.has(incident.id)}
					<div class="border-t">
						{#if incident.sampleLogs.length === 0}
							<div class="px-3 py-4 text-center text-sm text-muted-foreground">
								No sample logs available
							</div>
						{:else}
							<div class="divide-y">
								{#each incident.sampleLogs as log}
									<div class="px-3 py-2 text-xs">
										<div class="flex items-center gap-2 mb-1">
											<span class="font-mono text-muted-foreground">
												{formatLogTime(log.time)}
											</span>
											<Badge
												variant="outline"
												class={getLevelColor(log.level)}
											>
												{log.level}
											</Badge>
											<span class="text-muted-foreground font-mono">
												{log.service}
											</span>
										</div>
										<p class="text-foreground truncate max-w-full">
											{log.message}
										</p>
									</div>
								{/each}
							</div>
							<div class="px-3 py-2 text-xs text-center text-muted-foreground bg-muted/30">
								Showing {incident.sampleLogs.length} sample log{incident.sampleLogs.length !== 1 ? "s" : ""}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if incidents.length > 5}
			<p class="text-xs text-center text-muted-foreground pt-2">
				Showing 5 of {incidents.length} incidents
			</p>
		{/if}
	{/if}
</div>
