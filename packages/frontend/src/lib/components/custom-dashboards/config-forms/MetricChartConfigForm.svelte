<script lang="ts">
  import type { MetricChartConfig, MetricAggregation, MetricInterval } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { TIME_RANGE_OPTIONS, timeRangeLabel } from '../time-range-options';

  interface Props {
    config: MetricChartConfig;
    onChange: (updated: MetricChartConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const aggregations: MetricAggregation[] = ['avg', 'sum', 'min', 'max', 'count', 'last', 'p50', 'p95', 'p99'];
  const intervals: MetricInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];

  function update<K extends keyof MetricChartConfig>(key: K, value: MetricChartConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="mc-title">Title</Label>
    <Input
      id="mc-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mc-metric">Metric name</Label>
    <Input
      id="mc-metric"
      type="text"
      placeholder="e.g. http.server.request.duration"
      value={config.metricName}
      oninput={(e) => update('metricName', (e.currentTarget as HTMLInputElement).value)}
      class="font-mono text-sm"
    />
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-1.5">
      <Label>Aggregation</Label>
      <Select
        type="single"
        value={config.aggregation}
        onValueChange={(v) => v && update('aggregation', v as MetricAggregation)}
      >
        <SelectTrigger>
          <SelectValue>{config.aggregation}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each aggregations as a}
            <SelectItem value={a}>{a}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
    <div class="space-y-1.5">
      <Label>Interval</Label>
      <Select
        type="single"
        value={config.interval}
        onValueChange={(v) => v && update('interval', v as MetricInterval)}
      >
        <SelectTrigger>
          <SelectValue>{config.interval}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each intervals as i}
            <SelectItem value={i}>{i}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.timeRange}
      onValueChange={(v) => v && update('timeRange', v as MetricChartConfig['timeRange'])}
    >
      <SelectTrigger>
        <SelectValue>{timeRangeLabel(config.timeRange)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each TIME_RANGE_OPTIONS as option (option.value)}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-1.5">
    <Label for="mc-service">Service filter (optional)</Label>
    <Input
      id="mc-service"
      type="text"
      placeholder="Leave empty for all services"
      value={config.serviceName ?? ''}
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        update('serviceName', v.length > 0 ? v : null);
      }}
    />
  </div>
</div>
