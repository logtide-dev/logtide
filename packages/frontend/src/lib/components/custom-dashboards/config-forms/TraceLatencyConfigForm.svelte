<script lang="ts">
  import type { TraceLatencyConfig } from '@logtide/shared';
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
    config: TraceLatencyConfig;
    onChange: (updated: TraceLatencyConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const percentiles: Array<'p50' | 'p95' | 'p99'> = ['p50', 'p95', 'p99'];

  function update<K extends keyof TraceLatencyConfig>(key: K, value: TraceLatencyConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function togglePercentile(p: 'p50' | 'p95' | 'p99') {
    const set = new Set(config.showPercentiles);
    if (set.has(p)) {
      if (set.size <= 1) return;
      set.delete(p);
    } else {
      set.add(p);
    }
    update('showPercentiles', Array.from(set));
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="tl-title">Title</Label>
    <Input
      id="tl-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="tl-service">Service filter (optional)</Label>
    <Input
      id="tl-service"
      type="text"
      placeholder="Leave empty for all services"
      value={config.serviceName ?? ''}
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        update('serviceName', v.length > 0 ? v : null);
      }}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.timeRange}
      onValueChange={(v) => v && update('timeRange', v as TraceLatencyConfig['timeRange'])}
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
    <Label>Percentiles to plot</Label>
    <div class="flex flex-wrap gap-2">
      {#each percentiles as p}
        <button
          type="button"
          class="px-2.5 py-1 rounded border text-xs uppercase transition-colors {config.showPercentiles.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
          onclick={() => togglePercentile(p)}
        >
          {p}
        </button>
      {/each}
    </div>
  </div>
</div>
