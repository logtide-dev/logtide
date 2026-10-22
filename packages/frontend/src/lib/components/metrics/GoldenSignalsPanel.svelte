<script lang="ts">
  import { goto } from '$app/navigation';
  import SignalChart from './SignalChart.svelte';
  import {
    SIGNAL_CONFIGS,
    detectSignalMetrics,
  } from '$lib/utils/golden-signals';
  import { metricsAPI } from '$lib/api/metrics';
  import type { MetricAggregationFn } from '$lib/api/metrics';
  import Button from '$lib/components/ui/button/button.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Activity from '@lucide/svelte/icons/activity';

  interface Props {
    metricNames: Array<{ name: string; type: string }>;
    services: Array<{ serviceName: string }>;
    projectId: string;
    timeRange: { from: Date; to: Date };
    interval: string;
  }

  let { metricNames, services, projectId, timeRange, interval }: Props = $props();

  let detectedMetrics = $derived(detectSignalMetrics(metricNames));
  let displayServices = $derived(services.length > 0 ? services : [{ serviceName: '' }]);

  // Timeseries data keyed by `${signalType}:${serviceName}`
  let seriesData = $state<Map<string, Array<{ label: string; color: string; values: Array<{ bucket: string; value: number }> }>>>(new Map());
  let loadingSignals = $state<Set<string>>(new Set());

  let lastFetchKey = $state<string | null>(null);

  $effect(() => {
    const key = `${projectId}-${timeRange.from.toISOString()}-${timeRange.to.toISOString()}-${interval}-${JSON.stringify(detectedMetrics)}`;
    if (key === lastFetchKey) return;
    lastFetchKey = key;
    fetchAllSignals();
  });

  async function fetchAllSignals() {
    if (!projectId) return;
    const fromISO = timeRange.from.toISOString();
    const toISO = timeRange.to.toISOString();

    const svcList = displayServices;

    // Build all fetch tasks upfront
    const tasks: Array<{
      signalKey: string;
      config: typeof SIGNAL_CONFIGS[0];
      serviceName: string;
    }> = [];

    for (const service of svcList) {
      for (const config of SIGNAL_CONFIGS) {
        const metricName = detectedMetrics[config.type];
        if (!metricName) continue;
        tasks.push({
          signalKey: `${config.type}:${service.serviceName}`,
          config,
          serviceName: service.serviceName,
        });
      }
    }

    // Mark all as loading
    loadingSignals = new Set(tasks.map(t => t.signalKey));

    // Fetch all in parallel
    await Promise.allSettled(
      tasks.map(async ({ signalKey, config, serviceName }) => {
        const metricName = detectedMetrics[config.type]!;
        try {
          const results = await Promise.all(
            config.aggregations.map(agg =>
              metricsAPI.aggregateMetrics({
                projectId,
                metricName,
                from: fromISO,
                to: toISO,
                interval: interval || '5m',
                aggregation: agg.fn as MetricAggregationFn,
                attributes: config.attributeFilter,
                ...(serviceName ? { serviceName } : {}),
              }).then(result => ({
                label: agg.label,
                color: agg.color,
                values: result.timeseries.map(t => ({
                  bucket: typeof t.bucket === 'string' ? t.bucket : String(t.bucket),
                  value: t.value,
                })),
              }))
            )
          );
          seriesData = new Map(seriesData).set(signalKey, results);
        } catch (e) {
          console.error(`Failed to fetch signal ${signalKey}:`, e);
          seriesData = new Map(seriesData).set(signalKey, []);
        } finally {
          const next = new Set(loadingSignals);
          next.delete(signalKey);
          loadingSignals = next;
        }
      })
    );
  }

  function goToTraces(serviceName: string) {
    const from = timeRange.from.toISOString();
    const to = timeRange.to.toISOString();
    goto(`/dashboard/traces?service=${encodeURIComponent(serviceName)}&from=${from}&to=${to}&project=${projectId}`);
  }

  function goToLogs(serviceName: string) {
    const from = timeRange.from.toISOString();
    const to = timeRange.to.toISOString();
    goto(`/dashboard/logs?service=${encodeURIComponent(serviceName)}&from=${from}&to=${to}&project=${projectId}`);
  }

</script>

{#if metricNames.length === 0}
  <div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
    <Activity class="w-12 h-12 mb-3 opacity-50" />
    <p class="text-lg font-medium mb-1">No metrics found</p>
    <p class="text-sm">Start sending OTLP metrics to see golden signals</p>
  </div>
{:else}
  {#each displayServices as service}
    <div class="mb-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold">{service.serviceName || 'All Services'}</h3>
        {#if service.serviceName}
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => goToTraces(service.serviceName)}>
              <ExternalLink class="w-3 h-3 mr-1" />
              Traces
            </Button>
            <Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => goToLogs(service.serviceName)}>
              <ExternalLink class="w-3 h-3 mr-1" />
              Logs
            </Button>
          </div>
        {/if}
      </div>

      <div class="grid gap-4 grid-cols-1 md:grid-cols-2">
        {#each SIGNAL_CONFIGS as config}
          {@const signalKey = `${config.type}:${service.serviceName}`}
          {@const data = seriesData.get(signalKey)}
          {@const isLoading = loadingSignals.has(signalKey)}
          {@const isEmpty = !detectedMetrics[config.type]}
          <SignalChart
            title={config.title}
            description={config.description}
            unit={config.unit}
            series={data ?? []}
            loading={isLoading}
            empty={isEmpty || (!isLoading && (!data || data.every(s => s.values.length === 0)))}
            emptyHint={config.emptyHint}
          />
        {/each}
      </div>
    </div>
  {/each}
{/if}
