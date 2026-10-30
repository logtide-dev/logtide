<script lang="ts">
	import type { Severity } from '$lib/api/siem';
	import { severityTone } from '$lib/utils/severity';

	interface Props {
		severity: Severity;
		size?: 'sm' | 'md';
	}

	let { severity, size = 'md' }: Props = $props();

	// Short labels for the SIEM views; colours come from the severity module.
	const LABELS: Record<string, string> = {
		critical: 'Critical',
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		informational: 'Info',
	};

	const tone = $derived(severityTone(severity));
	const label = $derived(Object.prototype.hasOwnProperty.call(LABELS, severity) ? LABELS[severity] : severity);
</script>

<span
	class="inline-flex items-center rounded-full border font-medium whitespace-nowrap {tone.badge} {size === 'sm'
		? 'text-xs px-1.5 py-0.5'
		: 'text-xs px-2.5 py-0.5'}"
>
	{label}
</span>
