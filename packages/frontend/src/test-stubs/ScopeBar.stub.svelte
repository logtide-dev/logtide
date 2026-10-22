<script lang="ts">
	// Test stub for ScopeBar: the real one needs the full scope reconcile cycle.
	interface Props {
		mode: string;
		projects: { id: string; name: string }[];
		showTime?: boolean;
	}
	let { mode, projects }: Props = $props();
</script>

<div data-testid="scope-bar" data-mode={mode}>{projects.length} projects</div>
