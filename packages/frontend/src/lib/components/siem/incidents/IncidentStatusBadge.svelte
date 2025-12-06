<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { IncidentStatus } from '$lib/api/siem';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Search from '@lucide/svelte/icons/search';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import type { ComponentType } from 'svelte';

	interface Props {
		status: IncidentStatus;
		showIcon?: boolean;
		size?: 'sm' | 'md';
	}

	let { status, showIcon = true, size = 'md' }: Props = $props();

	interface StatusConfig {
		color: string;
		label: string;
		icon: ComponentType;
	}

	function getStatusConfig(s: IncidentStatus): StatusConfig {
		switch (s) {
			case 'open':
				return {
					color: 'bg-yellow-500 text-black hover:bg-yellow-600',
					label: 'Open',
					icon: AlertCircle,
				};
			case 'investigating':
				return {
					color: 'bg-blue-500 text-white hover:bg-blue-600',
					label: 'Investigating',
					icon: Search,
				};
			case 'resolved':
				return {
					color: 'bg-green-500 text-white hover:bg-green-600',
					label: 'Resolved',
					icon: CheckCircle,
				};
			case 'false_positive':
				return {
					color: 'bg-gray-500 text-white hover:bg-gray-600',
					label: 'False Positive',
					icon: XCircle,
				};
			default:
				return {
					color: 'bg-gray-500 text-white hover:bg-gray-600',
					label: s,
					icon: AlertCircle,
				};
		}
	}

	const config = $derived(getStatusConfig(status));
</script>

<Badge class="{config.color} {size === 'sm' ? 'text-xs px-1.5 py-0.5' : ''}">
	{#if showIcon}
		<config.icon class="w-3 h-3 mr-1" />
	{/if}
	{config.label}
</Badge>
