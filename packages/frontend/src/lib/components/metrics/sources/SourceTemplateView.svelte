<!--
  Renders the template of a source (HOST_TEMPLATE / SERVICE_TEMPLATE) with the
  template variable set to the source, without saving a dashboard.

  Props:
    kind             'host' | 'service'
    name             the source (host.name / service.name)
    metricNames      every metric the source sends; panels whose `requires` are missing are left out
    organizationId   organization of the call
    projectIds       project subset (null = every project)
    from, to         ISO window of the panels
    tick             bump to reload quietly (polling)

  Metrics panels render through MetricSeriesView, trace panels through the
  dashboard panels (read-only). One batched call (panelsData) loads all.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PANEL_TIME_RANGES,
    PANEL_TIME_RANGE_MS,
    SOURCE_TEMPLATES,
    applicableTemplatePanels,
    type MetricQueryResponse,
    type MetricSourceKind,
    type MetricsPanelConfig,
    type PanelConfig,
    type PanelTimeRange,
    type TraceLatencyConfig,
    type TraceVolumeConfig,
  } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import TraceVolumePanel from '$lib/components/custom-dashboards/panels/TraceVolumePanel.svelte';
  import TraceLatencyPanel from '$lib/components/custom-dashboards/panels/TraceLatencyPanel.svelte';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    metricNames: string[];
    /** false hides the panels that only read spans (services without traces). */
    hasTraces?: boolean;
    organizationId: string;
    projectIds: string[] | null;
    from: string;
    to: string;
    tick?: number;
  }

  let { kind, name, metricNames, hasTraces = true, organizationId, projectIds, from, to, tick = 0 }: Props = $props();

  const template = $derived(SOURCE_TEMPLATES[kind]);
  const sections = $derived(applicableTemplatePanels(template, metricNames, { hasTraces }));

  /** Smallest preset that covers the window, so trace panels (which read their own range) follow the page. */
  function presetFor(fromIso: string, toIso: string): PanelTimeRange {
    const span = new Date(toIso).getTime() - new Date(fromIso).getTime();
    const sorted = [...PANEL_TIME_RANGES].sort((a, b) => PANEL_TIME_RANGE_MS[a] - PANEL_TIME_RANGE_MS[b]);
    return sorted.find((r) => PANEL_TIME_RANGE_MS[r] >= span) ?? sorted[sorted.length - 1];
  }

  function panelConfig(config: PanelConfig): PanelConfig {
    if (config.type === 'trace_volume' || config.type === 'trace_latency') {
      return { ...config, timeRange: presetFor(from, to) } as TraceVolumeConfig | TraceLatencyConfig;
    }
    return config;
  }

  const panels = $derived(
    sections.flatMap((section, si) =>
      section.panels.map((p) => ({ id: `${si}-${p.key}`, key: p.key, w: p.w, h: p.h, config: panelConfig(p.config) })),
    ),
  );

  let results = $state<Record<string, { data?: unknown; error?: string }>>({});
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);

  let seq = 0;
  let controller: AbortController | null = null;

  async function load(silent: boolean) {
    const mine = ++seq;
    controller?.abort();
    if (panels.length === 0) {
      results = {};
      loaded = true;
      return;
    }
    controller = new AbortController();
    if (!silent) loading = true;
    try {
      const res = await metricsV2API.panelsData(
        {
          organizationId,
          from,
          to,
          variables: { [template.variable.name]: name },
          panels: panels.map((p) => ({ id: p.id, config: p.config })),
        },
        controller.signal,
      );
      if (mine !== seq) return;
      results = res.panels ?? {};
      error = null;
      loaded = true;
    } catch (err) {
      if (mine !== seq || (err instanceof DOMException && err.name === 'AbortError')) return;
      error = err instanceof Error ? err.message : 'Could not load the panels';
      if (!silent) results = {};
      loaded = true;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    // Everything that changes what is asked reloads, `tick` reloads quietly.
    name;
    organizationId;
    projectIds;
    from;
    to;
    panels;
    const ticked = tick > 0;
    const silent = untrack(() => ticked && loaded);
    void load(silent);
    return () => {
      seq++;
      controller?.abort();
    };
  });

  function metricNameMap(config: MetricsPanelConfig): Record<string, string> {
    return Object.fromEntries(config.query.queries.map((q) => [q.id, q.metricName]));
  }
</script>

<div class="space-y-6" data-testid="source-template">
  {#if error}
    <p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text" role="alert">
      Could not load the panels: {error}
    </p>
  {/if}

  {#each sections as section, si (section.title)}
    <section aria-label={section.title} class="space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h3>
      <div class="tpl-grid">
        {#each section.panels as p (p.key)}
          {@const id = `${si}-${p.key}`}
          {@const config = panels.find((x) => x.id === id)?.config ?? p.config}
          {@const result = results[id]}
          <div class="tpl-panel rounded-lg border bg-card p-3" style="--w: {p.w}" data-testid="template-panel-{p.key}">
            <h4 class="mb-2 text-sm font-medium">{config.title}</h4>
            {#if config.type === 'metrics'}
              <MetricSeriesView
                response={(result?.data as MetricQueryResponse | undefined) ?? null}
                loading={loading && !result}
                error={result?.error ?? null}
                display={config.query.display}
                metricNames={metricNameMap(config)}
                height={p.h * 48}
                showSpark={false}
              />
            {:else if config.type === 'trace_volume'}
              <div style="height: {p.h * 48}px">
                <TraceVolumePanel {config} data={result?.data ?? null} loading={loading && !result} error={result?.error ?? null} />
              </div>
            {:else if config.type === 'trace_latency'}
              <div style="height: {p.h * 48}px">
                <TraceLatencyPanel {config} data={result?.data ?? null} loading={loading && !result} error={result?.error ?? null} />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}

  {#if loaded && sections.length === 0}
    <p class="text-sm text-muted-foreground" data-testid="template-empty">
      This {kind} sends no metrics the template knows. Every metric it sends is listed in the Metrics tab.
    </p>
  {/if}
</div>

<style>
  .tpl-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .tpl-panel {
    grid-column: 1 / -1;
    min-width: 0;
  }
  @media (min-width: 768px) {
    .tpl-panel {
      grid-column: span var(--w) / span var(--w);
    }
  }
</style>
