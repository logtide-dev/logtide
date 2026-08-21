<script lang="ts">
  import type { MetricStatConfig, MetricAggregation } from '@logtide/shared';
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
    config: MetricStatConfig;
    onChange: (updated: MetricStatConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const aggregations: MetricAggregation[] = ['avg', 'sum', 'min', 'max', 'count', 'last', 'p50', 'p95', 'p99'];

  function update<K extends keyof MetricStatConfig>(key: K, value: MetricStatConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="ms-title">Title</Label>
    <Input
      id="ms-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="ms-metric">Metric name</Label>
    <Input
      id="ms-metric"
      type="text"
      placeholder="e.g. process.cpu.utilization"
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
      <Label>Time range</Label>
      <Select
        type="single"
        value={config.timeRange}
        onValueChange={(v) => v && update('timeRange', v as MetricStatConfig['timeRange'])}
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
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-1.5">
      <Label for="ms-service">Service (optional)</Label>
      <Input
        id="ms-service"
        type="text"
        placeholder="all"
        value={config.serviceName ?? ''}
        oninput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          update('serviceName', v.length > 0 ? v : null);
        }}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="ms-unit">Unit suffix</Label>
      <Input
        id="ms-unit"
        type="text"
        placeholder="ms, %, req/s"
        value={config.unit ?? ''}
        oninput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          update('unit', v.length > 0 ? v : null);
        }}
      />
    </div>
  </div>
</div>
