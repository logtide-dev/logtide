<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { getTacticName, getMitreTacticUrl } from '$lib/utils/mitre';

	interface Props {
		tactic: string;
		showId?: boolean;
		clickable?: boolean;
	}

	let { tactic, showId = false, clickable = true }: Props = $props();

	function formatTactic(t: string): string {
		const name = getTacticName(t);
		return showId ? `${t}: ${name}` : name;
	}

	const displayName = $derived(formatTactic(tactic));
	const url = $derived(getMitreTacticUrl(tactic));
</script>

{#if clickable}
	<a href={url} target="_blank" rel="noopener noreferrer" class="hover:opacity-80 transition-opacity">
		<Badge variant="outline" class="text-xs font-mono cursor-pointer">
			{displayName}
		</Badge>
	</a>
{:else}
	<Badge variant="outline" class="text-xs font-mono">
		{displayName}
	</Badge>
{/if}
