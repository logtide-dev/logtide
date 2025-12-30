<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { tracesAPI, type TraceRecord, type SpanRecord } from "$lib/api/traces";
  import Button from "$lib/components/ui/button/button.svelte";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
  } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import AppLayout from "$lib/components/AppLayout.svelte";
  import RequireOrganization from "$lib/components/RequireOrganization.svelte";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Clock from "@lucide/svelte/icons/clock";
  import Timer from "@lucide/svelte/icons/timer";
  import Layers from "@lucide/svelte/icons/layers";
  import Server from "@lucide/svelte/icons/server";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import FileText from "@lucide/svelte/icons/file-text";

  interface SpanNode extends SpanRecord {
    children: SpanNode[];
    depth: number;
  }

  let traceId = $derived(page.params.id);
  let projectId = $derived(page.url.searchParams.get("projectId") || "");

  let trace = $state<TraceRecord | null>(null);
  let spans = $state<SpanRecord[]>([]);
  let spanTree = $state<SpanNode[]>([]);
  let isLoading = $state(true);
  let selectedSpan = $state<SpanRecord | null>(null);
  let expandedSpans = $state<Set<string>>(new Set());
  let copiedTraceId = $state(false);

  let traceStartTime = $derived(trace ? new Date(trace.start_time).getTime() : 0);
  let traceEndTime = $derived(trace ? new Date(trace.end_time).getTime() : 0);
  let traceDuration = $derived(traceEndTime - traceStartTime);

  onMount(async () => {
    if (!projectId) {
      goto("/traces");
      return;
    }

    await loadTraceData();
  });

  async function loadTraceData() {
    isLoading = true;
    try {
      const [traceData, spansData] = await Promise.all([
        tracesAPI.getTrace(traceId, projectId),
        tracesAPI.getTraceSpans(traceId, projectId),
      ]);

      trace = traceData;
      spans = spansData;
      spanTree = buildSpanTree(spansData);

      expandedSpans = new Set(spansData.map(s => s.span_id));
    } catch (e) {
      console.error("Failed to load trace:", e);
    } finally {
      isLoading = false;
    }
  }

  function buildSpanTree(spans: SpanRecord[]): SpanNode[] {
    const spanMap = new Map<string, SpanNode>();
    const rootSpans: SpanNode[] = [];

    for (const span of spans) {
      spanMap.set(span.span_id, { ...span, children: [], depth: 0 });
    }

    for (const span of spans) {
      const node = spanMap.get(span.span_id)!;
      if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
        const parent = spanMap.get(span.parent_span_id)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        rootSpans.push(node);
      }
    }

    const sortByTime = (a: SpanNode, b: SpanNode) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime();

    rootSpans.sort(sortByTime);

    function sortChildren(nodes: SpanNode[]) {
      nodes.sort(sortByTime);
      for (const node of nodes) {
        sortChildren(node.children);
      }
    }

    sortChildren(rootSpans);

    return rootSpans;
  }

  function flattenTree(nodes: SpanNode[], result: SpanNode[] = []): SpanNode[] {
    for (const node of nodes) {
      result.push(node);
      if (expandedSpans.has(node.span_id)) {
        flattenTree(node.children, result);
      }
    }
    return result;
  }

  let flattenedSpans = $derived(flattenTree(spanTree));

  function toggleSpan(spanId: string) {
    const newSet = new Set(expandedSpans);
    if (newSet.has(spanId)) {
      newSet.delete(spanId);
    } else {
      newSet.add(spanId);
    }
    expandedSpans = newSet;
  }

  function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  function getSpanColor(span: SpanRecord): string {
    if (span.status_code === "ERROR") {
      return "bg-red-500";
    }

    const colors = [
      "bg-blue-500",
      "bg-green-500",
      "bg-purple-500",
      "bg-orange-500",
      "bg-cyan-500",
      "bg-pink-500",
      "bg-yellow-500",
      "bg-indigo-500",
    ];

    const hash = span.service_name.split("").reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);

    return colors[Math.abs(hash) % colors.length];
  }

  function getSpanLeft(span: SpanRecord): number {
    if (traceDuration === 0) return 0;
    const spanStart = new Date(span.start_time).getTime();
    return ((spanStart - traceStartTime) / traceDuration) * 100;
  }

  function getSpanWidth(span: SpanRecord): number {
    if (traceDuration === 0) return 100;
    return Math.max((span.duration_ms / traceDuration) * 100, 0.5);
  }

  function copyTraceId() {
    navigator.clipboard.writeText(traceId);
    copiedTraceId = true;
    setTimeout(() => copiedTraceId = false, 2000);
  }

  function getKindLabel(kind: string | null): string {
    switch (kind) {
      case "SERVER": return "Server";
      case "CLIENT": return "Client";
      case "PRODUCER": return "Producer";
      case "CONSUMER": return "Consumer";
      case "INTERNAL": return "Internal";
      default: return "Unknown";
    }
  }

  function getStatusLabel(status: string | null): string {
    switch (status) {
      case "OK": return "OK";
      case "ERROR": return "Error";
      case "UNSET": return "Unset";
      default: return "Unknown";
    }
  }
</script>

<svelte:head>
  <title>Trace {traceId.substring(0, 8)}... - LogWard</title>
</svelte:head>

<AppLayout>
  <RequireOrganization>
    <div class="container mx-auto px-6 py-8 max-w-7xl">
      <div class="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onclick={() => goto("/traces")}
          class="mb-4"
        >
          <ArrowLeft class="w-4 h-4 mr-2" />
          Back to Traces
        </Button>

        <div class="flex items-center gap-3 mb-2">
          <GitBranch class="w-8 h-8 text-primary" />
          <h1 class="text-3xl font-bold tracking-tight">Trace Details</h1>
        </div>

        <div class="flex items-center gap-2 text-muted-foreground">
          <span class="font-mono text-sm">{traceId}</span>
          <Button
            variant="ghost"
            size="sm"
            onclick={copyTraceId}
            class="h-6 w-6 p-0"
          >
            {#if copiedTraceId}
              <Check class="w-4 h-4 text-green-500" />
            {:else}
              <Copy class="w-4 h-4" />
            {/if}
          </Button>
          <span class="mx-2 text-muted-foreground">|</span>
          <Button
            variant="outline"
            size="sm"
            onclick={() => goto(`/dashboard/search?traceId=${traceId}&project=${projectId}`)}
          >
            <FileText class="w-4 h-4 mr-2" />
            View Related Logs
          </Button>
        </div>
      </div>

      {#if isLoading}
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      {:else if trace}
        <div class="grid gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <Server class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Root Service</p>
                  <p class="font-medium">{trace.root_service_name || trace.service_name}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <GitBranch class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Operation</p>
                  <p class="font-medium truncate">{trace.root_operation_name || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <Clock class="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div class="min-w-0">
                  <p class="text-sm text-muted-foreground">Start Time</p>
                  <p class="font-medium text-sm whitespace-nowrap">{formatDateTime(trace.start_time)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <Timer class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Duration</p>
                  <p class="font-medium">{formatDuration(trace.duration_ms)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                {#if trace.error}
                  <AlertCircle class="w-5 h-5 text-red-500" />
                {:else}
                  <Layers class="w-5 h-5 text-muted-foreground" />
                {/if}
                <div>
                  <p class="text-sm text-muted-foreground">Status</p>
                  {#if trace.error}
                    <Badge variant="destructive">Error</Badge>
                  {:else}
                    <Badge variant="secondary">OK</Badge>
                  {/if}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card class="mb-6">
          <CardHeader>
            <CardTitle>Trace Timeline</CardTitle>
            <CardDescription>
              {spans.length} spans across {new Set(spans.map(s => s.service_name)).size} services
            </CardDescription>
          </CardHeader>
          <CardContent>
            {#if spans.length === 0}
              <div class="text-center py-12">
                <p class="text-muted-foreground">No spans found for this trace</p>
              </div>
            {:else}
              <div class="flex border-b mb-2 pb-2">
                <div class="w-[300px] shrink-0 pr-4 font-medium text-sm text-muted-foreground">
                  Service / Operation
                </div>
                <div class="flex-1 relative">
                  <div class="flex justify-between text-xs text-muted-foreground">
                    <span>0ms</span>
                    <span>{formatDuration(traceDuration / 4)}</span>
                    <span>{formatDuration(traceDuration / 2)}</span>
                    <span>{formatDuration((traceDuration * 3) / 4)}</span>
                    <span>{formatDuration(traceDuration)}</span>
                  </div>
                </div>
              </div>

              <!-- Spans -->
              <div class="space-y-1">
                {#each flattenedSpans as span}
                  {@const hasChildren = spanTree.length > 0 &&
                    flattenTree(spanTree).find(s => s.span_id === span.span_id)?.children?.length > 0}
                  <div
                    class="flex items-center hover:bg-muted/50 rounded cursor-pointer py-1"
                    role="button"
                    tabindex="0"
                    onclick={() => selectedSpan = selectedSpan?.span_id === span.span_id ? null : span}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectedSpan = selectedSpan?.span_id === span.span_id ? null : span;
                      }
                    }}
                  >
                    <div
                      class="w-[300px] shrink-0 pr-4 flex items-center gap-1"
                      style="padding-left: {span.depth * 16}px"
                    >
                      {#if hasChildren}
                        <button
                          class="p-0.5 hover:bg-muted rounded"
                          onclick={(e) => {
                            e.stopPropagation();
                            toggleSpan(span.span_id);
                          }}
                        >
                          {#if expandedSpans.has(span.span_id)}
                            <ChevronDown class="w-4 h-4" />
                          {:else}
                            <ChevronRight class="w-4 h-4" />
                          {/if}
                        </button>
                      {:else}
                        <div class="w-5"></div>
                      {/if}
                      <div class="truncate">
                        <span class="text-xs text-muted-foreground">{span.service_name}</span>
                        <span class="text-xs mx-1">:</span>
                        <span class="text-sm font-medium">{span.operation_name}</span>
                      </div>
                    </div>

                    <div class="flex-1 relative h-6">
                      <div class="absolute inset-0 bg-muted/30 rounded"></div>
                      <div
                        class="absolute h-full rounded {getSpanColor(span)} opacity-80"
                        style="left: {getSpanLeft(span)}%; width: {getSpanWidth(span)}%"
                        title="{span.operation_name}: {formatDuration(span.duration_ms)}"
                      ></div>
                      <div
                        class="absolute top-1/2 -translate-y-1/2 text-xs font-mono whitespace-nowrap"
                        style="left: calc({getSpanLeft(span)}% + {getSpanWidth(span)}% + 8px)"
                      >
                        {formatDuration(span.duration_ms)}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </CardContent>
        </Card>

        {#if selectedSpan}
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle>Span Details</CardTitle>
                  <CardDescription>
                    {selectedSpan.service_name} - {selectedSpan.operation_name}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => selectedSpan = null}
                >
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div class="grid gap-6 md:grid-cols-2">
                <div class="space-y-4">
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Span ID</h4>
                    <p class="font-mono text-sm">{selectedSpan.span_id}</p>
                  </div>
                  {#if selectedSpan.parent_span_id}
                    <div>
                      <h4 class="text-sm font-medium text-muted-foreground mb-1">Parent Span ID</h4>
                      <p class="font-mono text-sm">{selectedSpan.parent_span_id}</p>
                    </div>
                  {/if}
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Service</h4>
                    <Badge variant="outline">{selectedSpan.service_name}</Badge>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Operation</h4>
                    <p class="font-medium">{selectedSpan.operation_name}</p>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Kind</h4>
                    <Badge variant="secondary">{getKindLabel(selectedSpan.kind)}</Badge>
                  </div>
                </div>
                <div class="space-y-4">
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Status</h4>
                    {#if selectedSpan.status_code === "ERROR"}
                      <Badge variant="destructive">{getStatusLabel(selectedSpan.status_code)}</Badge>
                    {:else}
                      <Badge variant="secondary">{getStatusLabel(selectedSpan.status_code)}</Badge>
                    {/if}
                    {#if selectedSpan.status_message}
                      <p class="text-sm mt-1 text-muted-foreground">{selectedSpan.status_message}</p>
                    {/if}
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Duration</h4>
                    <p class="font-medium">{formatDuration(selectedSpan.duration_ms)}</p>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">Start Time</h4>
                    <p class="font-mono text-sm">{formatDateTime(selectedSpan.start_time)}</p>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-muted-foreground mb-1">End Time</h4>
                    <p class="font-mono text-sm">{formatDateTime(selectedSpan.end_time)}</p>
                  </div>
                </div>
              </div>

              <!-- View Logs Link -->
              <div class="mt-6 pt-4 border-t">
                <Button
                  variant="outline"
                  onclick={() => goto(`/dashboard/search?traceId=${traceId}&project=${projectId}`)}
                >
                  <FileText class="w-4 h-4 mr-2" />
                  View Logs for this Trace
                </Button>
              </div>

              {#if selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0}
                <div class="mt-6">
                  <h4 class="text-sm font-medium text-muted-foreground mb-2">Attributes</h4>
                  <pre class="p-3 bg-muted rounded-md overflow-x-auto text-xs">{JSON.stringify(selectedSpan.attributes, null, 2)}</pre>
                </div>
              {/if}

              {#if selectedSpan.events && selectedSpan.events.length > 0}
                <div class="mt-6">
                  <h4 class="text-sm font-medium text-muted-foreground mb-2">Events ({selectedSpan.events.length})</h4>
                  <pre class="p-3 bg-muted rounded-md overflow-x-auto text-xs">{JSON.stringify(selectedSpan.events, null, 2)}</pre>
                </div>
              {/if}

              {#if selectedSpan.resource_attributes && Object.keys(selectedSpan.resource_attributes).length > 0}
                <div class="mt-6">
                  <h4 class="text-sm font-medium text-muted-foreground mb-2">Resource Attributes</h4>
                  <pre class="p-3 bg-muted rounded-md overflow-x-auto text-xs">{JSON.stringify(selectedSpan.resource_attributes, null, 2)}</pre>
                </div>
              {/if}
            </CardContent>
          </Card>
        {/if}
      {:else}
        <Card>
          <CardContent class="py-12">
            <div class="text-center">
              <AlertCircle class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p class="text-muted-foreground">Trace not found</p>
              <Button
                variant="outline"
                class="mt-4"
                onclick={() => goto("/traces")}
              >
                Back to Traces
              </Button>
            </div>
          </CardContent>
        </Card>
      {/if}
    </div>
  </RequireOrganization>
</AppLayout>
