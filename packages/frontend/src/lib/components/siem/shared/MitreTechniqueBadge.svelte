<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { getTechniqueName, getMitreUrl } from '$lib/utils/mitre';

	interface Props {
		technique: string;
	}

	let { technique }: Props = $props();

	// Format technique ID (e.g., T1059.001 -> T1059.001)
	function formatTechnique(t: string): string {
		if (t.match(/^T\d{4}(\.\d{3})?$/i)) {
			return t.toUpperCase();
		}
		return t;
	}

	const displayId = $derived(formatTechnique(technique));
	const techniqueName = $derived(getTechniqueName(technique));
	const hasName = $derived(techniqueName !== technique);
	const mitreUrl = $derived(getMitreUrl(technique));

	// Show name, tooltip shows ID
	const displayText = $derived(hasName ? techniqueName : displayId);
	const tooltipText = $derived(hasName ? displayId : '');
</script>

<a
	href={mitreUrl}
	target="_blank"
	rel="noopener noreferrer"
	class="inline-block"
	title={tooltipText}
>
	<Badge
		variant="secondary"
		class="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
	>
		{displayText}
	</Badge>
</a>
