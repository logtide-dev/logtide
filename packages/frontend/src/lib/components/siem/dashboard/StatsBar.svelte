<script lang="ts">
	import type { DashboardStats } from '$lib/api/siem';
	import { severityTone } from '$lib/utils/severity';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Shield from '@lucide/svelte/icons/shield';
	import Activity from '@lucide/svelte/icons/activity';

	interface Props {
		stats: DashboardStats | null;
	}

	let { stats }: Props = $props();

	function formatNumber(num: number): string {
		if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
		if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
		return num.toLocaleString('en-US');
	}

	const SEVERITIES = [
		{ key: 'critical', label: 'Critical' },
		{ key: 'high', label: 'High' },
		{ key: 'medium', label: 'Medium' },
		{ key: 'low', label: 'Low' },
	] as const;

	// Calculate severity counts from severityDistribution
	const severityCounts = $derived.by(() => {
		const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
		if (!stats?.severityDistribution) return counts;
		for (const item of stats.severityDistribution) {
			if (item.severity in counts) {
				counts[item.severity] = item.count;
			}
		}
		return counts;
	});
</script>

<div class="p-3 rounded-lg border bg-card">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<!-- Severity breakdown -->
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4 lg:flex lg:items-center lg:gap-6">
			{#each SEVERITIES as sev (sev.key)}
				<div class="flex items-center gap-2">
					<div
						data-testid="severity-dot"
						class="w-2.5 h-2.5 rounded-full flex-shrink-0 {severityTone(sev.key).dot}"
					></div>
					<span class="text-base font-bold sm:text-lg">{formatNumber(severityCounts[sev.key])}</span>
					<span class="text-xs text-muted-foreground sm:text-sm">{sev.label}</span>
				</div>
			{/each}
		</div>

		<!-- Summary stats -->
		<div class="flex flex-wrap items-center gap-3 text-sm sm:gap-4 lg:gap-6 border-t pt-3 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-6">
			<div class="flex items-center gap-1.5">
				<Activity class="w-4 h-4 text-muted-foreground" />
				<span class="font-semibold">{formatNumber(stats?.totalDetections || 0)}</span>
				<span class="text-muted-foreground hidden sm:inline">detections</span>
			</div>
			<div class="flex items-center gap-1.5">
				<Shield class="w-4 h-4 text-muted-foreground" />
				<span class="font-semibold">{formatNumber(stats?.totalIncidents || 0)}</span>
				<span class="text-muted-foreground hidden sm:inline">incidents</span>
			</div>
			<div class="flex items-center gap-1.5">
				<ShieldAlert class="w-4 h-4 text-warning-text" />
				<span class="font-semibold text-warning-text">{formatNumber(stats?.openIncidents || 0)}</span>
				<span class="text-muted-foreground hidden sm:inline">open</span>
			</div>
		</div>
	</div>
</div>
