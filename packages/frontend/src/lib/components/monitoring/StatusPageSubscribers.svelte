<script lang="ts">
  import { untrack } from 'svelte';
  import { toastStore } from '$lib/stores/toast';
  import {
    listStatusSubscribers,
    removeStatusSubscriber,
    type StatusSubscriber,
  } from '$lib/api/status-page';
  import Button from '$lib/components/ui/button/button.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  interface Props {
    orgId: string;
    projectId: string;
  }

  let { orgId, projectId }: Props = $props();

  let subscribers = $state<StatusSubscriber[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let deleteTarget = $state<StatusSubscriber | null>(null);
  let deleteOpen = $state(false);
  let seq = 0;

  async function load() {
    const mine = ++seq;
    loading = true;
    loadError = null;
    try {
      const res = await listStatusSubscribers(orgId, projectId);
      if (mine !== seq) return;
      subscribers = res.subscribers;
      total = res.total;
    } catch (err) {
      if (mine !== seq) return;
      loadError = err instanceof Error ? err.message : 'Could not load subscribers';
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    orgId;
    projectId;
    untrack(load);
  });

  function askRemove(s: StatusSubscriber) {
    deleteTarget = s;
    deleteOpen = true;
  }

  async function confirmRemove() {
    const target = deleteTarget;
    if (!target) return;
    try {
      await removeStatusSubscriber(target.id, orgId);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not remove the subscriber');
      throw err;
    }
    toastStore.success('Subscriber removed');
    await load();
  }
</script>

<section class="space-y-3 rounded-lg border bg-card px-4 py-4" aria-labelledby="sp-subscribers-heading">
  <div>
    <h3 id="sp-subscribers-heading" class="text-sm font-semibold">
      Email subscribers ({total.toLocaleString('en-US')})
    </h3>
    <p class="text-xs text-muted-foreground">
      Visitors confirm their address by email and get status updates and maintenance notices.
    </p>
  </div>

  {#if loadError}
    <p class="text-sm text-destructive-text" role="alert">{loadError}</p>
  {:else if !loading && subscribers.length === 0}
    <p class="text-sm text-muted-foreground">No confirmed subscribers yet.</p>
  {:else}
    <ul class="divide-y rounded-md border">
      {#each subscribers as s (s.id)}
        <li class="flex items-center justify-between gap-2 px-3 py-2" data-testid="subscriber-row">
          <div class="min-w-0">
            <p class="truncate text-sm">{s.email}</p>
            {#if s.confirmedAt}
              <p class="text-xs text-muted-foreground">
                Confirmed <Timestamp value={s.confirmedAt} precision="minute" />
              </p>
            {/if}
          </div>
          <Button variant="ghost" size="icon" onclick={() => askRemove(s)} aria-label="Remove {s.email}">
            <Trash2 class="h-4 w-4 text-destructive-text" />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Remove subscriber"
  description={deleteTarget ? `${deleteTarget.email} stops receiving status emails.` : undefined}
  confirmLabel="Remove subscriber"
  onConfirm={confirmRemove}
/>
