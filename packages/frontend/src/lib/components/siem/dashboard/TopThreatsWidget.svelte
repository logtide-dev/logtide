<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import SeverityBadge from '../shared/SeverityBadge.svelte';
	import MitreTacticBadge from '../shared/MitreTacticBadge.svelte';
	import type { TopThreat } from '$lib/api/siem';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import TrendingUp from '@lucide/svelte/icons/trending-up';

	interface Props {
		threats: TopThreat[] | undefined;
		onThreatClick?: (threat: TopThreat) => void;
	}

	let { threats, onThreatClick }: Props = $props();
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<AlertTriangle class="w-4 h-4 text-destructive" />
			Top Threats
		</CardTitle>
		<Badge variant="secondary" class="text-xs">
			{threats?.length || 0} rules
		</Badge>
	</CardHeader>
	<CardContent>
		{#if !threats || threats.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<AlertTriangle class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No threats detected</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each threats.slice(0, 10) as threat, index}
					<button
						class="w-full text-left p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
						onclick={() => onThreatClick?.(threat)}
					>
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<span
										class="text-xs font-mono text-muted-foreground w-4 flex-shrink-0"
									>
										#{index + 1}
									</span>
									<span class="font-medium truncate">{threat.ruleTitle}</span>
								</div>
								<div class="flex items-center gap-2 ml-6">
									<SeverityBadge severity={threat.severity} size="sm" />
									{#if threat.mitreTactics && threat.mitreTactics.length > 0}
										{#each threat.mitreTactics.slice(0, 2) as tactic}
											<MitreTacticBadge {tactic} />
										{/each}
										{#if threat.mitreTactics.length > 2}
											<Badge variant="outline" class="text-xs">
												+{threat.mitreTactics.length - 2}
											</Badge>
										{/if}
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-1 text-sm font-semibold flex-shrink-0">
								<TrendingUp class="w-3 h-3 text-destructive" />
								{threat.count}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
