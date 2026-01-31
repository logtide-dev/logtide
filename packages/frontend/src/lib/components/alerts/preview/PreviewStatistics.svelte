<script lang="ts">
	import type { PreviewStatistics } from "$lib/api/alerts";

	interface Props {
		byDayOfWeek: Array<{ day: string; count: number }>;
		byHourOfDay: Array<{ hour: number; count: number }>;
		thresholdAnalysis: PreviewStatistics["thresholdAnalysis"];
		incidentStats: PreviewStatistics["incidents"];
	}

	let {
		byDayOfWeek,
		byHourOfDay,
		thresholdAnalysis,
		incidentStats,
	}: Props = $props();

	const maxDayCount = $derived(Math.max(...byDayOfWeek.map((d) => d.count), 1));
	const maxHourCount = $derived(Math.max(...byHourOfDay.map((h) => h.count), 1));

	const totalIncidents = $derived(byDayOfWeek.reduce((sum, d) => sum + d.count, 0));
</script>

<div class="space-y-4">
	<!-- Threshold Analysis -->
	<div class="grid grid-cols-4 gap-2">
		<div class="text-center p-2 rounded bg-muted/50">
			<div class="text-lg font-semibold">{thresholdAnalysis.p50Value}</div>
			<div class="text-xs text-muted-foreground">P50 (Median)</div>
		</div>
		<div class="text-center p-2 rounded bg-muted/50">
			<div class="text-lg font-semibold">{thresholdAnalysis.p95Value}</div>
			<div class="text-xs text-muted-foreground">P95</div>
		</div>
		<div class="text-center p-2 rounded bg-muted/50">
			<div class="text-lg font-semibold">{thresholdAnalysis.p99Value}</div>
			<div class="text-xs text-muted-foreground">P99</div>
		</div>
		<div class="text-center p-2 rounded bg-muted/50">
			<div class="text-lg font-semibold">{thresholdAnalysis.percentAboveThreshold}%</div>
			<div class="text-xs text-muted-foreground">Above Threshold</div>
		</div>
	</div>

	<!-- Day of Week Distribution -->
	{#if totalIncidents > 0}
		<div>
			<h4 class="text-xs font-medium text-muted-foreground mb-2">
				By Day of Week
			</h4>
			<div class="flex gap-1 items-end h-16">
				{#each byDayOfWeek as day}
					<div class="flex-1 flex flex-col items-center gap-1">
						<div
							class="w-full bg-primary/80 rounded-t transition-all"
							style="height: {day.count > 0
								? Math.max((day.count / maxDayCount) * 48, 4)
								: 0}px"
							title="{day.day}: {day.count} incidents"
						></div>
						<span class="text-[10px] text-muted-foreground"
							>{day.day.slice(0, 2)}</span
						>
					</div>
				{/each}
			</div>
		</div>

		<!-- Hour of Day Distribution -->
		<div>
			<h4 class="text-xs font-medium text-muted-foreground mb-2">
				By Hour of Day (UTC)
			</h4>
			<div class="flex gap-[2px] items-end h-12">
				{#each byHourOfDay as hour}
					<div
						class="flex-1 bg-primary/60 rounded-t transition-all"
						style="height: {hour.count > 0
							? Math.max((hour.count / maxHourCount) * 40, 2)
							: 0}px"
						title="{hour.hour}:00 - {hour.count} incidents"
					></div>
				{/each}
			</div>
			<div class="flex justify-between text-[9px] text-muted-foreground mt-1">
				<span>0:00</span>
				<span>6:00</span>
				<span>12:00</span>
				<span>18:00</span>
				<span>23:00</span>
			</div>
		</div>

		<!-- Duration Stats -->
		{#if incidentStats.averageDuration > 0}
			<div class="pt-2 border-t">
				<h4 class="text-xs font-medium text-muted-foreground mb-2">
					Incident Duration
				</h4>
				<div class="grid grid-cols-3 gap-2 text-center">
					<div>
						<div class="text-sm font-medium">{incidentStats.minDuration} min</div>
						<div class="text-xs text-muted-foreground">Shortest</div>
					</div>
					<div>
						<div class="text-sm font-medium">{incidentStats.averageDuration} min</div>
						<div class="text-xs text-muted-foreground">Average</div>
					</div>
					<div>
						<div class="text-sm font-medium">{incidentStats.maxDuration} min</div>
						<div class="text-xs text-muted-foreground">Longest</div>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div class="text-center py-4 text-sm text-muted-foreground">
			No incident data to analyze temporal patterns.
		</div>
	{/if}
</div>
