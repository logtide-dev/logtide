<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { AffectedService } from '$lib/api/siem';
	import Server from '@lucide/svelte/icons/server';

	interface Props {
		services: AffectedService[] | undefined;
		onServiceClick?: (service: AffectedService) => void;
	}

	let { services, onServiceClick }: Props = $props();

	const maxCount = $derived(services ? Math.max(...services.map((s) => s.detectionCount), 1) : 1);

	function getBarColor(service: AffectedService): string {
		if (service.criticalCount > 0) return 'bg-purple-500';
		if (service.highCount > 0) return 'bg-red-500';
		return 'bg-blue-500';
	}
</script>

<Card class="h-full">
	<CardHeader class="pb-2">
		<CardTitle class="text-sm font-semibold flex items-center gap-2">
			<Server class="w-4 h-4 text-primary" />
			Affected Services
		</CardTitle>
	</CardHeader>
	<CardContent class="pt-0">
		{#if !services || services.length === 0}
			<div class="text-center py-6 text-muted-foreground">
				<Server class="w-6 h-6 mx-auto mb-2 opacity-50" />
				<p class="text-xs">No services affected</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each services.slice(0, 5) as service}
					<button
						class="w-full text-left group"
						onclick={() => onServiceClick?.(service)}
					>
						<div class="flex items-center justify-between mb-1">
							<span class="text-xs font-mono truncate flex-1 mr-2 group-hover:text-primary transition-colors">
								{service.serviceName}
							</span>
							<span class="text-xs font-semibold text-muted-foreground">{service.detectionCount}</span>
						</div>
						<div class="h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								class="h-full rounded-full transition-all {getBarColor(service)}"
								style="width: {(service.detectionCount / maxCount) * 100}%"
							></div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
