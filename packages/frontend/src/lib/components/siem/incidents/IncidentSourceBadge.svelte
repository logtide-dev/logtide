<script lang="ts">
	import { NEUTRAL_TONE } from '$lib/utils/severity';
	import { INCIDENT_SOURCE_LABEL } from './incident-model';
	import type { IncidentSource } from '$lib/api/incidents';

	interface Props {
		source: string;
	}

	let { source }: Props = $props();

	const label = $derived(
		Object.prototype.hasOwnProperty.call(INCIDENT_SOURCE_LABEL, source)
			? INCIDENT_SOURCE_LABEL[source as IncidentSource]
			: source
	);
</script>

<span
	class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap {NEUTRAL_TONE.badge}"
	data-testid="incident-source-badge"
>
	{label}
</span>
