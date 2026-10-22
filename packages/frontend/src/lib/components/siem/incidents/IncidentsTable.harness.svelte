<script lang="ts">
	// Test harness: binds `selected` so tests can observe it.
	import type { Snippet } from 'svelte';
	import IncidentsTable from './IncidentsTable.svelte';

	interface Props {
		incidents: unknown[];
		members?: unknown[];
		loading?: boolean;
		withEmpty?: boolean;
	}

	let { incidents, members = [], loading = false, withEmpty = false }: Props = $props();
	let selected = $state<string[]>([]);
</script>

<IncidentsTable
	incidents={incidents as never}
	members={members as never}
	projectNames={{ p1: 'Project One' }}
	{loading}
	bind:selected
	total={incidents.length}
	page={1}
	pageSize={25}
	onPageChange={() => {}}
	empty={withEmpty ? (emptySlot as unknown as Snippet) : undefined}
/>
<pre data-testid="selected">{JSON.stringify(selected)}</pre>

{#snippet emptySlot()}
	<span>Nothing here</span>
{/snippet}
