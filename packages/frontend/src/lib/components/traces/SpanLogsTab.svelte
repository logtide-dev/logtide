<script lang="ts">
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { tracesAPI, type SpanRecord, type TraceRecord, type SpanLog } from '$lib/api/traces';
  import { paddedWindow, traceLogsUrl, spanLogsUrl } from '$lib/utils/trace-links';
  import { createLatest } from '$lib/utils/latest';

  interface Props {
    projectId: string;
    span: SpanRecord;
    trace: TraceRecord;
  }

  let { projectId, span, trace }: Props = $props();

  const LIMIT = 50;
  const guard = createLatest();

  let logs = $state<SpanLog[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let loaded = $state(false);

  // The trace window padded by 5 minutes; a broken trace window falls back to
  // the span's own.
  const logWindow = $derived(paddedWindow(trace) ?? paddedWindow(span));

  async function load() {
    const isCurrent = guard.begin();
    const win = logWindow;
    if (!win) {
      logs = [];
      loaded = true;
      return;
    }
    loading = true;
    error = null;
    try {
      const rows = await tracesAPI.getSpanLogs({
        projectId,
        spanId: span.span_id,
        from: win.from,
        to: win.to,
        limit: LIMIT,
      });
      if (!isCurrent()) return;
      logs = rows;
    } catch (e) {
      if (!isCurrent()) return;
      logs = [];
      error = e instanceof Error && e.message ? e.message : 'Failed to load logs';
    } finally {
      if (isCurrent()) {
        loading = false;
        loaded = true;
      }
    }
  }

  $effect(() => {
    void span.span_id;
    void projectId;
    void trace.start_time;
    void trace.end_time;
    load();
  });
</script>

{#if loading && !loaded}
  <div class="space-y-2" aria-busy="true">
    <Skeleton height="1.25rem" width="100%" />
    <Skeleton height="1.25rem" width="100%" />
    <Skeleton height="1.25rem" width="80%" />
  </div>
{:else if error}
  <EmptyState variant="error" title="Could not load span logs" description={error}>
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={load}>Retry</Button>
    {/snippet}
  </EmptyState>
{:else if logs.length === 0}
  <EmptyState variant="no-data" title="No logs for this span in the trace window">
    {#snippet actions()}
      <Button variant="outline" size="sm" href={traceLogsUrl(trace, projectId)}>View trace logs</Button>
    {/snippet}
  </EmptyState>
{:else}
  <div class="space-y-2">
    <ul class="divide-y divide-border rounded-md border border-border">
      {#each logs as log, i (i)}
        <li class="flex flex-col gap-1 px-3 py-2 text-sm">
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Timestamp value={log.time} precision="ms" />
            <SeverityBadge kind="level" value={log.level} />
            <span>{log.service}</span>
          </div>
          <p class="whitespace-pre-wrap break-words font-mono text-xs">{log.message}</p>
        </li>
      {/each}
    </ul>
    <a
      href={spanLogsUrl(span, trace, projectId)}
      class="text-xs text-primary underline-offset-2 hover:underline"
    >
      Open in Logs
    </a>
  </div>
{/if}
