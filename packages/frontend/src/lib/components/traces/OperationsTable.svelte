<script lang="ts">
  import DataTable from '$lib/components/app/DataTable.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Snippet } from 'svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import type { OperationRow } from '$lib/api/traces';
  import { levelTone } from '$lib/utils/severity';
  import { formatDuration } from './format';

  interface Props {
    rows: OperationRow[];
    loading: boolean;
    error?: string | null;
    selectedOperation?: string | null;
    showService: boolean;
    onSelect: (operation: string | null) => void;
    onRetry?: () => void;
  }

  let {
    rows,
    loading,
    error = null,
    selectedOperation = null,
    showService,
    onSelect,
    onRetry,
  }: Props = $props();

  let sort = $state<DataTableSort | undefined>({ key: 'p95Ms', dir: 'desc' });

  const ERROR_RATE_WARN = 0.05;

  function num(v: number): number {
    return Number.isFinite(v) ? v : 0;
  }

  function pct(v: number): string {
    return `${(num(v) * 100).toFixed(1)}%`;
  }

  function perMin(v: number): string {
    const n = num(v);
    return `${(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US')}/min`;
  }

  const sortValue: Record<string, (r: OperationRow) => number | string> = {
    service: (r) => r.service,
    operation: (r) => r.operation,
    count: (r) => num(r.count),
    errorRate: (r) => num(r.errorRate),
    p50Ms: (r) => num(r.p50Ms),
    p95Ms: (r) => num(r.p95Ms),
    p99Ms: (r) => num(r.p99Ms),
    throughputPerMin: (r) => num(r.throughputPerMin),
  };

  const sorted = $derived.by(() => {
    const s = sort ?? { key: 'p95Ms', dir: 'desc' as const };
    const get = sortValue[s.key] ?? sortValue.p95Ms;
    const factor = s.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : av - bv;
      return cmp * factor;
    });
  });

  function toggle(operation: string) {
    onSelect(selectedOperation === operation ? null : operation);
  }

  // svelte-check sees two Snippet types here; the runtime values are identical.
  const cell = (s: unknown) => s as DataTableColumn<OperationRow>['cell'];
  const emptySnippet = emptyRows as unknown as Snippet;

  const columns = $derived<DataTableColumn<OperationRow>[]>([
    ...(showService
      ? [{ key: 'service', header: 'Service', sortable: true, cell: cell(serviceCell) }]
      : []),
    { key: 'operation', header: 'Operation', sortable: true, cell: cell(operationCell) },
    { key: 'count', header: 'Requests', sortable: true, class: 'text-right', cell: cell(countCell) },
    { key: 'errorRate', header: 'Error rate', sortable: true, class: 'text-right', cell: cell(errorCell) },
    { key: 'p50Ms', header: 'p50', sortable: true, class: 'text-right', cell: cell(p50Cell) },
    { key: 'p95Ms', header: 'p95', sortable: true, class: 'text-right', cell: cell(p95Cell) },
    { key: 'p99Ms', header: 'p99', sortable: true, class: 'text-right', cell: cell(p99Cell) },
    { key: 'throughputPerMin', header: 'Throughput', sortable: true, class: 'text-right', cell: cell(throughputCell) },
  ]);
</script>

{#snippet serviceCell(r: OperationRow)}
  <span class="text-sm">{r.service}</span>
{/snippet}

{#snippet operationCell(r: OperationRow)}
  <button
    type="button"
    class="max-w-[28rem] truncate rounded px-1 text-left font-mono text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedOperation === r.operation ? 'bg-accent font-semibold' : ''}"
    aria-pressed={selectedOperation === r.operation}
    title={r.operation}
    onclick={() => toggle(r.operation)}
  >
    {r.operation}
  </button>
{/snippet}

{#snippet countCell(r: OperationRow)}
  <span class="tabular-nums">{num(r.count).toLocaleString('en-US')}</span>
{/snippet}

{#snippet errorCell(r: OperationRow)}
  <span class="tabular-nums {num(r.errorRate) > ERROR_RATE_WARN ? levelTone('error').text : ''}">{pct(r.errorRate)}</span>
{/snippet}

{#snippet p50Cell(r: OperationRow)}
  <span class="tabular-nums">{formatDuration(num(r.p50Ms))}</span>
{/snippet}

{#snippet p95Cell(r: OperationRow)}
  <span class="tabular-nums">{formatDuration(num(r.p95Ms))}</span>
{/snippet}

{#snippet p99Cell(r: OperationRow)}
  <span class="tabular-nums">{formatDuration(num(r.p99Ms))}</span>
{/snippet}

{#snippet throughputCell(r: OperationRow)}
  <span class="tabular-nums">{perMin(r.throughputPerMin)}</span>
{/snippet}

{#snippet emptyRows()}
  <EmptyState variant="no-results" title="No operations in this range" />
{/snippet}

{#if error}
  <EmptyState variant="error" title="Could not load operations" description={error}>
    {#snippet actions()}
      {#if onRetry}
        <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <DataTable
    {columns}
    rows={sorted}
    rowKey={(r: OperationRow) => `${r.service}::${r.operation}`}
    {loading}
    bind:sort
    empty={emptySnippet}
  />
{/if}
