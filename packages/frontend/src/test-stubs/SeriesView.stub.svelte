<script lang="ts">
	// Test stub for MetricSeriesView.
	let { error = null }: { error?: string | null } = $props();
</script>

<div data-testid="series-view">{error ?? ""}</div>
