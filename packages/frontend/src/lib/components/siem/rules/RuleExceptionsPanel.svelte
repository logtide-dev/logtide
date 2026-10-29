<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ExceptionCondition, SigmaException } from '@logtide/shared';
  import { sigmaAPI } from '$lib/api/sigma';
  import { toastStore } from '$lib/stores/toast';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import AddExceptionDialog from '$lib/components/siem/shared/AddExceptionDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';

  interface Props {
    organizationId: string;
    ruleId: string;
    ruleTitle: string;
  }

  let { organizationId, ruleId, ruleTitle }: Props = $props();

  let exceptions = $state<SigmaException[]>([]);
  let loading = $state(false);
  let error = $state('');
  let addOpen = $state(false);
  let deleteOpen = $state(false);
  let toDelete = $state<SigmaException | null>(null);

  let sequence = 0;

  async function load() {
    const seq = ++sequence;
    loading = true;
    error = '';
    try {
      const res = await sigmaAPI.listExceptions(ruleId, organizationId);
      if (seq !== sequence) return;
      exceptions = res.exceptions;
    } catch (e) {
      if (seq !== sequence) return;
      error = e instanceof Error ? e.message : 'Failed to load exceptions';
    } finally {
      if (seq === sequence) loading = false;
    }
  }

  $effect(() => {
    ruleId;
    organizationId;
    exceptions = [];
    load();
  });

  function isExpired(e: SigmaException): boolean {
    return e.expiresAt !== null && new Date(e.expiresAt).getTime() <= Date.now();
  }

  function describe(c: ExceptionCondition): string {
    if (c.operator === 'in') return `${c.field} in ${c.values.join(', ')}`;
    return `${c.field} ${c.operator} ${c.values[0] ?? ''}`;
  }

  function askDelete(e: SigmaException) {
    toDelete = e;
    deleteOpen = true;
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await sigmaAPI.deleteException(ruleId, toDelete.id, organizationId);
      toastStore.success('Exception deleted');
      await load();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete exception');
      throw e;
    }
  }

  const snip = (s: unknown) => s as Snippet<[SigmaException]>;

  const columns = $derived.by<DataTableColumn<SigmaException>[]>(() => [
    { key: 'conditions', header: 'Conditions', cell: snip(conditionsCell) },
    { key: 'reason', header: 'Reason', cell: snip(reasonCell) },
    { key: 'expires', header: 'Expires', cell: snip(expiresCell) },
    { key: 'hits', header: 'Suppressed', cell: snip(hitsCell) },
    { key: 'actions', header: '', class: 'w-10', cell: snip(actionsCell) },
  ]);
</script>

{#snippet mobileRow(e: SigmaException)}
  <div class="flex items-start gap-2">
    <div class="min-w-0 flex-1 space-y-2">
      {@render conditionsCell(e)}
      {#if e.reason}{@render reasonCell(e)}{/if}
    </div>
    {@render actionsCell(e)}
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    <div class="inline-flex items-center gap-1">Expires {@render expiresCell(e)}</div>
    <div class="inline-flex items-center gap-1">Suppressed {@render hitsCell(e)}</div>
  </div>
{/snippet}

{#snippet conditionsCell(e: SigmaException)}
  <div class="flex flex-wrap gap-1 {isExpired(e) ? 'opacity-60' : ''}">
    {#each e.conditions as c, i (i)}
      <span class="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">{describe(c)}</span>
    {/each}
  </div>
{/snippet}

{#snippet reasonCell(e: SigmaException)}
  <span class="text-sm {isExpired(e) ? 'opacity-60' : ''}">{e.reason ?? '-'}</span>
{/snippet}

{#snippet expiresCell(e: SigmaException)}
  <div class="flex items-center gap-2">
    {#if e.expiresAt}
      <span class={isExpired(e) ? 'opacity-60' : ''}><Timestamp value={e.expiresAt} precision="minute" /></span>
      {#if isExpired(e)}
        <span class="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Expired
        </span>
      {/if}
    {:else}
      <span class="text-muted-foreground">Never</span>
    {/if}
  </div>
{/snippet}

{#snippet hitsCell(e: SigmaException)}
  <div class="text-sm {isExpired(e) ? 'opacity-60' : ''}">
    <span class="tabular-nums">{e.hitCount.toLocaleString('en-US')}</span>
    {#if e.lastHitAt}
      <span class="text-xs text-muted-foreground"> last <Timestamp value={e.lastHitAt} relative /></span>
    {/if}
  </div>
{/snippet}

{#snippet actionsCell(e: SigmaException)}
  <Button variant="ghost" size="icon" aria-label="Delete exception" onclick={() => askDelete(e)}>
    <Trash2 aria-hidden="true" />
  </Button>
{/snippet}

<div class="space-y-3">
  <div class="flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
    <p class="text-sm text-muted-foreground">
      Matches that fit an exception are skipped before any detection or notification is created.
    </p>
    <Button variant="outline" onclick={() => (addOpen = true)}>
      <Plus aria-hidden="true" />
      Add exception
    </Button>
  </div>

  {#if error}
    <EmptyState variant="error" title="Could not load exceptions" description={error}>
      {#snippet actions()}
        <Button variant="outline" onclick={load}>Retry</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <DataTable {columns} rows={exceptions} rowKey={(e: SigmaException) => e.id} {loading} mobileRow={snip(mobileRow)}>
      {#snippet empty()}No exceptions{/snippet}
    </DataTable>
  {/if}
</div>

<AddExceptionDialog
  bind:open={addOpen}
  {organizationId}
  {ruleId}
  {ruleTitle}
  onCreated={() => load()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete exception"
  description="Matching logs will create detections again. This cannot be undone."
  confirmLabel="Delete exception"
  onConfirm={remove}
/>
