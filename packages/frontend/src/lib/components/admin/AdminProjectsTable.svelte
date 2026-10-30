<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ProjectBasic } from '$lib/api/admin';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from '$lib/components/ui/button';
  import { formatCount } from '$lib/utils/format-number';

  interface Props {
    projects: ProjectBasic[];
    sort?: DataTableSort;
    loading?: boolean;
    empty?: Snippet;
    onDelete: (project: ProjectBasic) => void;
  }

  let { projects, sort = $bindable(undefined), loading = false, empty, onDelete }: Props = $props();

  const asCell = (s: unknown) => s as Snippet<[ProjectBasic]>;

  function logsOf(p: ProjectBasic): number {
    return p.logs30d ?? p.logsCount;
  }

  function rulesLabel(p: ProjectBasic): string {
    const total = p.alertRulesTotal ?? p.alertRulesCount;
    const enabled = p.alertRulesEnabled ?? total;
    return `${formatCount(enabled)} / ${formatCount(total)}`;
  }

  const columns: DataTableColumn<ProjectBasic>[] = [
    { key: 'name', header: 'Project', sortable: true, class: 'min-w-[12rem] max-w-[22rem]', cell: asCell(nameCell) },
    { key: 'organization', header: 'Organization', sortable: true, class: 'min-w-[10rem]', cell: asCell(orgCell) },
    { key: 'logs', header: 'Logs (30d)', class: 'text-right tabular-nums', cell: asCell(logsCell) },
    { key: 'keys', header: 'API keys', class: 'text-right tabular-nums', cell: asCell(keysCell) },
    { key: 'rules', header: 'Alert rules (enabled / total)', class: 'text-right tabular-nums', cell: asCell(rulesCell) },
    { key: 'created_at', header: 'Created', sortable: true, class: 'whitespace-nowrap', cell: asCell(createdCell) },
    { key: 'actions', header: '', class: 'w-[1%] whitespace-nowrap text-right', cell: asCell(actionsCell) },
  ];
</script>

{#snippet nameCell(p: ProjectBasic)}
  <div class="min-w-0">
    <div class="flex items-center gap-2">
      <a
        href="/dashboard/admin/projects/{p.id}"
        class="truncate font-medium underline-offset-4 hover:text-primary hover:underline"
      >
        {p.name}
      </a>
      {#if p.deletedAt}
        <Badge variant="outline">Deleted</Badge>
      {/if}
    </div>
    {#if p.description}
      <p class="line-clamp-1 text-xs text-muted-foreground" title={p.description}>{p.description}</p>
    {/if}
  </div>
{/snippet}

{#snippet orgCell(p: ProjectBasic)}
  <a
    href="/dashboard/admin/organizations/{p.organizationId ?? p.organization_id}"
    class="underline-offset-4 hover:text-primary hover:underline"
  >
    {p.organization_name}
  </a>
{/snippet}

{#snippet logsCell(p: ProjectBasic)}{formatCount(logsOf(p))}{/snippet}
{#snippet keysCell(p: ProjectBasic)}{formatCount(p.apiKeysCount)}{/snippet}
{#snippet rulesCell(p: ProjectBasic)}{rulesLabel(p)}{/snippet}

{#snippet createdCell(p: ProjectBasic)}
  <span class="text-muted-foreground"><Timestamp value={p.created_at} precision="minute" /></span>
{/snippet}

{#snippet actionsCell(p: ProjectBasic)}
  {#if !p.deletedAt}
    <Button variant="ghost" size="sm" class="text-destructive-text" onclick={() => onDelete(p)}>Delete</Button>
  {/if}
{/snippet}

{#snippet mobileRow(p: ProjectBasic)}
  <div class="space-y-1.5">
    <div class="flex items-start justify-between gap-2">
      <a href="/dashboard/admin/projects/{p.id}" class="min-w-0 truncate font-medium hover:text-primary">{p.name}</a>
      {#if p.deletedAt}<Badge variant="outline">Deleted</Badge>{/if}
    </div>
    <p class="text-xs text-muted-foreground">{p.organization_name}</p>
    <p class="text-xs text-muted-foreground">
      {formatCount(logsOf(p))} logs (30d) - {formatCount(p.apiKeysCount)} keys - {rulesLabel(p)} rules
    </p>
    {#if !p.deletedAt}
      <Button variant="ghost" size="sm" class="text-destructive-text" onclick={() => onDelete(p)}>Delete project</Button>
    {/if}
  </div>
{/snippet}

<DataTable
  {columns}
  rows={projects}
  {loading}
  rowKey={(p) => p.id}
  bind:sort
  mobileRow={asCell(mobileRow)}
  {empty}
/>
