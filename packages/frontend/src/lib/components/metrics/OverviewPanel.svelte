<script lang="ts">
  import { goto } from "$app/navigation";
  import MetricCard from "./MetricCard.svelte";
  import EmptyMetrics from "$lib/components/EmptyMetrics.svelte";
  import { chartColors } from "$lib/utils/echarts-theme";
  import type { MetricOverviewItem, MetricAggregateResult } from "$lib/api/metrics";
  import Button from "$lib/components/ui/button/button.svelte";
  import ExternalLink from "@lucide/svelte/icons/external-link";

  interface Props {
    services: Array<{ serviceName: string; metrics: MetricOverviewItem[] }>;
    selectedService: string | null;
    timeseriesMap: Map<string, MetricAggregateResult>;
    loadingMetrics: Set<string>;
    projectId: string;
    timeRange: { from: Date; to: Date };
    onMetricClick: (metricName: string) => void;
  }

  let { services, selectedService, timeseriesMap, loadingMetrics, projectId, timeRange, onMetricClick }: Props = $props();

  let displayServices = $derived(
    selectedService
      ? services.filter(s => s.serviceName === selectedService)
      : services
  );

  const seriesColors = [
    chartColors.series.blue, chartColors.series.green,
    chartColors.series.amber, chartColors.series.purple,
    chartColors.series.orange, chartColors.series.red,
  ];

  function getColor(index: number): string {
    return seriesColors[index % seriesColors.length];
  }

  function goToTraces(serviceName: string) {
    const from = timeRange.from.toISOString();
    const to = timeRange.to.toISOString();
    goto(`/dashboard/traces?service=${encodeURIComponent(serviceName)}&from=${from}&to=${to}&projectId=${projectId}`);
  }

  function goToLogs(serviceName: string) {
    const from = timeRange.from.toISOString();
    const to = timeRange.to.toISOString();
    goto(`/dashboard/search?service=${encodeURIComponent(serviceName)}&from=${from}&to=${to}&project=${projectId}`);
  }
</script>

{#if displayServices.length === 0}
  <EmptyMetrics />
{:else}
  {#each displayServices as service, si}
    <div class="mb-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold">{service.serviceName}</h3>
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
      </div>

      <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each service.metrics as metric, mi}
          <button class="text-left w-full" onclick={() => onMetricClick(metric.metricName)}>
            <MetricCard
              title={metric.metricName}
              metricType={metric.metricType}
              value={metric.latestValue}
              timeseries={timeseriesMap.get(`${metric.metricName}:${metric.serviceName}`) ?? null}
              loading={loadingMetrics.has(`${metric.metricName}:${metric.serviceName}`)}
              color={getColor(si * 4 + mi)}
            />
          </button>
        {/each}
      </div>
    </div>
  {/each}
{/if}
