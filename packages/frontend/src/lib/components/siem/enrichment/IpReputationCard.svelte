<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import Shield from '@lucide/svelte/icons/shield';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';

	interface IpReputationEntry {
		ip: string;
		reputation: 'clean' | 'suspicious' | 'malicious';
		abuseConfidenceScore?: number;
		country?: string;
		isp?: string;
		domain?: string;
		usageType?: string;
		source: string;
		lastChecked: string;
	}

	interface Props {
		ipReputation: Record<string, IpReputationEntry>;
	}

	let { ipReputation }: Props = $props();

	let expandedIps = $state<Set<string>>(new Set());

	const ipEntries = $derived(Object.entries(ipReputation));

	function getReputationConfig(reputation: string) {
		switch (reputation) {
			case 'clean':
				return {
					color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
					icon: CheckCircle2,
					label: 'Clean',
				};
			case 'suspicious':
				return {
					color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
					icon: AlertCircle,
					label: 'Suspicious',
				};
			case 'malicious':
				return {
					color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
					icon: AlertTriangle,
					label: 'Malicious',
				};
			default:
				return {
					color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
					icon: Shield,
					label: 'Unknown',
				};
		}
	}

	function formatTimestamp(timestamp: string): string {
		const date = new Date(timestamp);
		if (isNaN(date.getTime())) {
			return 'Unknown';
		}
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	function toggleExpand(ip: string) {
		const newSet = new Set(expandedIps);
		if (newSet.has(ip)) {
			newSet.delete(ip);
		} else {
			newSet.add(ip);
		}
		expandedIps = newSet;
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Shield class="w-4 h-4" />
			IP Reputation
			<Badge variant="secondary" class="ml-auto">{ipEntries.length}</Badge>
		</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="space-y-3">
			{#each ipEntries as [ip, data]}
				{@const config = getReputationConfig(data.reputation)}
				{@const isExpanded = expandedIps.has(ip)}
				<div class="border rounded-lg p-3">
					<button
						type="button"
						class="w-full flex items-center gap-3 text-left"
						aria-expanded={isExpanded}
						onclick={() => toggleExpand(ip)}
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-mono text-sm font-medium">{ip}</span>
								<Badge class={config.color}>
									<svelte:component this={config.icon} class="w-3 h-3 mr-1" />
									{config.label}
								</Badge>
								{#if data.reputation === 'malicious'}
									<AlertTriangle class="w-4 h-4 text-red-500" />
								{/if}
							</div>
							{#if data.abuseConfidenceScore !== undefined}
								<div class="mt-2 flex items-center gap-2">
									<span class="text-xs text-muted-foreground">Score:</span>
									<div class="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[100px]">
										<div
											class="h-full rounded-full transition-all"
											class:bg-green-500={data.abuseConfidenceScore < 30}
											class:bg-yellow-500={data.abuseConfidenceScore >= 30 &&
												data.abuseConfidenceScore < 70}
											class:bg-red-500={data.abuseConfidenceScore >= 70}
											style="width: {data.abuseConfidenceScore}%"
										></div>
									</div>
									<span class="text-xs font-medium">{data.abuseConfidenceScore}%</span>
								</div>
							{/if}
						</div>
						{#if isExpanded}
							<ChevronUp class="w-4 h-4 text-muted-foreground shrink-0" />
						{:else}
							<ChevronDown class="w-4 h-4 text-muted-foreground shrink-0" />
						{/if}
					</button>

					{#if isExpanded}
						<div class="mt-3 pt-3 border-t space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Source</span>
								<span class="font-medium">{data.source}</span>
							</div>
							{#if data.country}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Country</span>
									<span>{data.country}</span>
								</div>
							{/if}
							{#if data.isp}
								<div class="flex justify-between">
									<span class="text-muted-foreground">ISP</span>
									<span class="text-right max-w-[60%] truncate">{data.isp}</span>
								</div>
							{/if}
							{#if data.domain}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Domain</span>
									<span>{data.domain}</span>
								</div>
							{/if}
							{#if data.usageType}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Usage Type</span>
									<span>{data.usageType}</span>
								</div>
							{/if}
							<div class="flex justify-between">
								<span class="text-muted-foreground">Last Checked</span>
								<span>{formatTimestamp(data.lastChecked)}</span>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</CardContent>
</Card>
