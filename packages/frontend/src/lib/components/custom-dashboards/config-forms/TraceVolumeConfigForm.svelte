<script lang="ts">
  import type { TraceVolumeConfig } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';
  import SuggestInput from '../pickers/SuggestInput.svelte';
  import {
    createServiceOptions,
    keepServiceForProject,
  } from '../pickers/options-state.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { TIME_RANGE_OPTIONS, timeRangeLabel } from '../time-range-options';

  interface Props {
    config: TraceVolumeConfig;
    onChange: (updated: TraceVolumeConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const services = createServiceOptions('traces', () => config.projectId);

  // Keep the selected service when the new project offers it, drop it otherwise.
  async function handleProjectChange(projectId: string | null) {
    onChange({ ...config, projectId });
    if (!(await keepServiceForProject('traces', projectId, config.serviceName))) {
      onChange({ ...config, projectId, serviceName: null });
    }
  }


  function update<K extends keyof TraceVolumeConfig>(key: K, value: TraceVolumeConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="tv-title">Title</Label>
    <Input
      id="tv-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="tv-project">Project</Label>
    <ProjectSelect
      id="tv-project"
      value={config.projectId}
      onChange={handleProjectChange}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.timeRange}
      onValueChange={(v) => v && update('timeRange', v as TraceVolumeConfig['timeRange'])}
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
    <Label for="tv-service">Service filter (optional)</Label>
    <SuggestInput
      id="tv-service"
      placeholder="Leave empty for all services"
      value={config.serviceName ?? ''}
      options={services.list}
      loading={services.loading}
      onChange={(v) => update('serviceName', v.length > 0 ? v : null)}
    />
  </div>

  <div class="flex items-center gap-2">
    <input
      id="tv-errors"
      type="checkbox"
      class="h-4 w-4"
      checked={config.showErrors}
      onchange={(e) => update('showErrors', (e.currentTarget as HTMLInputElement).checked)}
    />
    <Label for="tv-errors" class="cursor-pointer">Show errors line</Label>
  </div>
</div>
