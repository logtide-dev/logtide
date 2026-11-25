<script lang="ts">
	// Test stub: exposes the open state, the mode and the metric rule.
	interface Props {
		open: boolean;
		organizationId: string;
		rule?: { id: string; name: string } | null;
		mode?: 'create' | 'edit';
	}
	let { open = $bindable(), rule = null, mode = 'create' }: Props = $props();
</script>

{#if open}
	<div data-testid="metric-dialog" data-rule={rule?.id ?? ''} data-mode={mode}>{rule?.name ?? ''}</div>
{/if}
