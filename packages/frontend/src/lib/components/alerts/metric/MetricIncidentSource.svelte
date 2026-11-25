<!--
  @component
  Metric view of a metric alert incident (incident source panel): the rule,
  its condition and threshold, the groups that fired with their last value,
  a chart of the rule's query over the incident with the threshold line, and
  Open in Explore with the rule's projects and the incident range.

  Props:
    metricAlert     IncidentMetricAlertDetail from the incident detail payload
    organizationId  organization of the incident (the chart query)
    createdAt       incident start
    resolvedAt      incident end, null while active
-->
<script lang="ts">
  import {
    METRIC_ALERT_WINDOW_MINUTES,
    formatMetricValue,
    type IncidentMetricAlertDetail,
    type MetricQueryResponse,
  } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import { instanceLabels, metricAlertExploreHref, targetMetricName } from './metric-alert-model';

  interface Props {
    metricAlert: IncidentMetricAlertDetail;
    organizationId: string;
    createdAt: string | Date;
    resolvedAt: string | Date | null;
  }

  let { metricAlert, organizationId, createdAt, resolvedAt }: Props = $props();

  const config = $derived(metricAlert.config);
  /** Metric name for unit formatting (null for a formula). */
  const metricName = $derived(config ? targetMetricName(config.query) : metricAlert.source);
  const minutes = $derived(METRIC_ALERT_WINDOW_MINUTES[metricAlert.window] ?? 5);
  const fmt = (v: number | null) => formatMetricValue(v, metricAlert.unit, metricName);

  const firing = $derived(metricAlert.groups.filter((g) => g.state === 'firing'));
  const resolved = $derived(metricAlert.groups.filter((g) => g.state === 'resolved'));

  /**
   * The incident with some lead: from four rule windows (at least one hour)
   * before it started to its end (now while active, a quarter of an hour
   * after when resolved).
   */
  const range = $derived.by(() => {
    const start = new Date(createdAt).getTime();
    const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
    const lead = Math.max(60, minutes * 4) * 60_000;
    const to = resolvedAt ? Math.min(end + 15 * 60_000, Date.now()) : end;
    return { from: new Date(start - lead), to: new Date(Math.max(to, start + 60_000)) };
  });

  const exploreHref = $derived(config ? metricAlertExploreHref(config.query, range) : null);

  let response = $state<MetricQueryResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let seq = 0;

  $effect(() => {
    const query = config?.query;
    const { from, to } = range;
    if (!query || !organizationId) return;
    const mine = ++seq;
    loading = true;
    error = null;
    metricsV2API
      .query({ ...query, compareTo: 'none', organizationId, from: from.toISOString(), to: to.toISOString() })
      .then((res) => {
        if (mine === seq) response = res;
      })
      .catch((e: unknown) => {
        if (mine === seq) error = e instanceof Error ? e.message : 'Could not load the chart';
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });
</script>

<Card data-testid="metric-incident-source">
  <CardHeader class="pb-3">
    <CardTitle class="text-base font-semibold">Metric alert</CardTitle>
  </CardHeader>
  <CardContent class="space-y-4 text-sm">
    <div>
      <p class="font-medium">{metricAlert.ruleName}</p>
      <p class="text-muted-foreground" data-testid="metric-incident-condition">
        <span class="font-mono text-xs">{metricAlert.source}</span>
        {metricAlert.condition}
        <span class="tabular-nums">{fmt(metricAlert.threshold)}</span>
        (avg over {minutes} {minutes === 1 ? 'minute' : 'minutes'})
      </p>
    </div>

    {#if metricAlert.groups.length > 0}
      <div>
        <p class="mb-1 text-xs font-medium text-muted-foreground">
          {firing.length > 0 ? `Firing (${firing.length})` : 'Fired during this incident'}
        </p>
        <ul class="divide-y rounded-md border" aria-label="Alert groups">
          {#each [...firing, ...resolved] as group (group.groupKey)}
            <li class="flex items-start justify-between gap-3 px-3 py-2" data-testid="metric-incident-group">
              <div class="min-w-0">
                <p class="break-all font-mono text-xs">{instanceLabels(group.labels) || 'All series'}</p>
                {#if group.firingSince}
                  <p class="text-xs text-muted-foreground">
                    Since <Timestamp value={group.firingSince} precision="minute" />
                  </p>
                {/if}
              </div>
              <div class="shrink-0 text-right">
                <p class="tabular-nums font-medium">{fmt(group.value)}</p>
                <p class="text-xs {group.state === 'firing' ? 'text-destructive-text' : 'text-muted-foreground'}">
                  {group.state === 'firing' ? 'Firing' : 'Resolved'}
                </p>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if config}
      <div data-testid="metric-incident-chart">
        <MetricSeriesView
          {response}
          {loading}
          {error}
          display="lines"
          metricNames={metricName ? { [metricAlert.queryId]: metricName } : {}}
          height={180}
          threshold={metricAlert.threshold}
        />
      </div>
    {:else}
      <p class="text-muted-foreground">The rule no longer exists, so its query cannot be charted.</p>
    {/if}

    {#if exploreHref || metricAlert.ruleId}
      <div class="flex flex-wrap gap-3">
        {#if metricAlert.ruleId}
          <a class="text-primary-text hover:underline" href={`/dashboard/alerts?edit=${encodeURIComponent(metricAlert.ruleId)}`}>
            Open rule
          </a>
        {/if}
        {#if exploreHref}
          <a class="text-primary-text hover:underline" href={exploreHref}>Open in Explore</a>
        {/if}
      </div>
    {/if}
  </CardContent>
</Card>
