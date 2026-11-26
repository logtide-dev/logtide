<script lang="ts">
	// Test stub for the Logs and Traces tabs of a source page.
	let { kind, name, projectIds, from, to }: { kind: string; name: string; projectIds: string[]; from: string; to: string } = $props();
</script>

<div data-testid="source-tab-stub" data-kind={kind} data-name={name} data-projects={projectIds.join(',')} data-from={from} data-to={to}></div>
