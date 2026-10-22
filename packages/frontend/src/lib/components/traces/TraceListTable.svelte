<script lang="ts">
  import DataTable from '$lib/components/app/DataTable.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Pagination from '$lib/components/app/Pagination.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import type { TraceRecord } from '$lib/api/traces';
  import { traceDetailUrl } from '$lib/utils/trace-links';
  import { formatDuration } from './format';

  interface Props {
    traces: TraceRecord[];
    projectId: string;
    loading: boolean;
    total: number;
    page: number;
    pageSize: number;
    sortBy: 'start_time' | 'duration';
    sortOrder: 'asc' | 'desc';
    filtersActive: boolean;
    error?: string | null;
    onSort: (sortBy: 'start_time' | 'duration', sortOrder: 'asc' | 'desc') => void;
    onPageChange: (page: number) => void;
    onClearFilters: () => void;
    onOpen: (traceId: string) => void;
    onRetry?: () => void;
  }

  let {
    traces,
    projectId,
    loading,
    total,
    page,
    pageSize,
    sortBy,
    sortOrder,
    filtersActive,
    error = null,
    onSort,
    onPageChange,
    onClearFilters,
    onOpen,
    onRetry,
  }: Props = $props();

  const KEY_TO_SORT: Record<string, 'start_time' | 'duration'> = {
    start: 'start_time',
    duration: 'duration',
  };

  const currentKey = $derived(sortBy === 'duration' ? 'duration' : 'start');

  function getSort(): DataTableSort {
    return { key: currentKey, dir: sortOrder };
  }

  // A new column starts descending (slowest and newest first); the table then
  // toggles direction on repeated clicks.
  function setSort(next: DataTableSort | undefined) {
    if (!next) return;
    const mapped = KEY_TO_SORT[next.key];
    if (!mapped) return;
    const dir = next.key !== currentKey ? 'desc' : next.dir;
    onSort(mapped, dir);
  }

  const columns: DataTableColumn<TraceRecord>[] = [
    { key: 'start', header: 'Start', sortable: true, cell: startCell },
    { key: 'service', header: 'Root service', cell: serviceCell },
    { key: 'operation', header: 'Operation', cell: operationCell },
    { key: 'duration', header: 'Duration', sortable: true, class: 'text-right', cell: durationCell },
    { key: 'spans', header: 'Spans', class: 'text-right', cell: spansCell },
    { key: 'status', header: 'Status', cell: statusCell },
  ];
</script>

{#snippet startCell(t: TraceRecord)}
  <Timestamp value={t.start_time} precision="ms" />
{/snippet}

{#snippet serviceCell(t: TraceRecord)}
  <span class="text-sm">{t.root_service_name ?? t.service_name}</span>
{/snippet}

{#snippet operationCell(t: TraceRecord)}
  <a
    href={traceDetailUrl(t.trace_id, projectId)}
    class="block max-w-[28rem] truncate font-mono text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    title={t.root_operation_name ?? t.trace_id}
    onclick={() => onOpen(t.trace_id)}
  >
    {t.root_operation_name ?? t.trace_id}
  </a>
{/snippet}

{#snippet durationCell(t: TraceRecord)}
  <span class="tabular-nums">{formatDuration(t.duration_ms)}</span>
{/snippet}

{#snippet spansCell(t: TraceRecord)}
  <span class="tabular-nums">{t.span_count.toLocaleString('en-US')}</span>
{/snippet}

{#snippet statusCell(t: TraceRecord)}
  <SeverityBadge kind="state" value={t.error ? 'failed' : 'ok'} />
{/snippet}

{#snippet emptyRows()}
  {#if filtersActive}
    <EmptyState variant="no-results" title="No traces match these filters">
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={onClearFilters}>Clear filters</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState variant="no-data" title="No traces in this range" />
  {/if}
{/snippet}

{#if error}
  <EmptyState variant="error" title="Could not load traces" description={error}>
    {#snippet actions()}
      {#if onRetry}
        <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="space-y-3">
    <DataTable
      {columns}
      rows={traces}
      rowKey={(t: TraceRecord) => t.trace_id}
      {loading}
      bind:sort={getSort, setSort}
      empty={emptyRows}
    />
    <Pagination {page} {pageSize} {total} {onPageChange} />
  </div>
{/if}
