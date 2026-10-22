<script lang="ts">
  import type { SingleStatConfig } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';

  interface Props {
    config: SingleStatConfig;
    onChange: (updated: SingleStatConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const metricOptions: Array<{ value: SingleStatConfig['metric']; label: string }> = [
    { value: 'total_logs', label: 'Total logs (today)' },
    { value: 'error_rate', label: 'Error rate' },
    { value: 'active_services', label: 'Active services' },
    { value: 'throughput', label: 'Throughput (logs/s)' },
  ];

  function update<K extends keyof SingleStatConfig>(key: K, value: SingleStatConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function metricLabel(value: SingleStatConfig['metric']): string {
    return metricOptions.find((o) => o.value === value)?.label ?? value;
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="ss-title">Title</Label>
    <Input
      id="ss-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="ss-project">Project</Label>
    <ProjectSelect
      id="ss-project"
      value={config.projectId}
      onChange={(projectId) => onChange({ ...config, projectId })}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Metric</Label>
    <Select
      type="single"
      value={config.metric}
      onValueChange={(v) => v && update('metric', v as SingleStatConfig['metric'])}
    >
      <SelectTrigger>
        <SelectValue>{metricLabel(config.metric)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each metricOptions as option}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={config.compareWithPrevious}
      onchange={(e) => update('compareWithPrevious', (e.currentTarget as HTMLInputElement).checked)}
      class="h-4 w-4"
    />
    <span>Show comparison vs previous period</span>
  </label>
</div>
