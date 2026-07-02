<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Spinner from '$lib/components/Spinner.svelte';
  import { receiversAPI, type Receiver, type ReceiverEvent, type ReceiverEventStatus } from '$lib/api/receivers';
  import { toastStore } from '$lib/stores/toast';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  interface Props {
    projectId: string;
    receiver: Receiver | null;
    open?: boolean;
  }

  let { projectId, receiver, open = $bindable(false) }: Props = $props();

  let events = $state<ReceiverEvent[]>([]);
  let loading = $state(false);
  let expandedId = $state<string | null>(null);

  const STATUS_STYLES: Record<ReceiverEventStatus, string> = {
    processed: 'bg-green-500/15 text-green-600 dark:text-green-400',
    skipped: 'bg-secondary text-secondary-foreground',
    failed: 'bg-destructive/15 text-destructive',
    pending: 'bg-muted text-muted-foreground'
  };

  async function loadEvents() {
    if (!receiver) return;
    loading = true;
    try {
      const response = await receiversAPI.listEvents(projectId, receiver.id);
      events = response.events;
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to load receiver events');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open && receiver) {
      expandedId = null;
      loadEvents();
    } else {
      events = [];
    }
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function formatDate(date: string): string {
    return new Date(date).toLocaleString('en-US');
  }
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Recent Events{receiver ? ` - ${receiver.name}` : ''}</DialogTitle>
      <DialogDescription>
        The last events received by this webhook, with their normalized output. Only the most recent
        100 events are kept.
      </DialogDescription>
    </DialogHeader>

    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Spinner />
        <span class="ml-3 text-muted-foreground">Loading events...</span>
      </div>
    {:else if events.length === 0}
      <div class="text-center py-8 text-muted-foreground">
        <p>No events received yet</p>
        <p class="text-sm">Send a test payload to the webhook URL to see it here.</p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each events as event (event.id)}
          <div class="border rounded-md">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
              onclick={() => toggleExpand(event.id)}
            >
              {#if expandedId === event.id}
                <ChevronDown class="w-4 h-4 shrink-0 text-muted-foreground" />
              {:else}
                <ChevronRight class="w-4 h-4 shrink-0 text-muted-foreground" />
              {/if}
              <span
                class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {STATUS_STYLES[event.status]}"
              >
                {event.status}
              </span>
              <span class="text-sm text-muted-foreground">{formatDate(event.receivedAt)}</span>
              {#if event.error}
                <span class="text-xs text-destructive truncate">{event.error}</span>
              {/if}
            </button>
            {#if expandedId === event.id}
              <div class="border-t px-3 py-2 space-y-3">
                <div>
                  <p class="text-xs font-medium mb-1">Raw Payload</p>
                  <pre class="text-xs bg-muted rounded-md p-2 overflow-x-auto max-h-48">{JSON.stringify(event.rawPayload, null, 2)}</pre>
                </div>
                {#if event.normalized}
                  <div>
                    <p class="text-xs font-medium mb-1">Normalized Logs</p>
                    <pre class="text-xs bg-muted rounded-md p-2 overflow-x-auto max-h-48">{JSON.stringify(event.normalized, null, 2)}</pre>
                  </div>
                {/if}
                {#if event.error}
                  <div>
                    <p class="text-xs font-medium mb-1 text-destructive">Error</p>
                    <p class="text-xs text-destructive">{event.error}</p>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </DialogContent>
</Dialog>
