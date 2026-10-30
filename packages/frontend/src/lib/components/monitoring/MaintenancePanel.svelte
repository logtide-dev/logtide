<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import {
    createMaintenance,
    deleteMaintenance,
    listMaintenances,
    type MaintenanceItem,
  } from '$lib/api/status-page';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { stateTone } from '$lib/utils/severity';
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import AffectedComponentsPicker from './AffectedComponentsPicker.svelte';
  import { monitorTitle } from './monitor-meta';
  import { parseUptimeUrl, writeUptimeUrl } from './uptime-url';

  interface Props {
    orgId: string;
    projectId: string;
    monitors: Monitor[];
  }

  let { orgId, projectId, monitors }: Props = $props();

  const STATUS_LABELS: Record<string, string> = {
    scheduled: 'Scheduled',
    in_progress: 'In progress',
    completed: 'Completed',
  };
  // Maintenance states reuse the shared state tones.
  const STATUS_TONES: Record<string, string> = {
    scheduled: 'pending',
    in_progress: 'acknowledged',
    completed: 'resolved',
  };

  let items = $state<MaintenanceItem[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let formOpen = $state(false);
  let title = $state('');
  let description = $state('');
  let start = $state('');
  let end = $state('');
  let suppress = $state(true);
  let monitorIds = $state<string[]>([]);
  let errors = $state<Record<string, string>>({});
  let submitting = $state(false);

  let deleteTarget = $state<MaintenanceItem | null>(null);
  let deleteOpen = $state(false);

  const monitorNames = $derived(new Map(monitors.map((m) => [m.id, monitorTitle(m)])));
  const urlState = $derived(parseUptimeUrl(page.url));

  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await listMaintenances(orgId, projectId);
      items = res.maintenances;
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Could not load maintenance windows';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    orgId;
    projectId;
    untrack(load);
  });

  function openForm() {
    title = '';
    description = '';
    start = '';
    end = '';
    suppress = true;
    monitorIds = [];
    errors = {};
    formOpen = true;
  }

  // create=1 on this tab opens the dialog once per request.
  const wantOpen = $derived(urlState.create && urlState.tab === 'maintenance');
  let lastWant = false;
  $effect(() => {
    const want = wantOpen;
    untrack(() => {
      if (want && !lastWant) openForm();
      lastWant = want;
    });
  });
  $effect(() => {
    if (formOpen) return;
    untrack(() => {
      if (page.url.searchParams.get('create') === '1') {
        goto(writeUptimeUrl(page.url, { create: false }), {
          replaceState: true,
          keepFocus: true,
          noScroll: true,
        });
      }
    });
  });

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = 'Enter a title';
    if (!start) found.start = 'Choose a start time';
    if (!end) found.end = 'Choose an end time';
    if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
      found.end = 'The end must be after the start';
    }
    return found;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    errors = validate();
    if (Object.keys(errors).length > 0) return;
    submitting = true;
    try {
      await createMaintenance({
        organizationId: orgId,
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        autoUpdateStatus: suppress,
        monitorIds,
      });
      toastStore.success('Maintenance scheduled');
      formOpen = false;
      await load();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not schedule the maintenance');
    } finally {
      submitting = false;
    }
  }

  function askDelete(item: MaintenanceItem) {
    deleteTarget = item;
    deleteOpen = true;
  }

  async function confirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    try {
      await deleteMaintenance(item.id, orgId);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not delete the maintenance');
      throw err;
    }
    toastStore.success('Maintenance deleted');
    await load();
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-base font-semibold">Maintenance</h2>
      <p class="text-sm text-muted-foreground">
        Planned windows shown on the status page. Monitor alerts can be paused during a window.
      </p>
    </div>
    <Button size="sm" onclick={openForm}>
      <Plus class="mr-2 h-4 w-4" />
      Schedule maintenance
    </Button>
  </div>

  {#if loadError}
    <EmptyState variant="error" title="Could not load maintenance" description={loadError}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={load}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if !loading && items.length === 0}
    <EmptyState
      variant="no-data"
      icon={CalendarClock as never}
      title="No maintenance scheduled"
      description="Schedule a window to tell visitors about planned work."
    />
  {:else}
    <ul class="space-y-2">
      {#each items as m (m.id)}
        {@const tone = stateTone(STATUS_TONES[m.status] ?? 'pending')}
        <li class="rounded-lg border bg-card px-4 py-3" data-testid="maintenance-row">
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
              >
                {STATUS_LABELS[m.status] ?? m.status}
              </span>
              <span class="text-sm font-medium">{m.title}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onclick={() => askDelete(m)}
              aria-label="Delete {m.title}"
            >
              <Trash2 class="h-4 w-4 text-destructive-text" />
            </Button>
          </div>
          {#if m.description}
            <p class="mt-1 text-xs text-muted-foreground">{m.description}</p>
          {/if}
          <p class="mt-1 text-xs text-muted-foreground">
            <Timestamp value={m.scheduledStart} precision="minute" />
            <span> to </span>
            <Timestamp value={m.scheduledEnd} precision="minute" />
          </p>
          {#if m.monitorIds.length > 0}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each m.monitorIds as mid (mid)}
                <span
                  class="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  data-testid="affected-chip"
                >
                  {monitorNames.get(mid) ?? 'Deleted monitor'}
                </span>
              {/each}
            </div>
          {/if}
          {#if m.autoUpdateStatus}
            <p class="mt-1 text-xs text-muted-foreground">Monitor alerts are paused during the window.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog.Root bind:open={formOpen}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Schedule maintenance</Dialog.Title>
      <Dialog.Description>Times use your browser's time zone.</Dialog.Description>
    </Dialog.Header>
    <form onsubmit={submit} class="grid grid-cols-1 gap-3 sm:grid-cols-2" novalidate>
      <div class="space-y-1.5 sm:col-span-2">
        <Label for="maint-title">Title</Label>
        <Input
          id="maint-title"
          bind:value={title}
          maxlength={255}
          placeholder="Database upgrade"
          aria-invalid={errors.title ? 'true' : undefined}
        />
        {#if errors.title}<p class="text-xs text-destructive-text">{errors.title}</p>{/if}
      </div>
      <div class="space-y-1.5 sm:col-span-2">
        <Label for="maint-description">Description (optional)</Label>
        <textarea
          id="maint-description"
          bind:value={description}
          rows="2"
          maxlength="5000"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>
      <div class="space-y-1.5">
        <Label for="maint-start">Start</Label>
        <Input
          id="maint-start"
          type="datetime-local"
          bind:value={start}
          aria-invalid={errors.start ? 'true' : undefined}
        />
        {#if errors.start}<p class="text-xs text-destructive-text">{errors.start}</p>{/if}
      </div>
      <div class="space-y-1.5">
        <Label for="maint-end">End</Label>
        <Input
          id="maint-end"
          type="datetime-local"
          bind:value={end}
          aria-invalid={errors.end ? 'true' : undefined}
        />
        {#if errors.end}<p class="text-xs text-destructive-text">{errors.end}</p>{/if}
      </div>
      <div class="sm:col-span-2">
        <AffectedComponentsPicker {monitors} bind:selected={monitorIds} />
      </div>
      <div class="sm:col-span-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={suppress} class="rounded" />
          Pause monitor alerts during maintenance
        </label>
      </div>
      <div class="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onclick={() => (formOpen = false)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Scheduling...' : 'Schedule maintenance'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete maintenance"
  description={deleteTarget ? `"${deleteTarget.title}" is removed from the status page.` : undefined}
  confirmLabel="Delete maintenance"
  onConfirm={confirmDelete}
/>
