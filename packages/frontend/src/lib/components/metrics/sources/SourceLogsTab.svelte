<!--
  Logs tab of a source: link to Logs filtered on the source plus the latest lines.

  Props:
    kind, name       the source (hosts filter on hostname, services on service)
    projectIds       project ids the source reports to (the logs API needs at least one)
    from, to         ISO window
    logsHref         Open in Logs link
-->
<script lang="ts">
  import type { MetricSourceKind } from '@logtide/shared';
  import { logsAPI, type LogEntry } from '$lib/api/logs';
  import Button from '$lib/components/ui/button/button.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    projectIds: string[];
    from: string;
    to: string;
    logsHref: string;
  }

  let { kind, name, projectIds, from, to, logsHref }: Props = $props();

  const LIMIT = 10;

  let logs = $state<LogEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    let cancelled = false;
    loading = true;
    error = null;
    logsAPI
      .getLogs({
        projectId: projectIds,
        ...(kind === 'host' ? { hostname: name } : { service: name }),
        from,
        to,
        limit: LIMIT,
      })
      .then((res) => {
        if (!cancelled) logs = res.logs ?? [];
      })
      .catch((err) => {
        if (!cancelled) {
          logs = [];
          error = err instanceof Error ? err.message : 'Could not load logs';
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const LEVEL_CLASS: Record<string, string> = {
    critical: 'text-destructive-text',
    error: 'text-destructive-text',
    warn: 'text-warning-text',
    warning: 'text-warning-text',
  };
</script>

<section class="rounded-lg border bg-card" data-testid="source-logs">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
    <h3 class="text-sm font-medium">Recent logs</h3>
    <Button size="sm" variant="outline" href={logsHref}>Open in Logs</Button>
  </div>
  {#if loading}
    <p class="px-4 py-6 text-sm text-muted-foreground" role="status">Loading logs</p>
  {:else if error}
    <p class="px-4 py-3 text-sm text-destructive-text" role="alert">Could not load logs: {error}</p>
  {:else if logs.length === 0}
    <div class="px-4 py-2">
      <EmptyState
        variant="no-data"
        title="No logs for this {kind}"
        description={kind === 'host'
          ? 'No log in this window carries this hostname.'
          : 'No log in this window comes from this service.'}
      />
    </div>
  {:else}
    <ul class="divide-y font-mono text-xs">
      {#each logs as log, i (log.id ?? `${log.time}-${i}`)}
        <li class="flex gap-3 px-4 py-1.5">
          <span class="shrink-0 text-muted-foreground"><Timestamp value={log.time} precision="second" /></span>
          <span class="w-14 shrink-0 uppercase {LEVEL_CLASS[log.level] ?? 'text-muted-foreground'}">{log.level}</span>
          <span class="min-w-0 flex-1 truncate" title={log.message}>{log.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
