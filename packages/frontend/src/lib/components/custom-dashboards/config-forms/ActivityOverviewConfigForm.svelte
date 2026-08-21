<script lang="ts">
  import type {
    ActivityOverviewConfig,
    ActivityOverviewSeries,
  } from '@logtide/shared';
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
    config: ActivityOverviewConfig;
    onChange: (updated: ActivityOverviewConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const seriesOptions: Array<{ key: ActivityOverviewSeries; label: string }> = [
    { key: 'logs', label: 'Logs' },
    { key: 'log_errors', label: 'Log errors' },
    { key: 'spans', label: 'Spans' },
    { key: 'span_errors', label: 'Span errors' },
    { key: 'detections', label: 'Detections' },
    { key: 'alerts', label: 'Alerts' },
  ];

  function update<K extends keyof ActivityOverviewConfig>(
    key: K,
    value: ActivityOverviewConfig[K],
  ) {
    onChange({ ...config, [key]: value });
  }

  function toggleSeries(key: ActivityOverviewSeries) {
    const set = new Set(config.series);
    if (set.has(key)) {
      if (set.size <= 1) return;
      set.delete(key);
    } else {
      set.add(key);
    }
    update('series', Array.from(set));
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="ao-title">Title</Label>
    <Input
      id="ao-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.timeRange}
      onValueChange={(v) =>
        v && update('timeRange', v as ActivityOverviewConfig['timeRange'])}
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
    <Label>Series to plot</Label>
    <div class="flex flex-wrap gap-2">
      {#each seriesOptions as opt}
        <button
          type="button"
          class="px-2.5 py-1 rounded border text-xs transition-colors {config.series.includes(opt.key) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
          onclick={() => toggleSeries(opt.key)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>
</div>
