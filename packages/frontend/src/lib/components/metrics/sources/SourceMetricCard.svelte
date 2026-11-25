<!--
  One metric of a source as a small chart card. Queries on mount (the grid
  only mounts a few cards at a time).

  Props:
    kind, name       the source
    metricName       the metric to chart
    organizationId, projectIds, from, to   scope of the query
    exploreHref      Open in Explore link
    aggregation      time aggregation (rate / p95 / avg by catalog type)
-->
<script lang="ts">
  import type { MetricQueryResponse, MetricSourceKind, MetricTimeAggregation } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    metricName: string;
    organizationId: string;
    projectIds: string[] | null;
    from: string;
    to: string;
    exploreHref: string;
    /** Chosen from the catalog type by the grid; avg when omitted. */
    aggregation?: MetricTimeAggregation;
  }

  let { kind, name, metricName, organizationId, projectIds, from, to, exploreHref, aggregation = 'avg' }: Props = $props();

  let response = $state<MetricQueryResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    const controller = new AbortController();
    loading = true;
    error = null;
    metricsV2API
      .query(
        {
          organizationId,
          projectIds,
          from,
          to,
          queries: [
            {
              id: 'A',
              metricName,
              aggregation,
              filters: [{ scope: 'resource', key: kind === 'host' ? 'host.name' : 'service.name', op: 'eq', values: [name] }],
              groupBy: [],
            },
          ],
          formulas: [],
          interval: 'auto',
          compareTo: 'none',
          display: 'lines',
        },
        controller.signal,
      )
      .then((res) => {
        response = res;
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        response = null;
        error = err instanceof Error ? err.message : 'Could not load this metric';
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });
</script>

<div class="min-w-0 rounded-lg border bg-card p-3" data-testid="metric-card">
  <div class="mb-2 flex items-center justify-between gap-2">
    <h4 class="truncate font-mono text-xs font-medium" title={metricName}>{metricName}</h4>
    <a
      class="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={exploreHref}
      aria-label="Open {metricName} in Explore"
      title="Open in Explore"
    >
      <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  </div>
  <MetricSeriesView {response} {loading} {error} display="lines" metricNames={{ A: metricName }} height={140} showSpark={false} />
</div>
