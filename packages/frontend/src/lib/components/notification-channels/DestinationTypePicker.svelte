<script lang="ts">
	import DestinationTypeIcon from './DestinationTypeIcon.svelte';
	import { DESTINATION_TYPES, type DestinationTypeId } from './destination-types';

	interface Props {
		onSelect: (type: DestinationTypeId) => void;
		disabled?: boolean;
	}

	let { onSelect, disabled = false }: Props = $props();
</script>

<div class="grid gap-2 sm:grid-cols-2" role="group" aria-label="Destination type">
	{#each DESTINATION_TYPES as type (type.id)}
		<button
			type="button"
			class="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
			{disabled}
			onclick={() => onSelect(type.id)}
		>
			<DestinationTypeIcon type={type.id} />
			<span class="min-w-0">
				<span class="block text-sm font-medium">{type.label}</span>
				<span class="block text-xs text-muted-foreground">{type.description}</span>
			</span>
		</button>
	{/each}
</div>
