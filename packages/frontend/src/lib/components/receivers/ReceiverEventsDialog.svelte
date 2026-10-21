<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Spinner from '$lib/components/Spinner.svelte';
  import { receiversAPI, type Receiver, type ReceiverEvent, type ReceiverEventStatus } from '$lib/api/receivers';
  import { toastStore } from '$lib/stores/toast';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { stateTone } from '$lib/utils/severity';
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

  const STATUS_TONES: Record<ReceiverEventStatus, string> = {
    processed: 'ok',
    skipped: 'disabled',
    failed: 'failed',
    pending: 'pending'
  };

  async function loadEvents() {
    if (!receiver) return;
    loading = true;
    try {
      const response = await receiversAPI.listEvents(projectId, receiver.id);
      events = response.events;
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not load inbound webhook events');
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
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Inbound webhook events{receiver ? `: ${receiver.name}` : ''}</DialogTitle>
      <DialogDescription>
        The last events received by this inbound webhook, with their normalized output. Only the most recent
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
                <ChevronDown class="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {:else}
                <ChevronRight class="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {/if}
              <span
                class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold {stateTone(STATUS_TONES[event.status]).badge}"
              >
                {event.status}
              </span>
              <span class="text-sm text-muted-foreground"><Timestamp value={event.receivedAt} precision="second" /></span>
              {#if event.error}
                <span class="text-xs text-destructive-text truncate">{event.error}</span>
              {/if}
            </button>
            {#if expandedId === event.id}
              <div class="border-t px-3 py-2 space-y-3">
                <div>
                  <p class="text-xs font-medium mb-1">Raw payload</p>
                  <pre class="text-xs bg-muted rounded-md p-2 overflow-x-auto max-h-48">{JSON.stringify(event.rawPayload, null, 2)}</pre>
                </div>
                {#if event.normalized}
                  <div>
                    <p class="text-xs font-medium mb-1">Normalized logs</p>
                    <pre class="text-xs bg-muted rounded-md p-2 overflow-x-auto max-h-48">{JSON.stringify(event.normalized, null, 2)}</pre>
                  </div>
                {/if}
                {#if event.error}
                  <div>
                    <p class="text-xs font-medium mb-1 text-destructive-text">Error</p>
                    <p class="text-xs text-destructive-text">{event.error}</p>
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
