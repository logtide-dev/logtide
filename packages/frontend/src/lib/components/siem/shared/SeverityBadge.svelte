<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { Severity } from '$lib/api/siem';

	interface Props {
		severity: Severity;
		size?: 'sm' | 'md';
	}

	let { severity, size = 'md' }: Props = $props();

	function getSeverityConfig(sev: Severity): { color: string; label: string } {
		switch (sev) {
			case 'critical':
				return { color: 'bg-purple-500 text-white hover:bg-purple-600', label: 'Critical' };
			case 'high':
				return { color: 'bg-red-500 text-white hover:bg-red-600', label: 'High' };
			case 'medium':
				return { color: 'bg-orange-500 text-white hover:bg-orange-600', label: 'Medium' };
			case 'low':
				return { color: 'bg-yellow-500 text-black hover:bg-yellow-600', label: 'Low' };
			case 'informational':
				return { color: 'bg-blue-500 text-white hover:bg-blue-600', label: 'Info' };
			default:
				return { color: 'bg-gray-500 text-white hover:bg-gray-600', label: sev };
		}
	}

	const config = $derived(getSeverityConfig(severity));
</script>

<Badge class="{config.color} {size === 'sm' ? 'text-xs px-1.5 py-0.5' : ''}">
	{config.label}
</Badge>
