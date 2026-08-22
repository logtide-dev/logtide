<script lang="ts">
  import type { DetectionEventsConfig } from '@logtide/shared';
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
    config: DetectionEventsConfig;
    onChange: (updated: DetectionEventsConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const severities: Array<'critical' | 'high' | 'medium' | 'low' | 'informational'> = [
    'critical',
    'high',
    'medium',
    'low',
    'informational',
  ];

  function update<K extends keyof DetectionEventsConfig>(
    key: K,
    value: DetectionEventsConfig[K]
  ) {
    onChange({ ...config, [key]: value });
  }

  function toggleSeverity(s: (typeof severities)[number]) {
    const set = new Set(config.severities);
    if (set.has(s)) {
      if (set.size <= 1) return;
      set.delete(s);
    } else {
      set.add(s);
    }
    update('severities', Array.from(set));
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="de-title">Title</Label>
    <Input
      id="de-title"
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
      onValueChange={(v) => v && update('timeRange', v as DetectionEventsConfig['timeRange'])}
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
    <Label>Severities</Label>
    <div class="flex flex-wrap gap-2">
      {#each severities as s}
        <button
          type="button"
          class="px-2.5 py-1 rounded border text-xs capitalize transition-colors {config.severities.includes(s) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
          onclick={() => toggleSeverity(s)}
        >
          {s}
        </button>
      {/each}
    </div>
  </div>
</div>
