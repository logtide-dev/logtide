<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { sessionsAPI, type SessionEvent } from '$lib/api/sessions';
  import { layoutStore } from '$lib/stores/layout';
  import { formatDuration } from '$lib/utils/format-duration';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import SessionTimeline from '$lib/components/sessions/SessionTimeline.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent } from '$lib/components/ui/card';

  const EVENT_LIMIT = 1000;
  const LOG_WINDOW_PADDING_MS = 60_000;

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-8 py-8');
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  const sessionId = $derived(
    (page as unknown as { params?: Record<string, string> }).params?.sessionId ?? '',
  );
  // `project` is canonical, `projectId` is the legacy name.
  const projectId = $derived(
    (page.url.searchParams.get('project') ?? page.url.searchParams.get('projectId') ?? '').trim(),
  );

  let events = $state<SessionEvent[]>([]);
  let windowRange = $state<{ from: string; to: string } | null>(null);
  let truncated = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let notFound = $state(false);
  let request = 0;

  async function loadEvents() {
    if (!projectId || !sessionId) return;
    const token = ++request;
    loading = true;
    error = null;
    notFound = false;
    try {
      const result = await sessionsAPI.getSessionEvents({ projectId, sessionId, limit: EVENT_LIMIT });
      if (token !== request) return;
      events = result.events ?? [];
      windowRange = result.window ?? null;
      truncated = Boolean(result.truncated);
      notFound = events.length === 0;
    } catch (e) {
      if (token !== request) return;
      events = [];
      windowRange = null;
      truncated = false;
      const message = e instanceof Error ? e.message : 'Could not load session';
      if (/not found/i.test(message)) notFound = true;
      else error = message;
    } finally {
      if (token === request) loading = false;
    }
  }

  $effect(() => {
    if (!browser) return;
    void projectId;
    void sessionId;
    if (!projectId || !sessionId) {
      loading = false;
      return;
    }
    void loadEvents();
  });

  const stats = $derived.by(() => {
    if (events.length === 0) return null;
    const times = events.map((e) => new Date(e.time).getTime()).filter((t) => Number.isFinite(t));
    if (times.length === 0) return null;
    const first = Math.min(...times);
    const last = Math.max(...times);
    return {
      firstEvent: new Date(first).toISOString(),
      durationMs: last - first,
      eventCount: events.length,
      errorCount: events.filter((e) => e.level === 'error' || e.level === 'critical').length,
      services: [...new Set(events.map((e) => e.service))],
    };
  });

  function shortId(id: string): string {
    return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
  }

  /** Quote the id in a log search query when it holds characters the grammar would split on. */
  function quoteForQuery(value: string): string {
    if (!/[\s"'\\/]/.test(value)) return value;
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  const logsHref = $derived.by(() => {
    if (!sessionId || !projectId) return null;
    const params = new URLSearchParams();
    params.set('q', `session:${quoteForQuery(sessionId)}`);
    params.set('project', projectId);
    if (windowRange) {
      const from = new Date(new Date(windowRange.from).getTime() - LOG_WINDOW_PADDING_MS);
      const to = new Date(new Date(windowRange.to).getTime() + LOG_WINDOW_PADDING_MS);
      if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
        params.set('from', from.toISOString());
        params.set('to', to.toISOString());
      }
    }
    return `/dashboard/logs?${params.toString()}`;
  });

  const sessionsHref = $derived(
    projectId ? `/dashboard/sessions?project=${encodeURIComponent(projectId)}` : '/dashboard/sessions',
  );

  const breadcrumbs = $derived([
    { label: 'Sessions', href: sessionsHref },
    { label: shortId(sessionId) || 'Session' },
  ]);
</script>

<svelte:head>
  <title>Session {shortId(sessionId)} - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Session" description={shortId(sessionId)} {breadcrumbs}>
    {#snippet actions()}
      {#if logsHref && stats}
        <Button variant="outline" size="sm" href={logsHref}>View logs</Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if !projectId}
    <EmptyState
      variant="no-data"
      title="No project selected"
      description="Open this session from the sessions list so we know which project it belongs to."
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" href="/dashboard/sessions">Back to sessions</Button>
      {/snippet}
    </EmptyState>
  {:else if loading}
    <div class="py-20 text-center text-sm text-muted-foreground" role="status">Loading session</div>
  {:else if error}
    <EmptyState variant="error" title="Could not load session" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={() => void loadEvents()}>Retry</Button>
      {/snippet}
    </EmptyState>
  {:else if notFound || !stats}
    <EmptyState
      variant="no-results"
      title="Session not found"
      description="This session has no events, or it is older than the data we keep."
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" href={sessionsHref}>Back to sessions</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="space-y-5">
      <Card>
        <CardContent class="px-6 py-5">
          <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p class="mb-1 text-xs text-muted-foreground">Session ID</p>
              <span class="inline-flex items-center gap-1">
                <code class="font-mono text-sm font-medium" title={sessionId}>{shortId(sessionId)}</code>
                <CopyButton value={sessionId} ariaLabel="Copy session ID" />
              </span>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted-foreground">Service</p>
              <div class="flex gap-1.5">
                {#each stats.services as svc (svc)}
                  <Badge variant="outline">{svc}</Badge>
                {/each}
              </div>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted-foreground">Started</p>
              <p class="text-sm font-medium"><Timestamp value={stats.firstEvent} precision="second" /></p>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted-foreground">Duration</p>
              <p class="text-sm font-medium">{formatDuration(stats.durationMs)}</p>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted-foreground">Events</p>
              <p class="text-sm font-medium">{stats.eventCount.toLocaleString('en-US')}</p>
            </div>
            {#if stats.errorCount > 0}
              <div>
                <p class="mb-1 text-xs text-muted-foreground">Errors</p>
                <p class="text-sm font-semibold text-destructive-text">
                  {stats.errorCount.toLocaleString('en-US')}
                </p>
              </div>
            {/if}
          </div>
        </CardContent>
      </Card>

      {#if truncated}
        <p class="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning-text" role="status">
          Showing the first {EVENT_LIMIT.toLocaleString('en-US')} events
        </p>
      {/if}

      <SessionTimeline {events} {projectId} />
    </div>
  {/if}
</div>
