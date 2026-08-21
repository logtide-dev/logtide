<script lang="ts">
  import type { GeoMapConfig, LogLevelKey } from '@logtide/shared';
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
    config: GeoMapConfig;
    onChange: (updated: GeoMapConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const modeOptions: Array<{ value: GeoMapConfig['mode']; label: string }> = [
    { value: 'country', label: 'By country' },
    { value: 'points', label: 'By location (points)' },
  ];

  const allLevels: LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];

  function update<K extends keyof GeoMapConfig>(key: K, value: GeoMapConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function toggleLevel(level: LogLevelKey) {
    const next = config.levels.includes(level)
      ? config.levels.filter((l) => l !== level)
      : [...config.levels, level];
    update('levels', next);
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="geomap-title">Title</Label>
    <Input
      id="geomap-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Mode</Label>
    <Select
      type="single"
      value={config.mode}
      onValueChange={(v) => v && update('mode', v as GeoMapConfig['mode'])}
    >
      <SelectTrigger>
        <SelectValue>{modeOptions.find((o) => o.value === config.mode)?.label ?? config.mode}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each modeOptions as option}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.interval}
      onValueChange={(v) => v && update('interval', v as GeoMapConfig['interval'])}
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
    <Label>Levels (none selected = all)</Label>
    <div class="flex flex-wrap gap-2">
      {#each allLevels as level}
        <button
          type="button"
          class="rounded-md border px-2 py-1 text-xs {config.levels.includes(level)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground'}"
          onclick={() => toggleLevel(level)}
        >
          {level}
        </button>
      {/each}
    </div>
  </div>

  {#if config.mode === 'points'}
    <div class="space-y-1.5">
      <Label for="geomap-limit">Max points</Label>
      <Input
        id="geomap-limit"
        type="number"
        min="10"
        max="500"
        value={config.limit}
        oninput={(e) => {
          const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
          if (!Number.isNaN(v)) update('limit', Math.min(500, Math.max(10, v)));
        }}
      />
    </div>
  {/if}

  <div class="space-y-1.5">
    <Label for="geomap-prefix">Geo field prefix</Label>
    <Input
      id="geomap-prefix"
      type="text"
      value={config.fieldPrefix}
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        if (/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(v)) update('fieldPrefix', v);
      }}
    />
    <p class="text-xs text-muted-foreground">
      The target of your GeoIP pipeline step (default: geo).
    </p>
  </div>

  <div class="space-y-1.5">
    <Label for="geomap-service">Service (optional)</Label>
    <Input
      id="geomap-service"
      type="text"
      value={config.service ?? ''}
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        update('service', v === '' ? null : v);
      }}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="geomap-hostname">Hostname (optional)</Label>
    <Input
      id="geomap-hostname"
      type="text"
      value={config.hostname ?? ''}
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        update('hostname', v === '' ? null : v);
      }}
    />
  </div>
</div>
