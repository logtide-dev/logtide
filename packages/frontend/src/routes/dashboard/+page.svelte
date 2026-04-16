<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
    editMode,
    pendingPanels,
    dashboardSaving,
    dashboardSaveError,
    panelDataMap,
  } from '$lib/stores/custom-dashboards';
  import DashboardContainer from '$lib/components/custom-dashboards/DashboardContainer.svelte';
  import DashboardSwitcher from '$lib/components/custom-dashboards/DashboardSwitcher.svelte';
  import PanelConfigDialog from '$lib/components/custom-dashboards/PanelConfigDialog.svelte';
  import AddPanelDialog from '$lib/components/custom-dashboards/AddPanelDialog.svelte';
  import CreateDashboardDialog from '$lib/components/custom-dashboards/CreateDashboardDialog.svelte';
  import YamlImportDialog from '$lib/components/custom-dashboards/YamlImportDialog.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Button from '$lib/components/ui/button/button.svelte';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Save from '@lucide/svelte/icons/save';
  import XIcon from '@lucide/svelte/icons/x';
  import Building2 from '@lucide/svelte/icons/building-2';
  import type { CustomDashboard, PanelConfig, PanelInstance } from '@logtide/shared';

  let lastLoadedOrg = $state<string | null>(null);
  let maxWidthClass = $state('max-w-full');
  let containerPadding = $state('px-6 py-8');

  // Dialog state
  let showAddPanel = $state(false);
  let showCreateDashboard = $state(false);
  let showYamlImport = $state(false);
  let editingPanelId = $state<string | null>(null);

  $effect(() => {
    const u = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
    return u;
  });
  $effect(() => {
    const u = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
    return u;
  });

  // ─── Loading dashboards on org change ─────────────────────────────────

  $effect(() => {
    if (!browser || !$currentOrganization) {
      lastLoadedOrg = null;
      return;
    }
    if ($currentOrganization.id === lastLoadedOrg) return;
    lastLoadedOrg = $currentOrganization.id;
    void loadInitial($currentOrganization.id);
  });

  async function loadInitial(orgId: string) {
    customDashboardsStore.reset();
    // Sequence matters: loadDefault may auto-create the org's default
    // dashboard. If we run loadDashboards in parallel, its SELECT can resolve
    // before that INSERT commits and overwrite the merged list with an empty
    // array, leaving the switcher blank.
    await customDashboardsStore.loadDefault(orgId);
    await customDashboardsStore.loadDashboards(orgId);
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
    // Trigger a download
    const blob = new Blob([yamlText], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${$activeDashboard.name.replace(/\s+/g, '-')}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    if (!$activeDashboard || !$currentOrganization) return;
    if (!confirm(`Delete dashboard "${$activeDashboard.name}"? This cannot be undone.`)) {
      return;
    }
    await customDashboardsStore.deleteDashboard(
      $activeDashboard.id,
      $currentOrganization.id
    );
    toastStore.success('Dashboard deleted');
    // Fall back to default
    await customDashboardsStore.loadDefault($currentOrganization.id);
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
    const imported = await customDashboardsStore.importYaml(
      $currentOrganization.id,
      yamlText
    );
    if (imported) {
      toastStore.success(`Dashboard "${imported.name}" imported`);
      await customDashboardsStore.switchTo(imported.id);
    }
  }

  // ─── Edit mode ────────────────────────────────────────────────────────

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

  function handleResizePanel(panelId: string, layout: import('@logtide/shared').PanelLayout) {
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
    $editMode && $pendingPanels !== null
      ? $pendingPanels
      : ($activeDashboard?.panels ?? [])
  );

  const editingPanel = $derived(
    editingPanelId
      ? displayedPanels.find((p) => p.id === editingPanelId) ?? null
      : null
  );

  // ─── Shortcuts ────────────────────────────────────────────────────────

  onMount(() => {
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

<div class="container mx-auto space-y-6 {containerPadding} {maxWidthClass}">
  <!-- Header -->
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="space-y-2">
      <div class="flex items-center gap-3">
        <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
        <DashboardSwitcher
          dashboards={$dashboardList}
          active={$activeDashboard}
          disabled={$editMode}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onImport={handleImport}
          onExport={handleExport}
          onDelete={handleDelete}
        />
      </div>
      {#if $currentOrganization}
        <div class="flex items-center gap-2">
          <Building2 class="w-4 h-4 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            {$currentOrganization.name}
            {#if $activeDashboard?.description}
              • {$activeDashboard.description}
            {/if}
          </p>
        </div>
      {/if}
    </div>

    <!-- Edit toolbar -->
    <div class="flex items-center gap-2">
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
        <Button variant="outline" onclick={startEdit} class="gap-2">
          <Pencil class="w-4 h-4" />
          Edit
        </Button>
      {/if}
    </div>
  </div>

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
    <div class="text-center py-24">
      <p class="text-destructive mb-4">{$dashboardError}</p>
      <button
        class="text-primary hover:underline"
        onclick={() => $currentOrganization && loadInitial($currentOrganization.id)}
      >
        Retry
      </button>
    </div>
  {:else if $activeDashboard}
    {#if displayedPanels.length === 0}
      <div class="text-center py-24 border border-dashed rounded-lg">
        <p class="text-muted-foreground mb-4">This dashboard has no panels yet.</p>
        {#if $editMode}
          <Button onclick={() => (showAddPanel = true)} class="gap-2">
            <Plus class="w-4 h-4" />
            Add your first panel
          </Button>
        {:else}
          <Button onclick={startEdit} class="gap-2">
            <Pencil class="w-4 h-4" />
            Edit dashboard
          </Button>
        {/if}
      </div>
    {:else}
      <DashboardContainer
        panels={displayedPanels}
        panelData={$panelDataMap}
        editMode={$editMode}
        onReorder={handleReorder}
        onResizePanel={handleResizePanel}
        onEditPanel={handleEditPanel}
        onRemovePanel={handleRemovePanel}
        onRefreshPanel={handleRefreshPanel}
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
