<!--
  Services on a host, or hosts of a service, with their status.

  Props:
    listKind         'service' (services on a host) | 'host' (hosts of a service)
    names            names to list
    organizationId, projectIds, from, to   scope used to look their status up
-->
<script lang="ts">
  import {
    HOST_THRESHOLDS,
    formatMetricValue,
    type HostSourceSummary,
    type MetricSourceKind,
    type ServiceSourceSummary,
  } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import SourceStatusDot from '$lib/components/metrics/v2/SourceStatusDot.svelte';
  import SourceSignalCell from '$lib/components/metrics/v2/SourceSignalCell.svelte';
  import { sourceHref } from './source-model';

  interface Props {
    listKind: MetricSourceKind;
    names: string[];
    organizationId: string;
    projectIds: string[] | null;
    from: string;
    to: string;
  }

  let { listKind, names, organizationId, projectIds, from, to }: Props = $props();

  let hosts = $state<Map<string, HostSourceSummary>>(new Map());
  let services = $state<Map<string, ServiceSourceSummary>>(new Map());
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    let cancelled = false;
    loading = true;
    error = null;
    metricsV2API
      .getSources({ organizationId, projectIds, from, to })
      .then((res) => {
        if (cancelled) return;
        hosts = new Map(res.hosts.map((h) => [h.name, h]));
        services = new Map(res.services.map((s) => [s.name, s]));
      })
      .catch((err) => {
        if (!cancelled) error = err instanceof Error ? err.message : 'Could not load the status';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const title = $derived(listKind === 'service' ? 'services' : 'hosts');
</script>

{#if names.length === 0}
  <EmptyState
    variant="no-data"
    title={listKind === 'service' ? 'No services on this host' : 'No hosts for this service'}
    description={listKind === 'service'
      ? 'Services are linked to a host when they send metrics with the same host.name resource attribute.'
      : 'Hosts are linked when the service sends metrics with a host.name resource attribute.'}
  />
{:else}
  <div class="rounded-lg border bg-card" data-testid="related-list">
    {#if error}
      <p class="border-b px-4 py-2 text-sm text-destructive-text" role="alert">Could not load the status of the {title}: {error}</p>
    {/if}
    <ul class="divide-y">
      {#each names as n (n)}
        {@const h = listKind === 'host' ? hosts.get(n) : undefined}
        {@const s = listKind === 'service' ? services.get(n) : undefined}
        <li class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5" data-testid="related-row">
          <div class="flex min-w-48 items-center gap-2">
            {#if h}
              <SourceStatusDot status={h.status} reason={h.statusReason} />
            {:else if s}
              <SourceStatusDot status={s.status} reason={s.statusReason} />
            {:else}
              <SourceStatusDot status={loading ? 'unknown' : 'stale'} reason={loading ? null : 'No data in this window'} />
            {/if}
            <a class="font-medium hover:underline" href={sourceHref(listKind, n)}>{n}</a>
          </div>
          {#if h}
            <SourceSignalCell signal={h.cpu} label="CPU" thresholds={HOST_THRESHOLDS.cpu} />
            <SourceSignalCell signal={h.memory} label="Memory" thresholds={HOST_THRESHOLDS.memory} />
            <SourceSignalCell signal={h.disk} label="Disk" thresholds={HOST_THRESHOLDS.disk} />
          {:else if s}
            <span class="text-sm tabular-nums text-muted-foreground">
              {#if s.hasTraces}
                {formatMetricValue(s.requestRate.value, s.requestRate.unit)}, {formatMetricValue(s.errorRate.value, s.errorRate.unit)} errors, p95 {formatMetricValue(s.p95.value, s.p95.unit)}
              {:else}
                No traces
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
