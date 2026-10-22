<script lang="ts">
  // Orchestration of the /dashboard page. The route file only renders this
  // component with the current URL and a navigate callback, which keeps the
  // URL sync testable without SvelteKit's router.
  import { onMount, onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { currentOrganization } from '$lib/stores/organization';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import { layoutStore } from '$lib/stores/layout';
  import { toastStore } from '$lib/stores/toast';
  import {
    customDashboardsStore,
    activeDashboard,
    dashboardList,
    dashboardLoading,
    dashboardError,
    dashboardListError,
    editMode,
    pendingPanels,
    dashboardSaving,
    dashboardSaveError,
    panelDataMap,
    pausedPanelIds,
    timeRangeOverride,
  } from '$lib/stores/custom-dashboards';
  import { customDashboardsAPI } from '$lib/api/custom-dashboards';
  import type { DashboardTemplateSummary } from '$lib/api/custom-dashboards';
  import DashboardContainer from './DashboardContainer.svelte';
  import DashboardSwitcher from './DashboardSwitcher.svelte';
  import PanelConfigDialog from './PanelConfigDialog.svelte';
  import AddPanelDialog from './AddPanelDialog.svelte';
  import CreateDashboardDialog from './CreateDashboardDialog.svelte';
  import YamlImportDialog from './YamlImportDialog.svelte';
  import RenameDashboardDialog from './RenameDashboardDialog.svelte';
  import CreateFromTemplateDialog from './CreateFromTemplateDialog.svelte';
  import { readDashboardUrlState, writeDashboardUrlState } from './dashboard-url';
  import { TIME_RANGE_OPTIONS, timeRangeLabel } from './time-range-options';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import * as Select from '$lib/components/ui/select';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Button from '$lib/components/ui/button/button.svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Clock from '@lucide/svelte/icons/clock';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Save from '@lucide/svelte/icons/save';
  import XIcon from '@lucide/svelte/icons/x';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import type {
    CustomDashboard,
    PanelConfig,
    PanelInstance,
    PanelLayout,
    PanelTimeRange,
  } from '@logtide/shared';

  interface Props {
    url: URL;
    navigate: (url: URL) => void;
  }

  let { url, navigate }: Props = $props();

  let maxWidthClass = $state('max-w-full');
  let containerPadding = $state('px-6 py-8');

  // Dialog state
  let showAddPanel = $state(false);
  let showCreateDashboard = $state(false);
  let showYamlImport = $state(false);
  let showRename = $state(false);
  let showDelete = $state(false);
  let showTemplates = $state(false);
  let editingPanelId = $state<string | null>(null);

  let templates = $state<DashboardTemplateSummary[]>([]);
  let templatesLoading = $state(false);
  let templatesError = $state<string | null>(null);

  $effect(() => {
    const u = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
    return u;
  });
  $effect(() => {
    const u = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
    return u;
  });

  // ─── Loading and URL sync ─────────────────────────────────────────────

  function urlKey(u: URL): string {
    return `${u.searchParams.get('id') ?? ''}|${u.searchParams.get('range') ?? ''}`;
  }

  // `ready` is false while a load is in flight so the store-to-URL effect
  // never writes an intermediate state. `syncedKey` is the id/range pair the
  // URL held when we last adopted or wrote it; a different key on the `url`
  // prop is an external navigation (back/forward, a pasted link).
  let ready = $state(false);
  let loadedOrg: string | null = null;
  let syncedKey: string | null = null;
  let loadSeq = 0;

  async function load(orgId: string, state: { id: string | null; range: PanelTimeRange | null }) {
    const seq = ++loadSeq;
    ready = false;
    await customDashboardsStore.initialize(orgId, {
      dashboardId: state.id,
      range: state.range,
    });
    if (seq === loadSeq) ready = true;
  }

  $effect(() => {
    const orgId = $currentOrganization?.id ?? null;
    const currentUrl = url;
    if (!browser || !orgId) {
      loadedOrg = null;
      ready = false;
      return;
    }
    const key = urlKey(currentUrl);
    untrack(() => {
      if (orgId !== loadedOrg) {
        const first = loadedOrg === null;
        loadedOrg = orgId;
        customDashboardsStore.reset();
        syncedKey = key;
        // An organization switch starts clean: dashboard ids are per org.
        void load(orgId, first ? readDashboardUrlState(currentUrl) : { id: null, range: null });
      } else if (key !== syncedKey) {
        syncedKey = key;
        void load(orgId, readDashboardUrlState(currentUrl));
      }
    });
  });

  // Store to URL: ?id= for a non-default dashboard, ?range= for the override.
  $effect(() => {
    if (!ready) return;
    const dashboard = $activeDashboard;
    const range = $timeRangeOverride;
    if (!dashboard) return;
    const current = untrack(() => url);
    const next = writeDashboardUrlState(current, {
      id: dashboard.isDefault ? null : dashboard.id,
      range,
    });
    if (next.toString() === current.toString()) return;
    syncedKey = urlKey(next);
    untrack(() => navigate(next));
  });

  function reload() {
    const orgId = get(currentOrganization)?.id;
    if (!orgId) return;
    void load(orgId, readDashboardUrlState(url));
  }

  // ─── Switcher actions ─────────────────────────────────────────────────

  function handleSelect(dashboard: CustomDashboard) {
    void customDashboardsStore.switchTo(dashboard.id);
  }

  function handleCreate() {
    showCreateDashboard = true;
  }

  function handleImport() {
    showYamlImport = true;
  }

  function listErrorOr(fallback: string): string {
    return get(dashboardListError) ?? fallback;
  }

  async function handleExport() {
    if (!$activeDashboard || !$currentOrganization) return;
    const yamlText = await customDashboardsStore.exportYaml(
      $activeDashboard.id,
      $currentOrganization.id
    );
    if (!yamlText) {
      toastStore.error('Failed to export dashboard');
      return;
    }
    const blob = new Blob([yamlText], { type: 'application/x-yaml' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${$activeDashboard.name.replace(/\s+/g, '-')}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  async function handleSetDefault(dashboard: CustomDashboard) {
    if (!$currentOrganization) return;
    try {
      await customDashboardsStore.setAsDefault(dashboard.id, $currentOrganization.id);
      toastStore.success(`"${dashboard.name}" is now the default dashboard`);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to set default');
    }
  }

  function handleDelete() {
    showDelete = true;
  }

  async function confirmDelete() {
    const dashboard = $activeDashboard;
    const org = $currentOrganization;
    if (!dashboard || !org) return;
    const ok = await customDashboardsStore.deleteDashboard(dashboard.id, org.id);
    if (!ok) {
      toastStore.error(listErrorOr('Failed to delete dashboard'));
      return;
    }
    toastStore.success('Dashboard deleted');
    // Fall back to the default; the URL effect then drops ?id=.
    await customDashboardsStore.loadDefault(org.id);
  }

  function handleRename() {
    showRename = true;
  }

  async function handleRenameSave(input: { name: string; description: string | null }) {
    const dashboard = $activeDashboard;
    const org = $currentOrganization;
    if (!dashboard || !org) return;
    const ok = await customDashboardsStore.renameDashboard(
      dashboard.id,
      org.id,
      input.name,
      input.description
    );
    if (!ok) {
      const message = listErrorOr('Failed to rename dashboard');
      toastStore.error(message);
      throw new Error(message);
    }
    toastStore.success('Dashboard renamed');
  }

  async function handleDuplicate() {
    const dashboard = $activeDashboard;
    const org = $currentOrganization;
    if (!dashboard || !org) return;
    const copy = await customDashboardsStore.duplicateDashboard(dashboard.id, org.id);
    if (!copy) {
      toastStore.error(listErrorOr('Failed to duplicate dashboard'));
      return;
    }
    toastStore.success('Dashboard duplicated');
    await customDashboardsStore.switchTo(copy.id);
  }

  async function loadTemplates() {
    templatesLoading = true;
    templatesError = null;
    try {
      templates = await customDashboardsAPI.listTemplates();
    } catch (e) {
      templatesError = e instanceof Error ? e.message : 'Failed to load templates';
    } finally {
      templatesLoading = false;
    }
  }

  function handleCreateFromTemplate() {
    showTemplates = true;
  }

  async function handleTemplateCreate(input: {
    templateId: string;
    name?: string;
    projectId: string | null;
  }) {
    const org = $currentOrganization;
    if (!org) return;
    const created = await customDashboardsStore.createFromTemplate({
      organizationId: org.id,
      templateId: input.templateId,
      projectId: input.projectId,
      name: input.name,
    });
    if (!created) {
      const message = listErrorOr('Failed to create dashboard from template');
      toastStore.error(message);
      throw new Error(message);
    }
    toastStore.success(`Dashboard "${created.name}" created`);
    await customDashboardsStore.switchTo(created.id);
  }

  async function handleCreateConfirm(input: {
    name: string;
    description?: string;
    isPersonal: boolean;
  }) {
    if (!$currentOrganization) return;
    const created = await customDashboardsStore.createDashboard({
      organizationId: $currentOrganization.id,
      name: input.name,
      description: input.description,
      isPersonal: input.isPersonal,
    });
    if (created) {
      toastStore.success(`Dashboard "${created.name}" created`);
      await customDashboardsStore.switchTo(created.id);
    }
  }

  async function handleImportConfirm(yamlText: string) {
    if (!$currentOrganization) return;
    const imported = await customDashboardsStore.importYaml($currentOrganization.id, yamlText);
    if (imported) {
      toastStore.success(`Dashboard "${imported.name}" imported`);
      await customDashboardsStore.switchTo(imported.id);
    }
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────

  let autoRefreshMs = $state(0);
  const autoRefreshOptions = [
    { value: '0', label: 'Auto-refresh off', short: 'Off' },
    { value: '30000', label: 'Every 30s', short: '30s' },
    { value: '60000', label: 'Every 1m', short: '1m' },
    { value: '300000', label: 'Every 5m', short: '5m' },
  ];
  const autoRefreshShort = $derived(
    autoRefreshOptions.find((o) => o.value === String(autoRefreshMs))?.short ?? 'Off'
  );

  function setAutoRefresh(v: string | undefined) {
    autoRefreshMs = v ? parseInt(v, 10) || 0 : 0;
    if (browser) {
      try {
        localStorage.setItem('logtide_dashboard_autorefresh', String(autoRefreshMs));
      } catch {
        // Storage may be blocked; the choice then lasts for this visit only.
      }
    }
  }

  function setDashboardTimeRange(v: string | undefined) {
    if (!v) return;
    void customDashboardsStore.setTimeRangeOverride(
      v === '__default__' ? null : (v as PanelTimeRange)
    );
  }

  $effect(() => {
    if (!browser) return;
    const ms = autoRefreshMs;
    // Pause while editing so a refresh does not clobber unsaved layout edits.
    if (ms <= 0 || $editMode) return;
    const id = setInterval(() => {
      void customDashboardsStore.fetchAllPanelData();
    }, ms);
    return () => clearInterval(id);
  });

  function startEdit() {
    customDashboardsStore.enterEditMode();
  }

  function cancelEdit() {
    customDashboardsStore.cancelEdit();
  }

  async function saveEdit() {
    await customDashboardsStore.saveEdit();
    // saveEdit() always clears `saving` before resolving, so the only
    // reliable success signal is the absence of a saveError.
    if ($dashboardSaveError) {
      toastStore.error($dashboardSaveError);
    } else {
      toastStore.success('Dashboard saved');
    }
  }

  function handleReorder(panels: PanelInstance[]) {
    customDashboardsStore.setPendingPanels(panels);
  }

  function handleResizePanel(panelId: string, layout: PanelLayout) {
    customDashboardsStore.updatePanelLayout(panelId, layout);
  }

  function handleEditPanel(panelId: string) {
    editingPanelId = panelId;
  }

  function handleRemovePanel(panelId: string) {
    customDashboardsStore.removePanel(panelId);
  }

  function handleRefreshPanel(panelId: string) {
    void customDashboardsStore.refreshPanel(panelId);
  }

  function handleTogglePanelPause(panelId: string) {
    customDashboardsStore.togglePanelPause(panelId);
  }

  function handleAddPanelSubmit(panel: PanelInstance) {
    customDashboardsStore.addPanel(panel);
  }

  function handlePanelConfigSave(config: PanelConfig) {
    if (editingPanelId) {
      customDashboardsStore.updatePanelConfig(editingPanelId, config);
    }
    editingPanelId = null;
  }

  // ─── Derived view-state ───────────────────────────────────────────────

  const displayedPanels = $derived(
    $editMode && $pendingPanels !== null ? $pendingPanels : ($activeDashboard?.panels ?? [])
  );

  const editingPanel = $derived(
    editingPanelId ? (displayedPanels.find((p) => p.id === editingPanelId) ?? null) : null
  );

  // ─── Shortcuts ────────────────────────────────────────────────────────

  onMount(() => {
    try {
      const savedAutoRefresh = localStorage.getItem('logtide_dashboard_autorefresh');
      if (savedAutoRefresh) {
        const parsed = parseInt(savedAutoRefresh, 10);
        if (!isNaN(parsed) && parsed >= 0) autoRefreshMs = parsed;
      }
    } catch {
      // Storage may be blocked; fall back to no auto-refresh.
    }
    shortcutsStore.setScope('dashboard');
    shortcutsStore.register([
      {
        id: 'dashboard:refresh',
        combo: 'r',
        label: 'Refresh dashboard',
        scope: 'dashboard',
        category: 'actions',
        action: () => {
          void customDashboardsStore.fetchAllPanelData();
        },
      },
    ]);
  });

  onDestroy(() => {
    shortcutsStore.unregisterScope('dashboard');
    customDashboardsStore.reset();
  });
</script>

<svelte:head>
  <title>{$activeDashboard ? `${$activeDashboard.name} - ` : ''}Dashboards - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Dashboards" description={$activeDashboard?.description ?? undefined}>
    {#snippet meta()}
      <DashboardSwitcher
        dashboards={$dashboardList}
        active={$activeDashboard}
        disabled={$editMode}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onCreateFromTemplate={handleCreateFromTemplate}
        onRename={handleRename}
        onDuplicate={handleDuplicate}
        onImport={handleImport}
        onExport={handleExport}
        onDelete={handleDelete}
        onSetDefault={handleSetDefault}
      />
    {/snippet}
    {#snippet actions()}
      {#if $editMode}
        <Button variant="outline" onclick={() => (showAddPanel = true)} class="gap-2">
          <Plus class="w-4 h-4" />
          Add panel
        </Button>
        <Button variant="ghost" onclick={cancelEdit} disabled={$dashboardSaving} class="gap-2">
          <XIcon class="w-4 h-4" />
          Cancel
        </Button>
        <Button onclick={saveEdit} disabled={$dashboardSaving} class="gap-2">
          <Save class="w-4 h-4" />
          {$dashboardSaving ? 'Saving…' : 'Save'}
        </Button>
      {:else if $activeDashboard}
        <!-- Dashboard-level time override (#305): view-only, never saved.
             "Panel defaults" restores each panel's configured window. -->
        <Select.Root
          type="single"
          value={$timeRangeOverride ?? '__default__'}
          onValueChange={setDashboardTimeRange}
        >
          <Select.Trigger
            class="w-auto gap-2"
            title="Dashboard time range (overrides every panel while active)"
            aria-label="Dashboard time range"
          >
            <Clock class="w-4 h-4 shrink-0 {$timeRangeOverride ? 'text-primary' : 'text-muted-foreground'}" />
            <span class="whitespace-nowrap">
              {$timeRangeOverride ? timeRangeLabel($timeRangeOverride) : 'Panel defaults'}
            </span>
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__default__">Panel defaults</Select.Item>
            {#each TIME_RANGE_OPTIONS as opt (opt.value)}
              <Select.Item value={opt.value}>{opt.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <Select.Root type="single" value={String(autoRefreshMs)} onValueChange={setAutoRefresh}>
          <Select.Trigger class="w-auto gap-2" title="Auto-refresh" aria-label="Auto-refresh">
            <RefreshCw class="w-4 h-4 shrink-0 {autoRefreshMs > 0 ? 'text-primary' : 'text-muted-foreground'}" />
            <span class="whitespace-nowrap">{autoRefreshShort}</span>
          </Select.Trigger>
          <Select.Content>
            {#each autoRefreshOptions as opt (opt.value)}
              <Select.Item value={opt.value}>{opt.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <Button variant="outline" onclick={startEdit} class="gap-2">
          <Pencil class="w-4 h-4" />
          Edit
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <!-- Body -->
  {#if $dashboardLoading && !$activeDashboard}
    <div class="grid gap-4" style="grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 80px;">
      {#each Array(4) as _, i (i)}
        <div style="grid-column: span 3 / span 3; grid-row: span 2 / span 2;">
          <Skeleton class="h-full w-full rounded-lg" />
        </div>
      {/each}
      <div style="grid-column: span 12 / span 12; grid-row: span 4 / span 4;">
        <Skeleton class="h-full w-full rounded-lg" />
      </div>
    </div>
  {:else if $dashboardError}
    <EmptyState variant="error" title="Could not load the dashboard" description={$dashboardError}>
      {#snippet actions()}
        <Button variant="outline" onclick={reload}>Retry</Button>
      {/snippet}
    </EmptyState>
  {:else if $activeDashboard}
    {#if displayedPanels.length === 0}
      <EmptyState
        variant="no-data"
        title="No panels yet"
        description="Add panels to this dashboard, or start from a template."
      >
        {#snippet actions()}
          {#if $editMode}
            <Button onclick={() => (showAddPanel = true)} class="gap-2">
              <Plus class="w-4 h-4" />
              Add panel
            </Button>
          {:else}
            <Button onclick={startEdit} class="gap-2">
              <Pencil class="w-4 h-4" />
              Edit dashboard
            </Button>
          {/if}
          <Button variant="outline" onclick={handleCreateFromTemplate} class="gap-2">
            <LayoutTemplate class="w-4 h-4" />
            Create from template
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <DashboardContainer
        panels={displayedPanels}
        panelData={$panelDataMap}
        editMode={$editMode}
        pausedPanelIds={$pausedPanelIds}
        timeRangeOverride={$timeRangeOverride}
        onReorder={handleReorder}
        onResizePanel={handleResizePanel}
        onEditPanel={handleEditPanel}
        onRemovePanel={handleRemovePanel}
        onRefreshPanel={handleRefreshPanel}
        onTogglePanelPause={handleTogglePanelPause}
      />
    {/if}
  {/if}
</div>

<!-- Dialogs -->
<AddPanelDialog
  bind:open={showAddPanel}
  onAdd={handleAddPanelSubmit}
  onOpenChange={(o) => (showAddPanel = o)}
/>
<PanelConfigDialog
  open={editingPanelId !== null}
  panel={editingPanel}
  onSave={handlePanelConfigSave}
  onOpenChange={(o) => {
    if (!o) editingPanelId = null;
  }}
/>
<CreateDashboardDialog
  bind:open={showCreateDashboard}
  onCreate={handleCreateConfirm}
  onOpenChange={(o) => (showCreateDashboard = o)}
/>
<YamlImportDialog
  bind:open={showYamlImport}
  onImport={handleImportConfirm}
  onOpenChange={(o) => (showYamlImport = o)}
/>
<RenameDashboardDialog
  bind:open={showRename}
  name={$activeDashboard?.name ?? ''}
  description={$activeDashboard?.description ?? null}
  onSave={handleRenameSave}
  onOpenChange={(o) => (showRename = o)}
/>
<CreateFromTemplateDialog
  bind:open={showTemplates}
  {templates}
  loading={templatesLoading}
  error={templatesError}
  onOpen={loadTemplates}
  onCreate={handleTemplateCreate}
  onOpenChange={(o) => (showTemplates = o)}
/>
<ConfirmDialog
  bind:open={showDelete}
  title="Delete dashboard"
  description={`"${$activeDashboard?.name ?? ''}" and its panels will be deleted. This cannot be undone.`}
  confirmLabel="Delete dashboard"
  destructive
  onConfirm={confirmDelete}
/>
