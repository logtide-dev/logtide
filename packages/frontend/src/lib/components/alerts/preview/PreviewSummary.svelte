<script lang="ts">
	import type { PreviewRange } from "$lib/api/alerts";
	import { Badge } from "$lib/components/ui/badge";
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
	import CheckCircle from "@lucide/svelte/icons/check-circle";
	import Clock from "@lucide/svelte/icons/clock";

	interface Props {
		totalTriggers: number;
		totalIncidents: number;
		timeRange: PreviewRange;
		avgDuration: number;
		affectedServices: string[];
	}

	let {
		totalTriggers,
		totalIncidents,
		timeRange,
		avgDuration,
		affectedServices,
	}: Props = $props();

	const rangeDays = $derived(
		{ "1d": 1, "7d": 7, "14d": 14, "30d": 30 }[timeRange]
	);

	const incidentsPerDay = $derived(
		rangeDays > 0 ? Math.round((totalIncidents / rangeDays) * 10) / 10 : 0
	);

	// Determine severity based on incident frequency
	const severity = $derived.by(() => {
		if (totalIncidents === 0) return "none";
		if (incidentsPerDay > 5) return "high";
		if (incidentsPerDay > 2) return "medium";
		return "low";
	});

	const severityConfig = $derived.by(() => {
		switch (severity) {
			case "high":
				return {
					label: "Very Noisy",
					color: "bg-red-100 text-red-800 border-red-200",
					icon: AlertTriangle,
				};
			case "medium":
				return {
					label: "Moderate",
					color: "bg-yellow-100 text-yellow-800 border-yellow-200",
					icon: Clock,
				};
			case "low":
				return {
					label: "Reasonable",
					color: "bg-green-100 text-green-800 border-green-200",
					icon: CheckCircle,
				};
			default:
				return {
					label: "No Triggers",
					color: "bg-gray-100 text-gray-800 border-gray-200",
					icon: CheckCircle,
				};
		}
	});
</script>

<div class="rounded-lg border bg-card p-4">
	<div class="flex items-start justify-between">
		<div class="space-y-1">
			<div class="flex items-center gap-2">
				{#if totalIncidents > 0}
					<span class="text-2xl font-bold text-foreground">
						{totalIncidents}
					</span>
					<span class="text-sm text-muted-foreground">
						incident{totalIncidents !== 1 ? "s" : ""} in the last {rangeDays} day{rangeDays !== 1 ? "s" : ""}
					</span>
				{:else}
					<span class="text-lg font-medium text-muted-foreground">
						No triggers in the last {rangeDays} day{rangeDays !== 1 ? "s" : ""}
					</span>
				{/if}
			</div>

			{#if totalIncidents > 0}
				<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span>
						{totalTriggers} total trigger{totalTriggers !== 1 ? "s" : ""}
					</span>
					{#if avgDuration > 0}
						<span>Avg duration: {avgDuration} min</span>
					{/if}
					{#if affectedServices.length > 0}
						<span>
							{affectedServices.length} service{affectedServices.length !== 1 ? "s" : ""} affected
						</span>
					{/if}
				</div>
			{/if}
		</div>

		<Badge variant="outline" class={severityConfig.color}>
			<svelte:component
				this={severityConfig.icon}
				class="w-3 h-3 mr-1"
			/>
			{severityConfig.label}
		</Badge>
	</div>
</div>
