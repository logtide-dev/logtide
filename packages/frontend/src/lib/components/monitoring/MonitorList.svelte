<script lang="ts">
  import { monitoringStore } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import Activity from '@lucide/svelte/icons/activity';
  import Copy from '@lucide/svelte/icons/copy';
  import Globe from '@lucide/svelte/icons/globe';
  import Heart from '@lucide/svelte/icons/heart';
  import Network from '@lucide/svelte/icons/network';
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Wifi from '@lucide/svelte/icons/wifi';
  import MonitorSummaryCards from './MonitorSummaryCards.svelte';
  import {
    filterMonitors,
    formatResponseTime,
    monitorStateLabel,
    monitorStateTone,
    monitorTitle,
    monitorTypeLabel,
    type MonitorStatusFilter,
  } from './monitor-meta';

  interface Props {
    monitors: Monitor[];
    loading: boolean;
    orgId: string;
    status?: MonitorStatusFilter;
    q?: string;
    onEdit: (m: Monitor) => void;
    onDuplicate: (m: Monitor) => void;
    onChanged: () => void;
    onCreate?: () => void;
  }

  let {
    monitors,
    loading,
    orgId,
    status = $bindable('all'),
    q = $bindable(''),
    onEdit,
    onDuplicate,
    onChanged,
    onCreate,
  }: Props = $props();

  let togglingId = $state<string | null>(null);
  let deleteTarget = $state<Monitor | null>(null);
  let deleteOpen = $state(false);

  const filtered = $derived(filterMonitors(monitors, status, q));
  const filtersActive = $derived(status !== 'all' || q.trim() !== '');

  function clearFilters() {
    status = 'all';
    q = '';
  }

  function typeIcon(type: Monitor['type']) {
    if (type === 'http') return Globe;
    if (type === 'tcp') return Wifi;
    if (type === 'ssl') return ShieldCheck;
    if (type === 'dns') return Network;
    if (type === 'log_heartbeat') return Activity;
    return Heart;
  }

  async function toggleEnabled(m: Monitor) {
    togglingId = m.id;
    try {
      await monitoringStore.update(m.id, orgId, { enabled: !m.enabled });
      toastStore.success(m.enabled ? 'Monitor paused' : 'Monitor resumed');
      onChanged();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not update the monitor');
    } finally {
      togglingId = null;
    }
  }

  function askDelete(m: Monitor) {
    deleteTarget = m;
    deleteOpen = true;
  }

  async function confirmDelete() {
    const m = deleteTarget;
    if (!m) return;
    try {
      await monitoringStore.delete(m.id, orgId);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not delete the monitor');
      throw err;
    }
    toastStore.success('Monitor deleted');
    onChanged();
  }

  type Cell = DataTableColumn<Monitor>['cell'];

  const columns: DataTableColumn<Monitor>[] = [
    { key: 'status', header: 'Status', cell: statusCell as unknown as Cell },
    { key: 'name', header: 'Name', class: 'min-w-[9rem]', cell: nameCell as unknown as Cell },
    { key: 'type', header: 'Type', class: 'hidden sm:table-cell', cell: typeCell as unknown as Cell },
    { key: 'response', header: 'Response', class: 'hidden md:table-cell', cell: responseCell as unknown as Cell },
    { key: 'checked', header: 'Last checked', class: 'hidden lg:table-cell', cell: checkedCell as unknown as Cell },
    { key: 'actions', header: 'Actions', class: 'text-right', cell: actionsCell as unknown as Cell },
  ];
</script>

{#snippet statusCell(m: Monitor)}
  {@const tone = monitorStateTone(m.status?.status ?? 'unknown', m.enabled)}
  <span class="inline-flex items-center gap-2">
    <span class="h-2.5 w-2.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
    <span class="font-medium {tone.text}">{monitorStateLabel(m.status?.status, m.enabled)}</span>
  </span>
{/snippet}

{#snippet nameCell(m: Monitor)}
  <div class="min-w-0">
    <a
      href="/dashboard/uptime/{m.id}"
      class="font-medium hover:text-primary hover:underline"
    >
      {monitorTitle(m)}
    </a>
    {#if m.displayName?.trim()}
      <p class="truncate text-xs text-muted-foreground">{m.name}</p>
    {/if}
    {#if m.status?.incidentId}
      <p class="text-xs">
        <a
          href="/dashboard/incidents/{m.status.incidentId}"
          class="text-destructive-text hover:underline"
        >
          Open incident
        </a>
      </p>
    {/if}
  </div>
{/snippet}

{#snippet typeCell(m: Monitor)}
  {@const Icon = typeIcon(m.type)}
  <span class="inline-flex items-center gap-1.5 text-muted-foreground">
    <Icon class="h-3.5 w-3.5" aria-hidden="true" />
    {monitorTypeLabel(m.type)}
  </span>
{/snippet}

{#snippet responseCell(m: Monitor)}
  <span class="text-muted-foreground">{formatResponseTime(m.status?.responseTimeMs)}</span>
{/snippet}

{#snippet checkedCell(m: Monitor)}
  <span class="text-xs text-muted-foreground">
    {#if m.status?.lastCheckedAt}
      <Timestamp value={m.status.lastCheckedAt} />
    {:else}
      -
    {/if}
  </span>
{/snippet}

{#snippet actionsCell(m: Monitor)}
  {@const title = monitorTitle(m)}
  <div class="flex items-center justify-end gap-1">
    <Button
      variant="ghost"
      size="sm"
      onclick={() => toggleEnabled(m)}
      disabled={togglingId === m.id}
      aria-label={m.enabled ? `Pause ${title}` : `Resume ${title}`}
    >
      {#if m.enabled}<Pause class="h-4 w-4" />{:else}<Play class="h-4 w-4" />{/if}
    </Button>
    <Button variant="ghost" size="sm" onclick={() => onEdit(m)} aria-label="Edit {title}">
      <Pencil class="h-4 w-4" />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => onDuplicate(m)} aria-label="Duplicate {title}">
      <Copy class="h-4 w-4" />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => askDelete(m)} aria-label="Delete {title}">
      <Trash2 class="h-4 w-4 text-destructive-text" />
    </Button>
  </div>
{/snippet}

{#if !loading && monitors.length === 0}
  <EmptyState
    variant="no-data"
    icon={Activity as never}
    title="No monitors yet"
    description="Create a monitor to track the uptime and health of your services."
  >
    {#snippet actions()}
      {#if onCreate}
        <Button size="sm" onclick={onCreate}>
          <Plus class="mr-2 h-4 w-4" />
          Create monitor
        </Button>
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="space-y-4">
    <MonitorSummaryCards {monitors} bind:status />

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search
          class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search by name, target or type"
          aria-label="Search monitors"
          bind:value={q}
          class="h-9 pl-9"
        />
      </div>
      {#if filtersActive}
        <Button variant="ghost" size="sm" onclick={clearFilters}>Clear filters</Button>
      {/if}
    </div>

    {#if !loading && filtered.length === 0}
      <EmptyState
        variant="no-results"
        title="No monitors match these filters"
        description="Try a different search or status."
      >
        {#snippet actions()}
          <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="rounded-lg border bg-card">
        <DataTable {columns} rows={filtered} rowKey={(m: Monitor) => m.id} {loading} />
      </div>
    {/if}
  </div>
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete monitor"
  description={deleteTarget
    ? `This permanently deletes "${monitorTitle(deleteTarget)}" and its check history. Its open incident, if any, is resolved.`
    : undefined}
  confirmLabel="Delete monitor"
  onConfirm={confirmDelete}
/>
