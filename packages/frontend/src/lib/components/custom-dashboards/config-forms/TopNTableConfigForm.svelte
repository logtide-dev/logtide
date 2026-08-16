<script lang="ts">
  import type { TopNTableConfig, LogLevelKey } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';

  interface Props {
    config: TopNTableConfig;
    onChange: (updated: TopNTableConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const dimensionOptions: Array<{ value: TopNTableConfig['dimension']; label: string }> = [
    { value: 'service', label: 'By service' },
    { value: 'error_message', label: 'By error message' },
    { value: 'metadata', label: 'Metadata field' },
  ];

  const intervals: Array<TopNTableConfig['interval']> = ['1h', '24h', '7d'];
  const allLevels: LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];

  function update<K extends keyof TopNTableConfig>(key: K, value: TopNTableConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function toggleLevel(level: LogLevelKey) {
    const current = config.levels ?? [];
    const next = current.includes(level)
      ? current.filter((l) => l !== level)
      : [...current, level];
    update('levels', next);
  }

  // The cagg-backed service dimension has no per-value last seen time.
  const supportsLastSeen = $derived(config.dimension !== 'service');
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="topn-title">Title</Label>
    <Input
      id="topn-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Group by</Label>
    <Select
      type="single"
      value={config.dimension}
      onValueChange={(v) => v && update('dimension', v as TopNTableConfig['dimension'])}
    >
      <SelectTrigger>
        <SelectValue>{dimensionOptions.find((o) => o.value === config.dimension)?.label ?? config.dimension}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each dimensionOptions as option}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  {#if config.dimension === 'metadata'}
    <div class="space-y-1.5">
      <Label for="topn-metadata-field">Metadata field</Label>
      <Input
        id="topn-metadata-field"
        type="text"
        placeholder="geo_place"
        maxlength={64}
        value={config.metadataField ?? ''}
        oninput={(e) => {
          const val = (e.currentTarget as HTMLInputElement).value;
          update('metadataField', val.length > 0 ? val : null);
        }}
      />
      <p class="text-xs text-muted-foreground">
        Flat metadata key, e.g. geo_place or upstream_geo_city
      </p>
      {#if !config.metadataField}
        <p class="text-sm text-destructive">A metadata field is required</p>
      {/if}
    </div>

    <div class="space-y-1.5">
      <Label>Levels (none selected = all)</Label>
      <div class="flex flex-wrap gap-2">
        {#each allLevels as level (level)}
          <button
            type="button"
            class="rounded-md border px-2 py-1 text-xs {(config.levels ?? []).includes(level)
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground'}"
            onclick={() => toggleLevel(level)}
          >
            {level}
          </button>
        {/each}
      </div>
    </div>

    <div class="space-y-1.5">
      <Label for="topn-service">Service (optional)</Label>
      <Input
        id="topn-service"
        type="text"
        placeholder="Leave empty for all services"
        value={config.service ?? ''}
        oninput={(e) => {
          const val = (e.currentTarget as HTMLInputElement).value;
          update('service', val.length > 0 ? val : null);
        }}
      />
    </div>
  {/if}

  <div class="space-y-1.5">
    <Label>Time window</Label>
    <Select
      type="single"
      value={config.interval}
      onValueChange={(v) => v && update('interval', v as TopNTableConfig['interval'])}
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

  <div class="space-y-1.5">
    <Label for="topn-limit">Number of rows</Label>
    <Input
      id="topn-limit"
      type="number"
      min="3"
      max="50"
      value={config.limit}
      oninput={(e) => {
        const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        if (!Number.isNaN(v)) update('limit', Math.min(50, Math.max(3, v)));
      }}
    />
  </div>

  {#if supportsLastSeen}
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={config.showLastSeen ?? false}
        onchange={(e) => update('showLastSeen', (e.currentTarget as HTMLInputElement).checked)}
      />
      Show last seen column
    </label>
  {/if}
</div>
