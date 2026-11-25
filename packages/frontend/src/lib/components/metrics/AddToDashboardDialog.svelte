<!--
  Saves the current explorer query as a `metrics` panel on a custom dashboard,
  or on a new dashboard created from this dialog.

  Props:
    open            bindable
    organizationId
    query           MetricExplorerQuery to save (projectIds already follow the scope)
    range           scope time range; mapped to the closest panel preset
-->
<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import type { MetricExplorerQuery, MetricsPanelConfig } from '@logtide/shared';
  import { customDashboardsAPI } from '$lib/api/custom-dashboards';
  import type { TimeRangeValue } from '$lib/stores/scope-url';
  import { defaultPanelTitle, panelTimeRangeFor } from '$lib/utils/metrics-explore';
  import * as Dialog from '$lib/components/ui/dialog';
  import { SelectField } from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    open: boolean;
    organizationId: string;
    query: MetricExplorerQuery;
    range: TimeRangeValue;
  }

  let { open = $bindable(false), organizationId, query, range }: Props = $props();

  const NEW = '__new__';

  let dashboards = $state<{ id: string; name: string }[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let selectedId = $state('');
  let newName = $state('');
  let title = $state('');
  let saving = $state(false);

  const options = $derived([
    { value: NEW, label: 'New dashboard' },
    ...dashboards.map((d) => ({ value: d.id, label: d.name })),
  ]);
  const creating = $derived(selectedId === NEW);
  const canSave = $derived(!saving && selectedId !== '' && title.trim() !== '' && (!creating || newName.trim() !== ''));

  $effect(() => {
    if (!open) return;
    selectedId = '';
    newName = '';
    title = defaultPanelTitle(query);
    loadError = null;
    loading = true;
    let cancelled = false;
    customDashboardsAPI
      .list(organizationId)
      .then((list) => {
        if (!cancelled) dashboards = list.map((d) => ({ id: d.id, name: d.name }));
      })
      .catch((err: Error) => {
        if (!cancelled) loadError = err.message;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function buildConfig(): MetricsPanelConfig {
    return {
      type: 'metrics',
      title: title.trim(),
      source: 'metrics',
      query: JSON.parse(JSON.stringify(query)) as MetricExplorerQuery,
      timeRange: panelTimeRangeFor(range),
    };
  }

  async function confirm() {
    if (!canSave) return;
    saving = true;
    try {
      let targetId = selectedId;
      let targetName = dashboards.find((d) => d.id === selectedId)?.name ?? '';
      if (creating) {
        const created = await customDashboardsAPI.create({ organizationId, name: newName.trim(), panels: [] });
        targetId = created.id;
        targetName = created.name;
      }
      await customDashboardsAPI.addPanel(targetId, organizationId, buildConfig());
      open = false;
      toast.success(`Panel added to ${targetName}`, {
        action: { label: 'Open dashboard', onClick: () => goto(`/dashboard?id=${encodeURIComponent(targetId)}`) },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the panel');
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Add to dashboard</Dialog.Title>
      <Dialog.Description>Save this query as a panel on a dashboard.</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-3">
      <div class="space-y-1">
        <label class="text-sm font-medium" for="add-to-dashboard-title">Panel title</label>
        <Input id="add-to-dashboard-title" bind:value={title} />
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium" for="add-to-dashboard-select">Dashboard</label>
        <SelectField
          id="add-to-dashboard-select"
          class="w-full"
          bind:value={selectedId}
          {options}
          placeholder={loading ? 'Loading dashboards' : 'Select dashboard'}
          disabled={loading}
        />
        {#if loadError}
          <p class="text-sm text-destructive-text" role="alert">{loadError}</p>
        {/if}
      </div>
      {#if creating}
        <div class="space-y-1">
          <label class="text-sm font-medium" for="add-to-dashboard-name">Dashboard name</label>
          <Input id="add-to-dashboard-name" bind:value={newName} placeholder="Infrastructure" />
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button type="button" disabled={!canSave} onclick={confirm}>Add panel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
