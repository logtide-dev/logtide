<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { addFieldClause } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { layoutStore } from '$lib/stores/layout';
  import {
    tracesAPI,
    type TraceRecord,
    type SpanRecord,
    type TraceErrorGroup,
  } from '$lib/api/traces';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import FileText from '@lucide/svelte/icons/file-text';
  import Server from '@lucide/svelte/icons/server';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Clock from '@lucide/svelte/icons/clock';
  import Timer from '@lucide/svelte/icons/timer';
  import Layers from '@lucide/svelte/icons/layers';
  import TraceWaterfall from './TraceWaterfall.svelte';
  import SpanDetailPanel from './SpanDetailPanel.svelte';
  import { formatDuration } from './format';
  import { createLatest } from '$lib/utils/latest';
  import { readTraceListState } from '$lib/utils/trace-filters';
  import { traceDetailUrl, traceLogsUrl } from '$lib/utils/trace-links';

  interface Props {
    traceId: string;
    projectId: string;
  }

  let { traceId, projectId }: Props = $props();

  const maxWidthClass = layoutStore.maxWidthClass;
  const containerPadding = layoutStore.containerPadding;

  let trace = $state<TraceRecord | null>(null);
  let spans = $state<SpanRecord[]>([]);
  let errorGroups = $state<TraceErrorGroup[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let selectedSpanId = $state<string | null>(null);

  const guard = createLatest();
  const groupsGuard = createLatest();

  // Reloads whenever the trace or the project changes (FRONTEND-BUGS #9).
  $effect(() => {
    const id = traceId;
    const pid = projectId;
    untrack(() => {
      load(id, pid);
    });
  });

  async function load(id: string, pid: string) {
    const isCurrent = guard.begin();
    loading = true;
    loadError = null;
    trace = null;
    spans = [];
    errorGroups = [];
    selectedSpanId = null;
    try {
      const [traceData, spanData] = await Promise.all([
        tracesAPI.getTrace(id, pid),
        tracesAPI.getTraceSpans(id, pid),
      ]);
      if (!isCurrent()) return;
      trace = traceData;
      spans = spanData ?? [];
    } catch (e) {
      if (!isCurrent()) return;
      loadError = e instanceof Error && e.message ? e.message : 'Failed to load trace';
    } finally {
      if (isCurrent()) loading = false;
    }
    if (isCurrent() && trace) loadErrorGroups(id, pid);
  }

  async function loadErrorGroups(id: string, pid: string) {
    const org = $currentOrganization;
    if (!org) return;
    const isCurrent = groupsGuard.begin();
    try {
      const groups = await tracesAPI.getErrorGroupsByTrace(id, pid, org.id);
      if (isCurrent() && id === traceId && pid === projectId) errorGroups = groups ?? [];
    } catch {
      // Optional enhancement: never break the page.
      if (isCurrent()) errorGroups = [];
    }
  }

  const selectedSpan = $derived(spans.find((s) => s.span_id === selectedSpanId) ?? null);
  const serviceCount = $derived(new Set(spans.map((s) => s.service_name)).size);

  const listHref = $derived.by(() => {
    const remembered = readTraceListState();
    if (remembered) return `/dashboard/traces${remembered.startsWith('?') ? remembered : `?${remembered}`}`;
    return `/dashboard/traces?project=${encodeURIComponent(projectId)}`;
  });

  const shortId = $derived(traceId.length > 8 ? traceId.slice(0, 8) : traceId);

  const shareLink = $derived(
    typeof window === 'undefined'
      ? traceDetailUrl(traceId, projectId)
      : `${window.location.origin}${traceDetailUrl(traceId, projectId)}`,
  );

  function filterTraces(path: string, value: unknown, negate: boolean) {
    const remembered = new URLSearchParams(readTraceListState() ?? '');
    const params = new URLSearchParams();
    params.set('project', projectId);
    for (const key of ['range', 'from', 'to']) {
      const v = remembered.get(key);
      if (v) params.set(key, v);
    }
    const attr = addFieldClause(remembered.get('attr') ?? '', path, String(value), negate);
    if (attr) params.set('attr', attr);
    goto(`/dashboard/traces?${params.toString()}`);
  }
</script>

<svelte:head>
  <title>Trace {shortId} - LogTide</title>
</svelte:head>

<div class="container mx-auto {$containerPadding} {$maxWidthClass}">
  <PageHeader
    title="Trace {shortId}"
    breadcrumbs={[{ label: 'Traces', href: listHref }, { label: shortId }]}
  >
    {#snippet actions()}
      {#if trace}
        <Button variant="outline" size="sm" href={traceLogsUrl(trace, projectId)}>
          <FileText class="size-4" aria-hidden="true" />
          View logs
        </Button>
      {/if}
      <CopyButton value={shareLink} label="Copy link" />
    {/snippet}
  </PageHeader>

  {#if loading}
    <div class="flex items-center justify-center py-12"><Spinner size="lg" /></div>
  {:else if !trace}
    <EmptyState
      variant="error"
      title="Trace not found"
      description={loadError
        ? `${loadError}. It may have been removed, or it belongs to another project.`
        : 'It may have been removed, or it belongs to another project.'}
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" href={listHref}>Back to traces</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Server class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">Root service</p>
              <p class="truncate font-medium" title={trace.root_service_name || trace.service_name}>
                {trace.root_service_name || trace.service_name}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <GitBranch class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">Operation</p>
              <p class="truncate font-medium" title={trace.root_operation_name || ''}>
                {trace.root_operation_name || 'None'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Clock class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">Start</p>
              <p class="whitespace-nowrap text-sm font-medium">
                <Timestamp value={trace.start_time} precision="ms" />
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Timer class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">Duration</p>
              <p class="truncate font-medium">{formatDuration(trace.duration_ms)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Layers class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">Spans</p>
              <p class="truncate font-medium">{trace.span_count.toLocaleString('en-US')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="min-w-0">
            <p class="mb-1 text-sm text-muted-foreground">Status</p>
            <SeverityBadge kind="state" value={trace.error ? 'failed' : 'ok'} />
          </div>
        </CardContent>
      </Card>
    </div>

    <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div class="min-w-0 flex-1">
        <Card>
          <CardHeader>
            <CardTitle>Trace timeline</CardTitle>
            <CardDescription>
              {spans.length.toLocaleString('en-US')} spans across {serviceCount.toLocaleString('en-US')} services
            </CardDescription>
          </CardHeader>
          <CardContent>
            {#if spans.length === 0}
              <EmptyState variant="no-data" title="No spans found for this trace" />
            {:else}
              <TraceWaterfall
                {spans}
                {trace}
                {selectedSpanId}
                onSelect={(id) => (selectedSpanId = id)}
              />
            {/if}
          </CardContent>
        </Card>
      </div>

      {#if selectedSpan}
        <div class="w-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[420px] lg:shrink-0 lg:overflow-y-auto">
          <SpanDetailPanel
            span={selectedSpan}
            {trace}
            {projectId}
            {errorGroups}
            onClose={() => (selectedSpanId = null)}
            onFilterTraces={filterTraces}
          />
        </div>
      {/if}
    </div>
  {/if}
</div>
