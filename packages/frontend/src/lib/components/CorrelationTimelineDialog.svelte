<script lang="ts">
  import { correlationAPI, type CorrelatedLog } from '$lib/api/correlation';
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { Badge } from '$lib/components/ui/badge';

  interface Props {
    open: boolean;
    projectId: string;
    identifierType: string;
    identifierValue: string;
    referenceTime?: string;
    onClose: () => void;
    onLogClick?: (log: CorrelatedLog) => void;
  }

  let {
    open = false,
    projectId,
    identifierType,
    identifierValue,
    referenceTime,
    onClose,
    onLogClick,
  }: Props = $props();

  let loading = $state(false);
  let error = $state('');
  let correlatedLogs = $state<CorrelatedLog[]>([]);
  let timeWindow = $state<{ from: string; to: string } | null>(null);
  let total = $state(0);

  $effect(() => {
    if (open && identifierValue && projectId) {
      loadCorrelatedLogs();
    } else {
      correlatedLogs = [];
      error = '';
      timeWindow = null;
      total = 0;
    }
  });

  async function loadCorrelatedLogs() {
    loading = true;
    error = '';

    try {
      const result = await correlationAPI.getCorrelatedLogs({
        projectId,
        identifierValue,
        referenceTime,
        timeWindowMinutes: 15,
        limit: 100,
      });

      correlatedLogs = result.logs;
      timeWindow = result.timeWindow;
      total = result.total;
    } catch (e) {
      console.error('Failed to load correlated logs:', e);
      error = e instanceof Error ? e.message : 'Failed to load correlated logs';
    } finally {
      loading = false;
    }
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatShortTime(timestamp: string): string {
    const date = new Date(timestamp);
    // Include milliseconds manually since fractionalSecondDigits may not be supported
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${timeStr}.${ms}`;
  }

  function getLevelColor(level: string): string {
    switch (level) {
      case 'debug':
        return 'bg-gray-100 text-gray-800';
      case 'info':
        return 'bg-blue-100 text-blue-800';
      case 'warn':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'critical':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  function formatIdentifierType(type: string): string {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function handleLogClick(log: CorrelatedLog) {
    if (onLogClick) {
      onLogClick(log);
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <span>Correlated Events</span>
      </Dialog.Title>
      <Dialog.Description>
        <span>
          Showing all events with <strong>{formatIdentifierType(identifierType)}</strong>:
          <code class="font-mono text-xs bg-muted px-1 py-0.5 rounded ml-1">{identifierValue}</code>
        </span>
        {#if timeWindow}
          <div class="text-xs mt-1 text-muted-foreground">
            Time window: {formatTime(timeWindow.from)} to {formatTime(timeWindow.to)} (±15 minutes)
          </div>
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto py-4 min-h-0">
      {#if loading}
        <div class="flex items-center justify-center py-12">
          <Spinner />
          <span class="ml-3 text-muted-foreground">Loading correlated events...</span>
        </div>
      {:else if error}
        <div class="text-center py-12 text-destructive">
          {error}
        </div>
      {:else if correlatedLogs.length === 0}
        <div class="text-center py-12 text-muted-foreground">
          <p>No correlated events found in the time window</p>
          <p class="text-sm mt-2">
            Try expanding the time range or check if logs with this identifier exist
          </p>
        </div>
      {:else}
        <div class="space-y-1">
          <div class="text-sm font-medium text-muted-foreground mb-4 px-1">
            Found {total} correlated event{total !== 1 ? 's' : ''} across services
          </div>

          <!-- Timeline entries -->
          <div class="relative">
            <!-- Timeline line -->
            <div class="absolute left-[7px] top-0 bottom-0 w-0.5 bg-border"></div>

            {#each correlatedLogs as log, index (log.id)}
              <button
                class="relative flex items-start gap-4 pl-6 py-3 w-full text-left hover:bg-accent/50 transition-colors rounded-md cursor-pointer"
                onclick={() => handleLogClick(log)}
              >
                <!-- Timeline dot -->
                <div
                  class="absolute left-0 top-4 w-4 h-4 rounded-full border-2 border-background {log.level === 'error' || log.level === 'critical' ? 'bg-red-500' : 'bg-primary'}"
                ></div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap mb-1">
                    <span class="text-xs text-muted-foreground font-mono">
                      {formatShortTime(log.time)}
                    </span>
                    <Badge variant="outline" class="text-xs">
                      {log.service}
                    </Badge>
                    <span
                      class="px-2 py-0.5 text-xs font-medium rounded-full {getLevelColor(log.level)}"
                    >
                      {log.level.toUpperCase()}
                    </span>
                    {#if log.traceId}
                      <span class="px-2 py-0.5 text-xs font-mono bg-indigo-100 text-indigo-800 rounded">
                        trace: {log.traceId.substring(0, 8)}...
                      </span>
                    {/if}
                  </div>
                  <p class="text-sm truncate">{log.message}</p>
                  {#if log.metadata && Object.keys(log.metadata).length > 0}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
                    <details class="text-xs mt-2" onclick={(e) => e.stopPropagation()}>
                      <summary class="cursor-pointer text-muted-foreground hover:text-foreground">
                        View metadata
                      </summary>
                      <pre class="mt-2 p-2 bg-muted rounded overflow-x-auto text-xs max-h-32">{JSON.stringify(log.metadata, null, 2)}</pre>
                    </details>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer class="border-t pt-4">
      <div class="flex items-center justify-between w-full">
        <a
          href="/dashboard/settings/patterns"
          class="text-sm text-primary hover:underline"
        >
          Configure custom patterns
        </a>
        <Button variant="outline" onclick={onClose}>Close</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
