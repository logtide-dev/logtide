<script lang="ts">
  import { untrack } from 'svelte';
  import { correlationAPI, type CorrelatedLog } from '$lib/api/correlation';
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import { createRequestGuard } from '$lib/components/search/request-guard';
  import { formatRange, formatTimestamp } from '$lib/utils/datetime';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { levelTone } from '$lib/utils/severity';

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

  const WINDOWS = [
    { label: '15m', minutes: 15 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
  ] as const;

  const guard = createRequestGuard();

  let windowMinutes = $state<number>(15);
  let loading = $state(false);
  let error = $state('');
  let correlatedLogs = $state<CorrelatedLog[]>([]);
  let timeWindow = $state<{ from: string; to: string } | null>(null);
  let total = $state(0);

  // Every opening (or another identifier) starts from the 15 minute window.
  let anchorKey: string | null = null;
  $effect(() => {
    const key =
      open && identifierValue && projectId
        ? `${projectId}|${identifierType}|${identifierValue}|${referenceTime ?? ''}`
        : null;
    if (key === anchorKey) return;
    anchorKey = key;
    untrack(() => {
      guard.invalidate();
      windowMinutes = 15;
      correlatedLogs = [];
      error = '';
      timeWindow = null;
      total = 0;
      loading = false;
      if (key) void loadCorrelatedLogs();
    });
  });

  async function loadCorrelatedLogs() {
    const token = guard.begin();
    loading = true;
    error = '';
    try {
      const result = await correlationAPI.getCorrelatedLogs({
        projectId,
        identifierValue,
        referenceTime,
        timeWindowMinutes: windowMinutes,
        limit: 100,
      });
      if (!guard.isCurrent(token)) return;
      correlatedLogs = result.logs;
      timeWindow = result.timeWindow;
      total = result.total;
    } catch (e) {
      if (!guard.isCurrent(token)) return;
      console.error('Failed to load correlated logs:', e);
      error = e instanceof Error ? e.message : 'Failed to load correlated logs';
    } finally {
      if (guard.isCurrent(token)) loading = false;
    }
  }

  function selectWindow(minutes: number) {
    if (minutes === windowMinutes) return;
    windowMinutes = minutes;
    void loadCorrelatedLogs();
  }

  function time(value: string): string {
    void $displayPreferences;
    return formatTimestamp(value, { precision: 'ms', withDate: true });
  }

  const rangeText = $derived.by(() => {
    void $displayPreferences;
    return timeWindow ? formatRange(timeWindow.from, timeWindow.to) : '';
  });

  function formatIdentifierType(type: string): string {
    const text = type.replace(/_/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function shortTrace(traceId: string): string {
    return traceId.length > 8 ? `${traceId.substring(0, 8)}...` : traceId;
  }
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <Dialog.Content class="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Correlated events</Dialog.Title>
      <Dialog.Description>
        <span>
          Showing all events with <strong>{formatIdentifierType(identifierType)}</strong>:
          <code class="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">{identifierValue}</code>
        </span>
        {#if timeWindow}
          <span class="mt-1 block text-xs text-muted-foreground">Time window: {rangeText}</span>
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground" id="correlation-window-label">Window</span>
      <div class="inline-flex rounded-md border p-0.5" role="group" aria-labelledby="correlation-window-label">
        {#each WINDOWS as option (option.minutes)}
          <button
            type="button"
            class="rounded px-2.5 py-1 text-xs font-medium transition-colors {windowMinutes === option.minutes
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
            aria-pressed={windowMinutes === option.minutes}
            title="{option.label} around the log"
            onclick={() => selectWindow(option.minutes)}
          >
            {option.label}
          </button>
        {/each}
      </div>
      {#if loading && correlatedLogs.length > 0}
        <Spinner size="sm" />
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-4">
      {#if loading && correlatedLogs.length === 0}
        <div class="flex items-center justify-center py-12">
          <Spinner />
          <span class="ml-3 text-muted-foreground">Loading correlated events</span>
        </div>
      {:else if error}
        <div class="py-12 text-center text-destructive">
          {error}
        </div>
      {:else if correlatedLogs.length === 0}
        <div class="py-12 text-center text-muted-foreground">
          <p>No correlated events found in the time window</p>
          <p class="mt-2 text-sm">Try a wider window or check that logs with this identifier exist</p>
        </div>
      {:else}
        <div class="space-y-1">
          <div class="mb-4 px-1 text-sm font-medium text-muted-foreground">
            Found {total.toLocaleString('en-US')} correlated event{total !== 1 ? 's' : ''} across services
          </div>

          <div class="relative">
            <div class="absolute bottom-0 left-[7px] top-0 w-0.5 bg-border"></div>

            {#each correlatedLogs as log (log.id)}
              <div class="relative rounded-md transition-colors hover:bg-accent/50">
                <button
                  type="button"
                  class="relative flex w-full cursor-pointer items-start gap-4 rounded-md pl-6 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {log.metadata && Object.keys(log.metadata).length > 0 ? 'pb-1' : 'pb-3'}"
                  onclick={() => onLogClick?.(log)}
                >
                  <span
                    data-testid="timeline-dot"
                    class="absolute left-0 top-4 h-4 w-4 rounded-full border-2 border-background {levelTone(log.level).dot}"
                    aria-hidden="true"
                  ></span>

                  <span class="min-w-0 flex-1">
                    <span class="mb-1 flex flex-wrap items-center gap-2">
                      <span class="font-mono text-xs text-muted-foreground">{time(log.time)}</span>
                      <Badge variant="outline" class="text-xs">{log.service}</Badge>
                      <SeverityBadge kind="level" value={log.level} />
                      {#if log.traceId}
                        <span class="rounded border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                          trace: {shortTrace(log.traceId)}
                        </span>
                      {/if}
                    </span>
                    <span class="block truncate text-sm">{log.message}</span>
                  </span>
                </button>
                {#if log.metadata && Object.keys(log.metadata).length > 0}
                  <details class="pb-3 pl-6 text-xs">
                    <summary class="cursor-pointer text-muted-foreground hover:text-foreground">
                      View metadata
                    </summary>
                    <pre class="mt-2 max-h-32 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(log.metadata, null, 2)}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer class="border-t pt-4">
      <div class="flex w-full items-center justify-between">
        <a href="/dashboard/settings/patterns" class="text-sm text-primary hover:underline">
          Configure custom patterns
        </a>
        <Button variant="outline" onclick={onClose}>Close</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
