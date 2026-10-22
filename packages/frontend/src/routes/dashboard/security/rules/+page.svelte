<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { SigmaLevel, SigmaRuleSortKey, SigmaRuleSource, SigmaRuleListItem } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { sigmaAPI, type SigmaRule } from '$lib/api/sigma';
  import { detectionPacksAPI } from '$lib/api/detection-packs';
  import { toastStore } from '$lib/stores/toast';
  import { layoutStore } from '$lib/stores/layout';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Pagination from '$lib/components/app/Pagination.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import type { DataTableSort } from '$lib/components/app/data-table';
  import { Button } from '$lib/components/ui/button';
  import SigmaRulesTable from '$lib/components/siem/rules/SigmaRulesTable.svelte';
  import RuleFilters from '$lib/components/siem/rules/RuleFilters.svelte';
  import ImportRuleDialog from '$lib/components/siem/rules/ImportRuleDialog.svelte';
  import { EMPTY_RULE_FILTERS, type RuleFilterValue } from '$lib/components/siem/rules/rule-filters';
  import SigmaSyncDialog from '$lib/components/SigmaSyncDialog.svelte';
  import DetectionPacksGalleryDialog from '$lib/components/DetectionPacksGalleryDialog.svelte';
  import EditSigmaChannelsDialog from '$lib/components/EditSigmaChannelsDialog.svelte';
  import Package from '@lucide/svelte/icons/package';
  import Download from '@lucide/svelte/icons/download';
  import FileUp from '@lucide/svelte/icons/file-up';

  const PAGE_SIZE = 25;
  const SORT_KEYS: SigmaRuleSortKey[] = ['title', 'level', 'hits7d', 'lastFiredAt', 'createdAt'];

  let rules = $state<SigmaRuleListItem[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let selected = $state<string[]>([]);
  let togglingId = $state<string | null>(null);
  let packNames = $state<Record<string, string>>({});

  let showImport = $state(false);
  let showSync = $state(false);
  let showPacks = $state(false);
  let showBulkDelete = $state(false);
  let showChannels = $state(false);
  let channelsRule = $state<SigmaRuleListItem | null>(null);

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');

  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  function list(name: string): string[] {
    const raw = page.url.searchParams.get(name);
    return raw ? raw.split(',').filter(Boolean) : [];
  }

  const filters = $derived<RuleFilterValue>({
    q: page.url.searchParams.get('q') ?? '',
    severity: list('severity'),
    tactic: list('tactic'),
    source: list('source'),
    enabled: (['true', 'false'] as const).find((v) => v === page.url.searchParams.get('enabled')) ?? 'all',
  });

  const pageNumber = $derived(Math.max(1, Number(page.url.searchParams.get('page')) || 1));

  const sortKey = $derived.by(() => {
    const raw = page.url.searchParams.get('sort');
    return SORT_KEYS.find((k) => k === raw);
  });
  const sortDir = $derived<'asc' | 'desc'>(page.url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc');

  const filtersActive = $derived(
    filters.q !== '' ||
      filters.severity.length > 0 ||
      filters.tactic.length > 0 ||
      filters.source.length > 0 ||
      filters.enabled !== 'all',
  );

  // The DataTable binds this; changes are pushed back into the URL below.
  let tableSort = $state<DataTableSort | undefined>(undefined);

  $effect(() => {
    const next = sortKey && sortKey !== 'createdAt' ? { key: sortKey, dir: sortDir } : undefined;
    const cur = untrack(() => tableSort);
    if (cur?.key !== next?.key || cur?.dir !== next?.dir) tableSort = next;
  });

  $effect(() => {
    const current = tableSort;
    if (!current) return;
    if (current.key === sortKey && current.dir === sortDir) return;
    setParams({ sort: current.key, dir: current.dir, page: null });
  });

  function setParams(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(patch)) {
      const text = Array.isArray(value) ? value.join(',') : value;
      if (!text) params.delete(key);
      else params.set(key, text);
    }
    const qs = params.toString();
    goto(qs ? `?${qs}` : page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function onFiltersChange(next: RuleFilterValue) {
    setParams({
      q: next.q,
      severity: next.severity,
      tactic: next.tactic,
      source: next.source,
      enabled: next.enabled === 'all' ? null : next.enabled,
      page: null,
    });
  }

  let loadSequence = 0;

  async function load() {
    const org = $currentOrganization;
    if (!org) return;
    const current = ++loadSequence;
    loading = true;
    error = '';
    try {
      const res = await sigmaAPI.listRules({
        organizationId: org.id,
        page: pageNumber,
        pageSize: PAGE_SIZE,
        search: filters.q || undefined,
        severity: filters.severity.length ? (filters.severity as SigmaLevel[]) : undefined,
        tactic: filters.tactic.length ? filters.tactic : undefined,
        source: filters.source.length ? (filters.source as SigmaRuleSource[]) : undefined,
        enabled: filters.enabled === 'all' ? undefined : filters.enabled === 'true',
        // Reliability, database and business packs are managed from Alerts.
        category: ['security'],
        sortBy: sortKey,
        sortOrder: sortKey ? sortDir : undefined,
      });
      if (current !== loadSequence) return;
      rules = res.rules;
      total = res.total;
      selected = selected.filter((id) => res.rules.some((r) => r.id === id));
    } catch (e) {
      if (current !== loadSequence) return;
      error = e instanceof Error ? e.message : 'Failed to load detection rules';
    } finally {
      if (current === loadSequence) loading = false;
    }
  }

  // Reload when the organization or any URL filter changes.
  $effect(() => {
    if (!browser || !$currentOrganization) {
      rules = [];
      total = 0;
      return;
    }
    page.url.search;
    $currentOrganization.id;
    load();
  });

  $effect(() => {
    const org = $currentOrganization;
    if (!browser || !org) return;
    detectionPacksAPI
      .listPacks(org.id)
      .then((res) => {
        packNames = Object.fromEntries((res.packs ?? []).map((p) => [p.id, p.name]));
      })
      .catch(() => {
        // Source column falls back to the humanised pack id.
      });
  });

  async function toggle(rule: SigmaRuleListItem, enabled: boolean) {
    const org = $currentOrganization;
    if (!org) return;
    const previous = rule.enabled;
    rules = rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r));
    togglingId = rule.id;
    try {
      await sigmaAPI.updateRule(rule.id, { organizationId: org.id, enabled });
    } catch (e) {
      rules = rules.map((r) => (r.id === rule.id ? { ...r, enabled: previous } : r));
      toastStore.error(e instanceof Error ? e.message : 'Failed to update rule');
    } finally {
      togglingId = null;
    }
  }

  async function deleteOne(rule: SigmaRuleListItem) {
    const org = $currentOrganization;
    if (!org) return;
    try {
      await sigmaAPI.deleteRule(rule.id, org.id, true);
      toastStore.success('Rule deleted');
      await load();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete rule');
      throw e;
    }
  }

  async function bulk(action: 'enable' | 'disable' | 'delete') {
    const org = $currentOrganization;
    if (!org || selected.length === 0) return;
    try {
      const res = await sigmaAPI.bulk(org.id, selected, action);
      const n = res.affected.toLocaleString('en-US');
      const noun = res.affected === 1 ? 'rule' : 'rules';
      const verb = action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'deleted';
      toastStore.success(`${n} ${noun} ${verb}`);
      selected = [];
      await load();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Bulk action failed');
      throw e;
    }
  }

  function clearFilters() {
    onFiltersChange(EMPTY_RULE_FILTERS);
  }

  function goToPage(next: number) {
    setParams({ page: next > 1 ? String(next) : null });
  }
</script>

<svelte:head>
  <title>Detection rules - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader
    title="Detection rules"
    description="Manage security detection rules. Import from SigmaHQ, add your own or install detection packs."
    appliesTo="organization"
  >
    {#snippet actions()}
      <Button variant="outline" onclick={() => (showImport = true)}>
        <FileUp aria-hidden="true" />
        Import rule
      </Button>
      <Button variant="outline" onclick={() => (showPacks = true)}>
        <Package aria-hidden="true" />
        Detection packs
      </Button>
      <Button onclick={() => (showSync = true)}>
        <Download aria-hidden="true" />
        Sync from SigmaHQ
      </Button>
    {/snippet}
  </PageHeader>

  {#if error}
    <EmptyState variant="error" title="Could not load detection rules" description={error}>
      {#snippet actions()}
        <Button variant="outline" onclick={load}>Retry</Button>
      {/snippet}
    </EmptyState>
  {:else if !loading && total === 0 && !filtersActive}
    <EmptyState
      variant="setup"
      title="No detection rules yet"
      description="Import Sigma rules to find security threats in your logs"
    >
      {#snippet actions()}
        <Button variant="outline" onclick={() => (showImport = true)}>Import rule</Button>
        <Button variant="outline" onclick={() => (showPacks = true)}>Browse detection packs</Button>
        <Button onclick={() => (showSync = true)}>Sync from SigmaHQ</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="space-y-4">
      <RuleFilters value={filters} onChange={onFiltersChange} />

      {#if selected.length > 0}
        <div
          class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2"
          role="region"
          aria-label="Bulk actions"
        >
          <span class="text-sm">{selected.length.toLocaleString('en-US')} selected</span>
          <Button size="sm" variant="outline" onclick={() => bulk('enable').catch(() => {})}>Enable</Button>
          <Button size="sm" variant="outline" onclick={() => bulk('disable').catch(() => {})}>Disable</Button>
          <Button size="sm" variant="destructive" onclick={() => (showBulkDelete = true)}>Delete</Button>
          <Button size="sm" variant="ghost" onclick={() => (selected = [])}>Clear selection</Button>
        </div>
      {/if}

      {#if !loading && rules.length === 0}
        <EmptyState
          variant="no-results"
          title="No rules match these filters"
          description="Try a different search or remove a filter"
        >
          {#snippet actions()}
            <Button variant="outline" onclick={clearFilters}>Clear filters</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <SigmaRulesTable
          {rules}
          {loading}
          bind:selected
          bind:sort={tableSort}
          {togglingId}
          {packNames}
          onToggle={toggle}
          onEditDestinations={(rule) => {
            channelsRule = rule;
            showChannels = true;
          }}
          onDelete={deleteOne}
        />
        <Pagination page={pageNumber} pageSize={PAGE_SIZE} {total} onPageChange={goToPage} />
      {/if}
    </div>
  {/if}
</div>

{#if $currentOrganization}
  <ImportRuleDialog
    bind:open={showImport}
    organizationId={$currentOrganization.id}
    onImported={(id) => goto(`/dashboard/security/rules/${id}`)}
  />

  <SigmaSyncDialog
    bind:open={showSync}
    organizationId={$currentOrganization.id}
    onSuccess={() => load()}
  />

  <DetectionPacksGalleryDialog
    bind:open={showPacks}
    organizationId={$currentOrganization.id}
    categories={['security']}
    onSuccess={() => load()}
  />

  <EditSigmaChannelsDialog
    bind:open={showChannels}
    rule={channelsRule as unknown as SigmaRule | null}
    onSuccess={() => load()}
  />
{/if}

<ConfirmDialog
  bind:open={showBulkDelete}
  title="Delete rules"
  description="Delete {selected.length.toLocaleString('en-US')} selected {selected.length === 1
    ? 'rule'
    : 'rules'}? Their exceptions are removed too. This cannot be undone."
  confirmLabel="Delete rules"
  onConfirm={() => bulk('delete')}
/>
