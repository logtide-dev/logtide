<script lang="ts">
	import StatsCard from '$lib/components/dashboard/StatsCard.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import type { DashboardStats } from '$lib/api/siem';

	interface Props {
		stats: DashboardStats | null;
	}

	let { stats }: Props = $props();

	function formatNumber(num: number): string {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1) + 'M';
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1) + 'K';
		}
		return num.toString();
	}
</script>

<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
	<StatsCard
		title="Total Detections"
		value={stats ? formatNumber(stats.totalDetections) : '0'}
		description="Security events detected"
		icon={AlertTriangle}
	/>
	<StatsCard
		title="Total Incidents"
		value={stats ? formatNumber(stats.totalIncidents) : '0'}
		description="Grouped security incidents"
		icon={Shield}
	/>
	<StatsCard
		title="Open Incidents"
		value={stats ? formatNumber(stats.openIncidents) : '0'}
		description="Requiring investigation"
		icon={ShieldAlert}
	/>
	<StatsCard
		title="Critical Incidents"
		value={stats ? formatNumber(stats.criticalIncidents) : '0'}
		description="High priority threats"
		icon={ShieldCheck}
	/>
</div>
