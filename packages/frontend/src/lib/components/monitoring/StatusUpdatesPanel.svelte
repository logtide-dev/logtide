<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import {
    deleteStatusUpdate,
    getStatusPageConfig,
    listStatusUpdates,
    postStatusUpdateMessage,
    type StatusUpdateItem,
    type StatusUpdateStatus,
  } from '$lib/api/status-page';
  import Button from '$lib/components/ui/button/button.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { severityTone, stateTone } from '$lib/utils/severity';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import StatusUpdateForm from './StatusUpdateForm.svelte';
  import {
    STATUS_UPDATE_STATUSES,
    monitorTitle,
    statusUpdateSeverityLabel,
    statusUpdateSeverityTone,
    statusUpdateStatusLabel,
  } from './monitor-meta';
  import { parseUptimeUrl, writeUptimeUrl, type StatusUpdatePrefill } from './uptime-url';

  interface Props {
    orgId: string;
    projectId: string;
    monitors: Monitor[];
    prefill?: StatusUpdatePrefill | null;
  }

  let { orgId, projectId, monitors, prefill = null }: Props = $props();

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  let items = $state<StatusUpdateItem[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let subscriptionsAvailable = $state(false);

  let createOpen = $state(false);

  let updateTarget = $state<StatusUpdateItem | null>(null);
  let updateOpen = $state(false);
  let updateStatus = $state<StatusUpdateStatus>('investigating');
  let updateMessage = $state('');
  let posting = $state(false);

  let deleteTarget = $state<StatusUpdateItem | null>(null);
  let deleteOpen = $state(false);

  const monitorNames = $derived(new Map(monitors.map((m) => [m.id, monitorTitle(m)])));
  const urlState = $derived(parseUptimeUrl(page.url));

  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await listStatusUpdates(orgId, projectId);
      items = res.incidents;
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Could not load status updates';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Reload when the organization or project changes.
    orgId;
    projectId;
    untrack(load);
  });

  $effect(() => {
    const o = orgId;
    const p = projectId;
    let cancelled = false;
    getStatusPageConfig(o, p)
      .then((res) => {
        if (!cancelled) subscriptionsAvailable = res.subscriptionsAvailable;
      })
      .catch(() => {
        if (!cancelled) subscriptionsAvailable = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // The dialog opens when the URL asks for it (create=1) or a prefill arrives, once per request.
  const wantOpen = $derived(!!prefill || (urlState.create && urlState.tab === 'status-updates'));
  let lastWant = false;
  $effect(() => {
    const want = wantOpen;
    untrack(() => {
      if (want && !lastWant) createOpen = true;
      lastWant = want;
    });
  });

  // Closing the dialog drops create=1 and the prefill from the URL.
  $effect(() => {
    if (createOpen) return;
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

  function openCreate() {
    createOpen = true;
  }

  function openPostUpdate(item: StatusUpdateItem) {
    updateTarget = item;
    updateStatus = item.status;
    updateMessage = '';
    updateOpen = true;
  }

  async function submitUpdate(e: Event) {
    e.preventDefault();
    if (!updateTarget || !updateMessage.trim() || posting) return;
    posting = true;
    try {
      await postStatusUpdateMessage(updateTarget.id, orgId, {
        status: updateStatus,
        message: updateMessage.trim(),
      });
      toastStore.success('Status update posted');
      updateOpen = false;
      await load();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not post the update');
    } finally {
      posting = false;
    }
  }

  function askDelete(item: StatusUpdateItem) {
    deleteTarget = item;
    deleteOpen = true;
  }

  async function confirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    try {
      await deleteStatusUpdate(item.id, orgId);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not delete the status update');
      throw err;
    }
    toastStore.success('Status update deleted');
    await load();
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-base font-semibold">Status updates</h2>
      <p class="text-sm text-muted-foreground">Messages shown on your public status page.</p>
    </div>
    <Button size="sm" onclick={openCreate}>
      <Plus class="mr-2 h-4 w-4" />
      New status update
    </Button>
  </div>

  {#if loadError}
    <EmptyState variant="error" title="Could not load status updates" description={loadError}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={load}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if !loading && items.length === 0}
    <EmptyState
      variant="no-data"
      icon={AlertTriangle as never}
      title="No status updates yet"
      description="Publish an update to tell visitors about an incident or a degraded service."
    />
  {:else}
    <ul class="space-y-2">
      {#each items as item (item.id)}
        {@const sevTone = severityTone(statusUpdateSeverityTone(item.severity))}
        {@const statusTone = stateTone(item.status)}
        <li class="rounded-lg border bg-card px-4 py-3" data-testid="status-update-row">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {sevTone.badge}"
              >
                {statusUpdateSeverityLabel(item.severity)}
              </span>
              <span class="text-sm font-medium">{item.title}</span>
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {statusTone.badge}"
              >
                {statusUpdateStatusLabel(item.status)}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onclick={() => openPostUpdate(item)}
                aria-label="Post an update to {item.title}"
              >
                <MessageSquarePlus class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => askDelete(item)}
                aria-label="Delete {item.title}"
              >
                <Trash2 class="h-4 w-4 text-destructive-text" />
              </Button>
            </div>
          </div>
          {#if item.monitorIds.length > 0}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each item.monitorIds as mid (mid)}
                <span
                  class="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  data-testid="affected-chip"
                >
                  {monitorNames.get(mid) ?? 'Deleted monitor'}
                </span>
              {/each}
            </div>
          {/if}
          <p class="mt-1 text-xs text-muted-foreground">
            <Timestamp value={item.createdAt} />
            {#if item.sourceIncidentId}
              <span aria-hidden="true"> - </span>
              <a href="/dashboard/incidents/{item.sourceIncidentId}" class="hover:underline">
                Linked incident
              </a>
            {/if}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<StatusUpdateForm
  bind:open={createOpen}
  {orgId}
  {projectId}
  {monitors}
  {prefill}
  {subscriptionsAvailable}
  onSaved={load}
/>

<Dialog.Root bind:open={updateOpen}>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Post an update</Dialog.Title>
      {#if updateTarget}
        <Dialog.Description>{updateTarget.title}</Dialog.Description>
      {/if}
    </Dialog.Header>
    <form onsubmit={submitUpdate} class="space-y-3">
      <div class="space-y-1.5">
        <Label for="post-update-status">Status</Label>
        <select id="post-update-status" class={selectClass} bind:value={updateStatus}>
          {#each STATUS_UPDATE_STATUSES as s (s.value)}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
        {#if updateStatus === 'resolved'}
          <p class="text-xs text-muted-foreground">Posting this marks the status update as resolved.</p>
        {/if}
      </div>
      <div class="space-y-1.5">
        <Label for="post-update-message">Message</Label>
        <textarea
          id="post-update-message"
          bind:value={updateMessage}
          rows="3"
          maxlength="5000"
          placeholder="What changed?"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (updateOpen = false)}>Cancel</Button>
        <Button type="submit" disabled={posting || !updateMessage.trim()}>
          {posting ? 'Posting...' : 'Post update'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete status update"
  description={deleteTarget
    ? `"${deleteTarget.title}" is removed from the public status page.`
    : undefined}
  confirmLabel="Delete status update"
  onConfirm={confirmDelete}
/>
