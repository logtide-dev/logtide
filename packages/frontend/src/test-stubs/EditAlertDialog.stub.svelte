<script lang="ts">
	// Test stub: exposes the open state and the rule being edited.
	interface Props {
		open: boolean;
		organizationId: string;
		alert: { id: string; name: string } | null;
	}
	let { open = $bindable(), alert }: Props = $props();
</script>

{#if open && alert}
	<div data-testid="edit-dialog" data-rule={alert.id}>{alert.name}</div>
{/if}
