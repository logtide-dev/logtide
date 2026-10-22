<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import { addMetricPanelToDashboard, listDashboardsForPicker } from '$lib/api/metrics';
  import { toMetricPanelConfig, type MetricQueryState, type PanelRangeInput } from '$lib/utils/metrics-query';

  interface Props {
    open: boolean;
    organizationId: string;
    query: MetricQueryState;
    projectId: string;
    range: PanelRangeInput;
  }

  let { open = $bindable(false), organizationId, query, projectId, range }: Props = $props();

  let dashboards = $state<{ id: string; name: string }[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let selectedId = $state('');
  let saving = $state(false);

  let resolved = $derived(toMetricPanelConfig(query, projectId, range));

  $effect(() => {
    if (!open) return;
    selectedId = '';
    loadError = null;
    loading = true;
    let cancelled = false;
    listDashboardsForPicker(organizationId)
      .then((list) => {
        if (!cancelled) dashboards = list;
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

  async function confirm() {
    const target = dashboards.find((d) => d.id === selectedId);
    if (!target || saving) return;
    saving = true;
    try {
      await addMetricPanelToDashboard({
        organizationId,
        dashboardId: target.id,
        config: resolved.config,
      });
      open = false;
      toast.success(`Panel added to ${target.name}`, {
        action: { label: 'Open dashboard', onClick: () => goto(`/dashboard?id=${encodeURIComponent(target.id)}`) },
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
      <Dialog.Description>
        Save this chart as a panel on one of your custom dashboards.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-3">
      <div class="space-y-1">
        <label class="text-sm font-medium" for="add-to-dashboard-select">Dashboard</label>
        <select
          id="add-to-dashboard-select"
          class="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
          bind:value={selectedId}
          disabled={loading || dashboards.length === 0}
        >
          <option value="">{loading ? 'Loading dashboards' : 'Select dashboard'}</option>
          {#each dashboards as dashboard (dashboard.id)}
            <option value={dashboard.id}>{dashboard.name}</option>
          {/each}
        </select>
        {#if loadError}
          <p class="text-sm text-destructive-text" role="alert">{loadError}</p>
        {:else if !loading && dashboards.length === 0}
          <p class="text-sm text-muted-foreground">You have no custom dashboards yet. Create one first.</p>
        {/if}
      </div>

      {#if resolved.dropped.length > 0}
        <p class="rounded-md border bg-muted/40 p-2 text-sm text-muted-foreground" role="note">
          Not saved to the panel yet: {resolved.dropped.join(', ')}
        </p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button type="button" disabled={!selectedId || saving} onclick={confirm}>Add panel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
