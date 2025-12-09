<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { TopThreat } from '$lib/api/siem';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	interface Props {
		threats: TopThreat[] | undefined;
		onThreatClick?: (threat: TopThreat) => void;
	}

	let { threats, onThreatClick }: Props = $props();

	const maxCount = $derived(threats ? Math.max(...threats.map((t) => t.count), 1) : 1);

	function getSeverityColor(severity: string): string {
		switch (severity) {
			case 'critical':
				return 'bg-purple-500';
			case 'high':
				return 'bg-red-500';
			case 'medium':
				return 'bg-orange-500';
			case 'low':
				return 'bg-blue-500';
			default:
				return 'bg-gray-500';
		}
	}
</script>

<Card class="h-full">
	<CardHeader class="pb-2">
		<CardTitle class="text-sm font-semibold flex items-center gap-2">
			<AlertTriangle class="w-4 h-4 text-destructive" />
			Top Threats
		</CardTitle>
	</CardHeader>
	<CardContent class="pt-0">
		{#if !threats || threats.length === 0}
			<div class="text-center py-6 text-muted-foreground">
				<AlertTriangle class="w-6 h-6 mx-auto mb-2 opacity-50" />
				<p class="text-xs">No threats detected</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each threats.slice(0, 5) as threat}
					<button
						class="w-full text-left group"
						onclick={() => onThreatClick?.(threat)}
					>
						<div class="flex items-center justify-between mb-1">
							<span class="text-xs truncate flex-1 mr-2 group-hover:text-primary transition-colors" title={threat.ruleTitle}>
								{threat.ruleTitle}
							</span>
							<span class="text-xs font-semibold text-muted-foreground">{threat.count}</span>
						</div>
						<div class="h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								class="h-full rounded-full transition-all {getSeverityColor(threat.severity)}"
								style="width: {(threat.count / maxCount) * 100}%"
							></div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
