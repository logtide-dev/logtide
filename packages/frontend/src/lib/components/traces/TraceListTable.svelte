<script lang="ts">
  import DataTable from '$lib/components/app/DataTable.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Pagination from '$lib/components/app/Pagination.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Snippet } from 'svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import type { TraceRecord } from '$lib/api/traces';
  import { traceDetailUrl } from '$lib/utils/trace-links';
  import { isMobile } from '$lib/stores/media-query';
  import { formatRelative } from '$lib/utils/datetime';
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

  const SORT_OPTIONS = [
    { value: 'start_time:desc', label: 'Newest first' },
    { value: 'start_time:asc', label: 'Oldest first' },
    { value: 'duration:desc', label: 'Slowest first' },
    { value: 'duration:asc', label: 'Fastest first' },
  ];

  function onSortSelect(value: string) {
    const [by, dir] = value.split(':') as ['start_time' | 'duration', 'asc' | 'desc'];
    onSort(by, dir);
  }

  // svelte-check sees two Snippet types here; the runtime values are identical.
  const cell = (s: unknown) => s as DataTableColumn<TraceRecord>['cell'];
  const emptySnippet = emptyRows as unknown as Snippet;

  const columns: DataTableColumn<TraceRecord>[] = [
    { key: 'start', header: 'Start', sortable: true, cell: cell(startCell) },
    { key: 'service', header: 'Root service', cell: cell(serviceCell) },
    { key: 'operation', header: 'Operation', cell: cell(operationCell) },
    { key: 'duration', header: 'Duration', sortable: true, class: 'text-right', cell: cell(durationCell) },
    { key: 'spans', header: 'Spans', class: 'text-right', cell: cell(spansCell) },
    { key: 'status', header: 'Status', cell: cell(statusCell) },
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
    data-trace-link
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
    {#if $isMobile}
      <label class="grid gap-1 text-xs font-medium text-muted-foreground">
        Sort by
        <select
          class="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={`${sortBy}:${sortOrder}`}
          onchange={(e) => onSortSelect(e.currentTarget.value)}
        >
          {#each SORT_OPTIONS as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      </label>
      {#if loading}
        <div class="space-y-2" aria-busy="true">
          {#each [0, 1, 2, 3, 4] as i (i)}
            <div class="h-20 animate-pulse rounded-lg border bg-muted/40"></div>
          {/each}
        </div>
      {:else if traces.length === 0}
        {@render emptyRows()}
      {:else}
        <ul data-testid="trace-list" class="overflow-hidden rounded-lg border bg-card">
          {#each traces as t (t.trace_id)}
            <li class="border-b last:border-b-0">
              <a
                href={traceDetailUrl(t.trace_id, projectId)}
                data-trace-link
                class="block px-3 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onclick={() => onOpen(t.trace_id)}
              >
                <span class="flex items-center justify-between gap-2 text-xs">
                  <span class="min-w-0 font-mono text-muted-foreground" title={formatRelative(t.start_time)}>
                    <Timestamp value={t.start_time} precision="ms" />
                  </span>
                  <span class="shrink-0"><SeverityBadge kind="state" value={t.error ? 'failed' : 'ok'} /></span>
                </span>
                <span class="mt-1 line-clamp-2 break-words font-mono text-sm">
                  {t.root_operation_name ?? t.trace_id}
                </span>
                <span class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span class="break-all">{t.root_service_name ?? t.service_name}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span class="tabular-nums">{formatDuration(t.duration_ms)}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span class="tabular-nums">{t.span_count.toLocaleString('en-US')} spans</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <DataTable
        {columns}
        rows={traces}
        rowKey={(t: TraceRecord) => t.trace_id}
        {loading}
        bind:sort={getSort, setSort}
        empty={emptySnippet}
      />
    {/if}
    <Pagination {page} {pageSize} {total} {onPageChange} />
  </div>
{/if}
