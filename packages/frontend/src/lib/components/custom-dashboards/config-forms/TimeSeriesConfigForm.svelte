<script lang="ts">
  import type { TimeSeriesConfig, LogLevelKey } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { resolveSeriesLabel } from '../panels/series-labels';
  import { TIME_RANGE_OPTIONS, timeRangeLabel } from '../time-range-options';

  interface Props {
    config: TimeSeriesConfig;
    onChange: (updated: TimeSeriesConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const levels: LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];

  function update<K extends keyof TimeSeriesConfig>(key: K, value: TimeSeriesConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function toggleLevel(level: LogLevelKey) {
    const set = new Set(config.levels);
    if (set.has(level)) {
      // Backend requires at least one level - refuse to remove the last one.
      if (set.size <= 1) return;
      set.delete(level);
    } else {
      set.add(level);
    }
    update('levels', Array.from(set));
  }

  // Selected levels in canonical order, so the label inputs never reorder.
  const labelledLevels = $derived(levels.filter((level) => config.levels.includes(level)));

  function setSeriesLabel(level: LogLevelKey, raw: string) {
    const next: Partial<Record<LogLevelKey, string>> = { ...config.seriesLabels };
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      next[level] = trimmed;
    } else {
      delete next[level];
    }
    update('seriesLabels', Object.keys(next).length > 0 ? next : undefined);
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="ts-title">Title</Label>
    <Input
      id="ts-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.interval}
      onValueChange={(v) => v && update('interval', v as TimeSeriesConfig['interval'])}
    >
      <SelectTrigger>
        <SelectValue>{timeRangeLabel(config.interval)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each TIME_RANGE_OPTIONS as option (option.value)}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-1.5">
    <Label>Levels to plot</Label>
    <div class="flex flex-wrap gap-2">
      {#each levels as level}
        <button
          type="button"
          class="px-2.5 py-1 rounded border text-xs capitalize transition-colors {config.levels.includes(level) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}"
          onclick={() => toggleLevel(level)}
        >
          {level}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-1.5">
    <Label>Series labels (optional)</Label>
    <div class="space-y-2">
      {#each labelledLevels as level (level)}
        <div class="space-y-1">
          <Label for="ts-label-{level}" class="text-xs text-muted-foreground">Label for {level}</Label>
          <Input
            id="ts-label-{level}"
            type="text"
            maxlength={40}
            placeholder={resolveSeriesLabel(level)}
            value={config.seriesLabels?.[level] ?? ''}
            oninput={(e) => setSeriesLabel(level, (e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      {/each}
    </div>
  </div>

  <div class="space-y-1.5">
    <Label for="ts-service">Service filter (optional)</Label>
    <Input
      id="ts-service"
      type="text"
      placeholder="Leave empty for all services"
      value={config.service ?? ''}
      oninput={(e) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        update('service', val.length > 0 ? val : null);
      }}
    />
  </div>
</div>
