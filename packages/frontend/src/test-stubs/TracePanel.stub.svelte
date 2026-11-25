<script lang="ts">
	// Test stub for the dashboard trace panels.
	let { error = null }: { error?: string | null } = $props();
</script>

<div data-testid="trace-panel">{error ?? ""}</div>
