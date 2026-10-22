<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IncidentListItem, OrganizationMemberWithUser } from '@logtide/shared';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import Pagination from '$lib/components/app/Pagination.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import IncidentStatusBadge from './IncidentStatusBadge.svelte';
	import IncidentSourceBadge from './IncidentSourceBadge.svelte';
	import { incidentLastEventAt } from './incident-model';

	interface Props {
		incidents: IncidentListItem[];
		members: OrganizationMemberWithUser[];
		projectNames: Record<string, string>;
		loading: boolean;
		selected?: string[];
		total: number;
		page: number;
		pageSize: number;
		onPageChange: (page: number) => void;
		empty?: Snippet;
	}

	let {
		incidents,
		members,
		projectNames,
		loading,
		selected = $bindable([]),
		total,
		page,
		pageSize,
		onPageChange,
		empty,
	}: Props = $props();

	function projectLabel(i: IncidentListItem): string {
		if (!i.projectId) return 'All projects';
		return i.project?.name ?? projectNames[i.projectId] ?? 'Unknown project';
	}

	function assigneeOf(i: IncidentListItem): { name: string; email?: string } | null {
		if (!i.assigneeId) return null;
		const member = members.find((m) => m.user.id === i.assigneeId);
		if (member) return { name: member.user.name || member.user.email, email: member.user.email };
		// Left the organization: never blank.
		return { name: 'Unknown user' };
	}

	const columns: DataTableColumn<IncidentListItem>[] = [
		{ key: 'status', header: 'Status', cell: statusCell },
		{ key: 'severity', header: 'Severity', cell: severityCell },
		{ key: 'title', header: 'Title', class: 'min-w-[16rem]', cell: titleCell },
		{ key: 'source', header: 'Source', cell: sourceCell },
		{ key: 'project', header: 'Project', cell: projectCell },
		{ key: 'assignee', header: 'Assignee', cell: assigneeCell },
		{ key: 'age', header: 'Age', cell: ageCell },
		{ key: 'lastEvent', header: 'Last event', cell: lastEventCell },
	];
</script>

{#snippet statusCell(i: IncidentListItem)}
	<IncidentStatusBadge status={i.status} size="sm" />
{/snippet}

{#snippet severityCell(i: IncidentListItem)}
	<SeverityBadge kind="severity" value={i.severity} />
{/snippet}

{#snippet titleCell(i: IncidentListItem)}
	<a href="/dashboard/incidents/{i.id}" class="font-medium hover:underline">{i.title}</a>
{/snippet}

{#snippet sourceCell(i: IncidentListItem)}
	<IncidentSourceBadge source={i.source} />
{/snippet}

{#snippet projectCell(i: IncidentListItem)}
	<span class={i.projectId ? '' : 'text-muted-foreground'}>{projectLabel(i)}</span>
{/snippet}

{#snippet assigneeCell(i: IncidentListItem)}
	{@const a = assigneeOf(i)}
	{#if a}
		<span class="inline-flex items-center gap-2">
			<Avatar name={a.name} email={a.email} size="sm" />
			<span class="truncate max-w-[9rem]">{a.name}</span>
		</span>
	{:else}
		<span class="text-muted-foreground">Unassigned</span>
	{/if}
{/snippet}

{#snippet ageCell(i: IncidentListItem)}
	<Timestamp value={i.createdAt} relative />
{/snippet}

{#snippet lastEventCell(i: IncidentListItem)}
	<Timestamp value={incidentLastEventAt(i)} precision="minute" showZone />
{/snippet}

<div class="space-y-3">
	<DataTable
		{columns}
		rows={incidents}
		rowKey={(i: IncidentListItem) => i.id}
		{loading}
		selectable
		bind:selected
		{empty}
	/>
	<Pagination {page} {pageSize} {total} {onPageChange} />
</div>
