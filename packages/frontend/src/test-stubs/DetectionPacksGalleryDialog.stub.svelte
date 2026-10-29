<script lang="ts">
	// Test stub: exposes the open state and the categories it was given.
	interface Props {
		open: boolean;
		organizationId: string;
		categories?: string[];
	}
	let { open = $bindable(), categories = [] }: Props = $props();
</script>

{#if open}
	<div data-testid="packs-dialog" data-categories={categories.join(',')}></div>
{/if}
