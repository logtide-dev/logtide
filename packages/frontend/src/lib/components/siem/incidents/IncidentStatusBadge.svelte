<script lang="ts">
	import type { IncidentStatus } from '$lib/api/siem';
	import { stateTone } from '$lib/utils/severity';
	import { INCIDENT_STATUS_LABEL, incidentStateKey } from './incident-model';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Search from '@lucide/svelte/icons/search';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';

	interface Props {
		status: IncidentStatus;
		showIcon?: boolean;
		size?: 'sm' | 'md';
	}

	let { status, showIcon = true, size = 'md' }: Props = $props();

	const known = $derived(Object.prototype.hasOwnProperty.call(INCIDENT_STATUS_LABEL, status));
	const label = $derived(known ? INCIDENT_STATUS_LABEL[status] : String(status));
	const tone = $derived(stateTone(known ? incidentStateKey(status) : String(status)));
	const Icon = $derived(
		status === 'investigating'
			? Search
			: status === 'resolved'
				? CheckCircle
				: status === 'false_positive'
					? XCircle
					: AlertCircle
	);
</script>

<span
	class="inline-flex items-center rounded-full border font-medium whitespace-nowrap {tone.badge} {size === 'sm'
		? 'text-xs px-1.5 py-0.5'
		: 'text-xs px-2.5 py-0.5'}"
>
	{#if showIcon}
		<Icon class="w-3 h-3 mr-1" aria-hidden="true" />
	{/if}
	{label}
</span>
