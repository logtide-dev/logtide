<script lang="ts">
  import type { ErrorGroup } from '@logtide/shared';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Avatar from '$lib/components/app/Avatar.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import Folder from '@lucide/svelte/icons/folder';
  import ErrorStatusBadges from './ErrorStatusBadges.svelte';
  import ErrorSparkline from './ErrorSparkline.svelte';
  import { buildErrorDetailHref } from './error-group-links';
  import { DEFAULT_ERRORS_LIST_STATE, type ErrorsListState } from './errors-url-state';

  type WidenPreset = '24h' | '7d' | '30d';

  interface Props {
    groups: ErrorGroup[];
    trends: Record<string, number[]>;
    loading: boolean;
    error: string | null;
    selected?: string[];
    sort: DataTableSort;
    state: ErrorsListState;
    rangeLabel: string;
    /** Current scope query string, appended to detail links. */
    scopeSearch?: string;
    onRetry: () => void;
    onWidenRange: (preset: WidenPreset) => void;
    onShowAllStatuses: () => void;
    onClearFilters: () => void;
    onOpen: (group: ErrorGroup) => void;
    /** Called with the new sort key; only descending order is supported. */
    onSort: (key: string) => void;
  }

  let {
    groups,
    trends,
    loading,
    error,
    selected = $bindable([]),
    sort,
    state,
    rangeLabel,
    scopeSearch = '',
    onRetry,
    onWidenRange,
    onShowAllStatuses,
    onClearFilters,
    onOpen,
    onSort,
  }: Props = $props();

  const WIDEN: { preset: WidenPreset; label: string }[] = [
    { preset: '24h', label: 'Last 24 hours' },
    { preset: '7d', label: 'Last 7 days' },
    { preset: '30d', label: 'Last 30 days' },
  ];

  const hasFilters = $derived(
    state.search !== '' ||
      state.language !== '' ||
      state.assignee !== '' ||
      state.service !== '' ||
      state.status !== DEFAULT_ERRORS_LIST_STATE.status
  );
  const nonStatusFilters = $derived(
    state.search !== '' || state.language !== '' || state.assignee !== '' || state.service !== ''
  );
  const isNoData = $derived(state.status === 'all' && !nonStatusFilters);

  const emptyTitle = $derived(isNoData ? 'No errors yet' : `No errors match in ${rangeLabel}`);

  function handleClick(e: MouseEvent, group: ErrorGroup) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(group);
  }

  // Template snippets are typed against a duplicate Snippet declaration; cast once here.
  const asCell = (snippet: unknown) => snippet as DataTableColumn<ErrorGroup>['cell'];

  const columns: DataTableColumn<ErrorGroup>[] = [
    { key: 'error', header: 'Error', class: 'min-w-[16rem] max-w-[28rem]', cell: asCell(errorCell) },
    { key: 'trend', header: 'Trend', class: 'w-28', cell: asCell(trendCell) },
    { key: 'events', header: 'Events', sortable: true, class: 'text-right', cell: asCell(eventsCell) },
    { key: 'last_seen', header: 'Last seen', sortable: true, class: 'whitespace-nowrap', cell: asCell(lastSeenCell) },
    { key: 'first_seen', header: 'First seen', sortable: true, class: 'whitespace-nowrap', cell: asCell(firstSeenCell) },
    { key: 'assignee', header: 'Assignee', class: 'whitespace-nowrap', cell: asCell(assigneeCell) },
  ];
</script>

{#snippet errorCell(g: ErrorGroup)}
  <div class="space-y-1">
    <div class="flex flex-wrap items-center gap-2">
      <a
        href={buildErrorDetailHref(g.id, scopeSearch)}
        class="truncate rounded-sm font-mono text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={(e) => handleClick(e, g)}
      >
        {g.exceptionType}
      </a>
      <ErrorStatusBadges group={g} />
    </div>
    {#if g.exceptionMessage}
      <p class="truncate text-sm text-muted-foreground">{g.exceptionMessage}</p>
    {/if}
    <div class="flex flex-wrap items-center gap-1">
      {#if g.projectName}
        <Badge variant="outline" class="gap-1 font-normal text-muted-foreground">
          <Folder class="h-3 w-3" aria-hidden="true" />
          {g.projectName}
        </Badge>
      {/if}
      {#each g.affectedServices ?? [] as service (service)}
        <Badge variant="secondary" class="font-mono font-normal">{service}</Badge>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet trendCell(g: ErrorGroup)}
  <ErrorSparkline
    counts={trends[g.id] ?? []}
    label="Events over time in {rangeLabel} for {g.exceptionType}"
  />
{/snippet}

{#snippet eventsCell(g: ErrorGroup)}
  <span class="tabular-nums">{g.occurrenceCount.toLocaleString('en-US')}</span>
{/snippet}

{#snippet lastSeenCell(g: ErrorGroup)}
  <Timestamp value={g.lastSeen} relative />
{/snippet}

{#snippet firstSeenCell(g: ErrorGroup)}
  <Timestamp value={g.firstSeen} relative />
{/snippet}

{#snippet assigneeCell(g: ErrorGroup)}
  {#if g.assignedTo}
    <span class="inline-flex items-center gap-2">
      <Avatar name={g.assignedToName ?? ''} email={g.assignedToEmail ?? undefined} size="sm" />
      <span class="text-sm">{g.assignedToName || g.assignedToEmail}</span>
    </span>
  {:else}
    <span class="text-sm text-muted-foreground">Unassigned</span>
  {/if}
{/snippet}

{#if error}
  <EmptyState variant="error" title="Could not load errors" description={error}>
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
    {/snippet}
  </EmptyState>
{:else if !loading && groups.length === 0}
  <EmptyState
    variant={isNoData ? 'no-data' : 'no-results'}
    title={emptyTitle}
    description={isNoData
      ? `Nothing was seen in ${rangeLabel}. Errors appear here when exceptions are detected in your logs.`
      : 'Try a wider time range or different filters.'}
  >
    {#snippet actions()}
      {#each WIDEN as w (w.preset)}
        <Button variant="outline" size="sm" onclick={() => onWidenRange(w.preset)}>{w.label}</Button>
      {/each}
      {#if state.status !== 'all'}
        <Button variant="outline" size="sm" onclick={onShowAllStatuses}>Show all statuses</Button>
      {/if}
      {#if hasFilters}
        <Button variant="ghost" size="sm" onclick={onClearFilters}>Clear filters</Button>
      {/if}
      {#if isNoData}
        <a
          href="https://logtide.dev/docs/getting-started"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-primary-text hover:underline"
        >
          Connect your app
        </a>
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <DataTable
    {columns}
    rows={groups}
    rowKey={(g) => g.id}
    {loading}
    selectable
    bind:selected
    bind:sort={() => sort, (v) => {
      if (v && v.key !== sort.key) onSort(v.key);
    }}
  />
{/if}
