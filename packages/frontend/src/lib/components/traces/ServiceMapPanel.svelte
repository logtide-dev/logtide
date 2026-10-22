<script lang="ts">
  import type { EnrichedServiceDependencies, EnrichedServiceDependencyNode } from '$lib/api/traces';
  import ServiceMap from '$lib/components/ServiceMap.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Download from '@lucide/svelte/icons/download';
  import X from '@lucide/svelte/icons/x';
  import { levelTone, stateTone } from '$lib/utils/severity';
  import { serviceErrorsUrl, serviceLogsUrl } from '$lib/utils/trace-links';
  import { formatDuration } from './format';

  interface Props {
    projectId: string;
    data: EnrichedServiceDependencies | null;
    loading: boolean;
    error: string | null;
    range: { from: Date; to: Date };
    onRetry: () => void;
    onViewTraces: (service: string) => void;
  }

  let { projectId, data, loading, error, range, onRetry, onViewTraces }: Props = $props();

  let mapRef = $state<{ exportPng: () => string | null } | undefined>();
  let selectedName = $state<string | null>(null);

  const selectedNode = $derived<EnrichedServiceDependencyNode | null>(
    data?.nodes.find((n) => n.name === selectedName) ?? null,
  );
  const downstream = $derived(data && selectedNode ? data.edges.filter((e) => e.source === selectedNode.name) : []);
  const upstream = $derived(data && selectedNode ? data.edges.filter((e) => e.target === selectedNode.name) : []);

  function healthOf(errorRate: number) {
    if (errorRate >= 0.1) return { label: 'Unhealthy', tone: stateTone('failed') };
    if (errorRate >= 0.01) return { label: 'Degraded', tone: levelTone('warn') };
    return { label: 'Healthy', tone: stateTone('ok') };
  }

  function pct(rate: number): string {
    return `${((Number.isFinite(rate) ? rate : 0) * 100).toFixed(1)}%`;
  }

  function exportPng() {
    const url = mapRef?.exportPng();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `service-map-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div class="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
    <div class="flex items-center gap-1.5">
      <span class="inline-block size-3 rounded-full {stateTone('ok').dot}"></span>
      <span>Healthy (under 1%)</span>
    </div>
    <div class="flex items-center gap-1.5">
      <span class="inline-block size-3 rounded-full {levelTone('warn').dot}"></span>
      <span>Degraded (1 to 10%)</span>
    </div>
    <div class="flex items-center gap-1.5">
      <span class="inline-block size-3 rounded-full {stateTone('failed').dot}"></span>
      <span>Unhealthy (over 10%)</span>
    </div>
    <div class="flex items-center gap-1.5">
      <span class="inline-block w-6 border-t-2 border-dashed border-muted-foreground"></span>
      <span>Log correlation</span>
    </div>
  </div>
  <Button variant="outline" size="sm" class="gap-2" disabled={!data || data.nodes.length === 0} onclick={exportPng}>
    <Download class="size-4" aria-hidden="true" />
    Export PNG
  </Button>
</div>

<div class="flex flex-col gap-4 lg:flex-row">
  <div class="min-w-0 flex-1">
    <Card>
      <CardContent class="pt-6">
        {#if loading}
          <div class="flex h-[500px] items-center justify-center"><Spinner size="lg" /></div>
        {:else if error}
          <EmptyState variant="error" title="Could not load the service map" description={error}>
            {#snippet actions()}
              <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
            {/snippet}
          </EmptyState>
        {:else if data && data.nodes.length > 0}
          <ServiceMap
            bind:this={mapRef}
            dependencies={data}
            height="600px"
            onNodeClick={(name) => (selectedName = name)}
          />
        {:else}
          <EmptyState
            variant="no-data"
            title="No service dependencies found in this range"
            description="Send traces with parent-child spans or logs with a trace id to see service relationships."
          />
        {/if}
      </CardContent>
    </Card>
  </div>

  {#if selectedNode}
    {@const health = healthOf(selectedNode.errorRate)}
    <div class="w-full shrink-0 lg:w-80">
      <Card>
        <CardHeader class="flex flex-row items-start justify-between pb-3">
          <div class="min-w-0">
            <CardTitle class="break-all text-base">{selectedNode.name}</CardTitle>
            <span class="mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium {health.tone.badge}">
              {health.label}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="size-8"
            aria-label="Close service panel"
            onclick={() => (selectedName = null)}
          >
            <X class="size-4" aria-hidden="true" />
          </Button>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg bg-muted/50 p-3">
              <p class="text-xs text-muted-foreground">Error rate</p>
              <p class="text-lg font-bold {health.tone.text}">{pct(selectedNode.errorRate)}</p>
            </div>
            <div class="rounded-lg bg-muted/50 p-3">
              <p class="text-xs text-muted-foreground">Avg latency</p>
              <p class="text-lg font-bold">{formatDuration(selectedNode.avgLatencyMs)}</p>
            </div>
            <div class="rounded-lg bg-muted/50 p-3">
              <p class="text-xs text-muted-foreground">p95 latency</p>
              <p class="text-lg font-bold">
                {selectedNode.p95LatencyMs != null ? formatDuration(selectedNode.p95LatencyMs) : 'N/A'}
              </p>
            </div>
            <div class="rounded-lg bg-muted/50 p-3">
              <p class="text-xs text-muted-foreground">Total calls</p>
              <p class="text-lg font-bold">{selectedNode.totalCalls.toLocaleString('en-US')}</p>
            </div>
          </div>

          {#if downstream.length > 0}
            <div>
              <p class="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ArrowRight class="size-3" aria-hidden="true" />
                Calls to
              </p>
              <div class="space-y-1.5">
                {#each downstream as edge (edge.target)}
                  <div class="flex items-center justify-between text-sm">
                    <span class="truncate font-medium">{edge.target}</span>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="tabular-nums text-muted-foreground">{edge.callCount.toLocaleString('en-US')}</span>
                      {#if edge.type === 'log_correlation'}
                        <Badge variant="outline" class="px-1 py-0 text-[10px]">log</Badge>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if upstream.length > 0}
            <div>
              <p class="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ArrowLeft class="size-3" aria-hidden="true" />
                Called by
              </p>
              <div class="space-y-1.5">
                {#each upstream as edge (edge.source)}
                  <div class="flex items-center justify-between text-sm">
                    <span class="truncate font-medium">{edge.source}</span>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="tabular-nums text-muted-foreground">{edge.callCount.toLocaleString('en-US')}</span>
                      {#if edge.type === 'log_correlation'}
                        <Badge variant="outline" class="px-1 py-0 text-[10px]">log</Badge>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="flex flex-col gap-2">
            <Button class="w-full" onclick={() => onViewTraces(selectedNode.name)}>View traces</Button>
            <Button variant="outline" class="w-full" href={serviceLogsUrl(selectedNode.name, projectId, range)}>
              View logs
            </Button>
            <Button variant="outline" class="w-full" href={serviceErrorsUrl(selectedNode.name, projectId, range)}>
              View errors
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  {/if}
</div>
