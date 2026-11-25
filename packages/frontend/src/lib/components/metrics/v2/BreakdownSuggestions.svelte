<!--
  Suggests how to break a metric down: lists its attribute keys with the
  number of distinct values seen; clicking one adds it as a group by.

  Props:
    metricName     the metric (no suggestions when empty)
    organizationId
    projectIds     string[] | null
    onAddGroupBy   (ref: MetricAttrRef) => void
    max            how many suggestions to show (default 8)
    api            client, defaults to metricsV2API (injectable for tests)

  Keys with a single value are listed last. Source attributes (host.name and
  friends) come first.
-->
<script lang="ts">
  import type { MetricAttrRef, MetricCatalogDetail } from '@logtide/shared';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';
  import { isSourceAttribute } from '$lib/utils/metrics-explorer-url';

  interface Props {
    metricName: string;
    organizationId: string;
    projectIds?: string[] | null;
    onAddGroupBy: (ref: MetricAttrRef) => void;
    max?: number;
    api?: Pick<MetricsV2API, 'getCatalogEntry'>;
  }

  let { metricName, organizationId, projectIds = null, onAddGroupBy, max = 8, api = metricsV2API }: Props = $props();

  interface Suggestion extends MetricAttrRef {
    count: number;
    /** The backend caps samples at 20, so 20 means "20 or more". */
    capped: boolean;
  }

  let detail = $state<MetricCatalogDetail | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const name = metricName;
    const org = organizationId;
    const projects = projectIds;
    detail = null;
    error = null;
    if (!name) return;
    let cancelled = false;
    loading = true;
    api
      .getCatalogEntry(name, { organizationId: org, projectIds: projects })
      .then((d) => {
        if (!cancelled) detail = d;
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : 'Could not load attributes';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const suggestions = $derived.by<Suggestion[]>(() => {
    if (!detail) return [];
    const all: Suggestion[] = [
      ...detail.attributes.resource.map((a) => ({ scope: 'resource' as const, key: a.key, count: a.values.length, capped: a.values.length >= 20 })),
      ...detail.attributes.metric.map((a) => ({ scope: 'metric' as const, key: a.key, count: a.values.length, capped: a.values.length >= 20 })),
    ].filter((s) => s.count > 0);
    const rank = (s: Suggestion) => (s.count < 2 ? 2 : isSourceAttribute(s) ? 0 : 1);
    return all
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || b.s.count - a.s.count || a.i - b.i)
      .map((x) => x.s)
      .slice(0, max);
  });
</script>

{#if metricName}
  <div class="rounded-lg border border-border bg-card p-3" aria-label="Breakdown suggestions" role="region">
    <p class="mb-2 text-sm font-medium">Break down by</p>
    {#if loading}
      <p class="text-sm text-muted-foreground" role="status">Loading attributes</p>
    {:else if error}
      <p class="text-sm text-destructive-text" role="alert">{error}</p>
    {:else if suggestions.length === 0}
      <p class="text-sm text-muted-foreground">This metric has no attributes to break down by.</p>
    {:else}
      <ul class="flex flex-wrap gap-2">
        {#each suggestions as s (`${s.scope}:${s.key}`)}
          <li>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm hover:bg-muted"
              onclick={() => onAddGroupBy({ scope: s.scope, key: s.key })}
            >
              <span>{s.scope === 'resource' ? `resource.${s.key}` : s.key}</span>
              <span class="text-xs text-muted-foreground">{s.capped ? `${s.count}+` : s.count} {s.count === 1 && !s.capped ? 'value' : 'values'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
