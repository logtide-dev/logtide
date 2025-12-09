<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { AffectedService } from '$lib/api/siem';
	import Server from '@lucide/svelte/icons/server';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	interface Props {
		services: AffectedService[] | undefined;
		onServiceClick?: (service: AffectedService) => void;
	}

	let { services, onServiceClick }: Props = $props();
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Server class="w-4 h-4 text-primary" />
			Affected Services
		</CardTitle>
		<Badge variant="secondary" class="text-xs">
			{services?.length || 0} services
		</Badge>
	</CardHeader>
	<CardContent>
		{#if !services || services.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<Server class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No services affected</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each services.slice(0, 8) as service}
					<button
						class="w-full text-left p-2 rounded-md hover:bg-accent/50 transition-colors"
						onclick={() => onServiceClick?.(service)}
					>
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2 min-w-0">
								<Server class="w-4 h-4 text-muted-foreground flex-shrink-0" />
								<span class="font-mono text-sm truncate">{service.serviceName}</span>
							</div>
							<div class="flex items-center gap-2 flex-shrink-0">
								{#if service.criticalCount > 0}
									<Badge variant="destructive" class="text-xs px-1.5 py-0.5">
										{service.criticalCount} critical
									</Badge>
								{/if}
								{#if service.highCount > 0}
									<Badge
										class="bg-red-500 text-white text-xs px-1.5 py-0.5 hover:bg-red-600"
									>
										{service.highCount} high
									</Badge>
								{/if}
								<div class="flex items-center gap-1 text-sm text-muted-foreground">
									<AlertTriangle class="w-3 h-3" />
									<span>{service.detectionCount}</span>
								</div>
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
