<script lang="ts">
	// Test stub: exposes the open state and the prefill so workspace tests can assert on them.
	interface Props {
		open: boolean;
		organizationId: string;
		projectId?: string | null;
		initialValues?: unknown;
	}
	let { open = $bindable(), projectId = null, initialValues }: Props = $props();
</script>

{#if open}
	<div data-testid="create-dialog" data-project={projectId ?? ''}>
		<pre data-testid="create-prefill">{JSON.stringify(initialValues ?? null)}</pre>
	</div>
{/if}
