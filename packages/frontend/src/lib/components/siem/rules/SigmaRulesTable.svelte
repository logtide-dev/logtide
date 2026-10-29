<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SigmaRuleListItem } from '@logtide/shared';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import MitreTacticBadge from '$lib/components/siem/shared/MitreTacticBadge.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { sourceLabel } from './rule-source';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';

  interface Props {
    rules: SigmaRuleListItem[];
    loading: boolean;
    selected?: string[];
    sort?: DataTableSort;
    togglingId: string | null;
    onToggle: (rule: SigmaRuleListItem, enabled: boolean) => void;
    /** Pack id to display name, used for the Source column. */
    packNames?: Record<string, string>;
    onEditDestinations?: (rule: SigmaRuleListItem) => void;
    onDelete?: (rule: SigmaRuleListItem) => void | Promise<void>;
  }

  let {
    rules,
    loading,
    selected = $bindable([]),
    sort = $bindable(undefined),
    togglingId,
    onToggle,
    packNames = {},
    onEditDestinations,
    onDelete,
  }: Props = $props();

  let deleteOpen = $state(false);
  let ruleToDelete = $state<SigmaRuleListItem | null>(null);

  const MAX_TACTICS = 2;

  function askDelete(rule: SigmaRuleListItem) {
    ruleToDelete = rule;
    deleteOpen = true;
  }

  // Svelte types template snippets loosely; the table wants the Snippet type.
  const snip = (s: unknown) => s as Snippet<[SigmaRuleListItem]>;

  const columns = $derived.by<DataTableColumn<SigmaRuleListItem>[]>(() => [
    { key: 'title', header: 'Name', sortable: true, class: 'min-w-[16rem]', cell: snip(nameCell) },
    { key: 'level', header: 'Severity', sortable: true, cell: snip(severityCell) },
    { key: 'mitre', header: 'MITRE', cell: snip(mitreCell) },
    { key: 'source', header: 'Source', cell: snip(sourceCell) },
    { key: 'enabled', header: 'Enabled', cell: snip(enabledCell) },
    { key: 'hits7d', header: 'Hits (7d)', sortable: true, class: 'text-right', cell: snip(hitsCell) },
    { key: 'lastFiredAt', header: 'Last fired', sortable: true, cell: snip(lastFiredCell) },
    { key: 'actions', header: '', class: 'w-10', cell: snip(actionsCell) },
  ]);
</script>

{#snippet mobileRow(rule: SigmaRuleListItem)}
  {@const tactics = rule.mitreTactics ?? []}
  <div class="flex items-start gap-2">
    <div class="min-w-0 flex-1">
      <a
        href="/dashboard/security/rules/{rule.id}"
        class="block text-sm font-medium leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {rule.title}
      </a>
      {#if rule.description}
        <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{rule.description}</p>
      {/if}
    </div>
    <Switch
      checked={rule.enabled}
      disabled={togglingId === rule.id}
      aria-label="Enable {rule.title}"
      onCheckedChange={(v) => onToggle(rule, v)}
    />
    {@render actionsCell(rule)}
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-1.5">
    <SeverityBadge kind="severity" value={rule.level} />
    {#each tactics.slice(0, 1) as tactic (tactic)}
      <MitreTacticBadge {tactic} clickable={false} />
    {/each}
    {#if tactics.length > 1}
      <span class="text-xs text-muted-foreground">+{tactics.length - 1}</span>
    {/if}
  </div>
  <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
    <span>{sourceLabel(rule, packNames)}</span>
    <span aria-hidden="true">·</span>
    <span><span class="tabular-nums">{rule.hits7d.toLocaleString('en-US')}</span> hits in 7d</span>
    <span aria-hidden="true">·</span>
    {#if rule.lastFiredAt}
      <span>Last fired <Timestamp value={rule.lastFiredAt} relative /></span>
    {:else}
      <span>Never fired</span>
    {/if}
  </p>
{/snippet}

{#snippet nameCell(rule: SigmaRuleListItem)}
  <div class="min-w-0">
    <a
      href="/dashboard/security/rules/{rule.id}"
      class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {rule.title}
    </a>
    {#if rule.description}
      <p class="max-w-md truncate text-xs text-muted-foreground">{rule.description}</p>
    {/if}
  </div>
{/snippet}

{#snippet severityCell(rule: SigmaRuleListItem)}
  <SeverityBadge kind="severity" value={rule.level} />
{/snippet}

{#snippet mitreCell(rule: SigmaRuleListItem)}
  {@const tactics = rule.mitreTactics ?? []}
  {#if tactics.length === 0}
    <span class="text-muted-foreground">-</span>
  {:else}
    <div class="flex flex-wrap items-center gap-1">
      {#each tactics.slice(0, MAX_TACTICS) as tactic (tactic)}
        <MitreTacticBadge {tactic} clickable={false} />
      {/each}
      {#if tactics.length > MAX_TACTICS}
        <span class="text-xs text-muted-foreground">+{tactics.length - MAX_TACTICS}</span>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet sourceCell(rule: SigmaRuleListItem)}
  <span class="text-sm">{sourceLabel(rule, packNames)}</span>
{/snippet}

{#snippet enabledCell(rule: SigmaRuleListItem)}
  <Switch
    checked={rule.enabled}
    disabled={togglingId === rule.id}
    aria-label="Enable {rule.title}"
    onCheckedChange={(v) => onToggle(rule, v)}
  />
{/snippet}

{#snippet hitsCell(rule: SigmaRuleListItem)}
  <span class="tabular-nums">{rule.hits7d.toLocaleString('en-US')}</span>
{/snippet}

{#snippet lastFiredCell(rule: SigmaRuleListItem)}
  {#if rule.lastFiredAt}
    <Timestamp value={rule.lastFiredAt} relative />
  {:else}
    <span class="text-muted-foreground">Never</span>
  {/if}
{/snippet}

{#snippet actionsCell(rule: SigmaRuleListItem)}
  <DropdownMenu.DropdownMenu>
    <DropdownMenu.DropdownMenuTrigger
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Actions for {rule.title}"
    >
      <Ellipsis class="size-4" aria-hidden="true" />
    </DropdownMenu.DropdownMenuTrigger>
    <DropdownMenu.DropdownMenuContent align="end" class="w-48">
      <DropdownMenu.DropdownMenuItem>
        {#snippet child({ props })}
          <a href="/dashboard/security/rules/{rule.id}" {...props}>Open</a>
        {/snippet}
      </DropdownMenu.DropdownMenuItem>
      {#if onEditDestinations}
        <DropdownMenu.DropdownMenuItem onclick={() => onEditDestinations?.(rule)}>
          Edit destinations
        </DropdownMenu.DropdownMenuItem>
      {/if}
      {#if onDelete}
        <DropdownMenu.DropdownMenuSeparator />
        <DropdownMenu.DropdownMenuItem
          class="text-destructive-text"
          onclick={() => askDelete(rule)}
        >
          Delete
        </DropdownMenu.DropdownMenuItem>
      {/if}
    </DropdownMenu.DropdownMenuContent>
  </DropdownMenu.DropdownMenu>
{/snippet}

<DataTable
  {columns}
  rows={rules}
  rowKey={(r: SigmaRuleListItem) => r.id}
  {loading}
  selectable
  bind:selected
  bind:sort
  mobileRow={snip(mobileRow)}
  rowLabel={(r: SigmaRuleListItem) => r.title}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete rule"
  description={ruleToDelete
    ? `Delete "${ruleToDelete.title}"? Its exceptions and the linked alert rule are removed too. This cannot be undone.`
    : ''}
  confirmLabel="Delete rule"
  onConfirm={async () => {
    if (ruleToDelete) await onDelete?.(ruleToDelete);
  }}
/>
