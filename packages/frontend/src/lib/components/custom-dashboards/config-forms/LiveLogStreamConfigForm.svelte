<script lang="ts">
  import type { LiveLogStreamConfig, LogLevelKey } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';
  import SuggestInput from '../pickers/SuggestInput.svelte';
  import {
    createServiceOptions,
    keepServiceForProject,
  } from '../pickers/options-state.svelte';

  interface Props {
    config: LiveLogStreamConfig;
    onChange: (updated: LiveLogStreamConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const services = createServiceOptions('logs', () => config.projectId);

  // Keep the selected service when the new project offers it, drop it otherwise.
  async function handleProjectChange(projectId: string | null) {
    onChange({ ...config, projectId });
    if (!(await keepServiceForProject('logs', projectId, config.service))) {
      onChange({ ...config, projectId, service: null });
    }
  }

  const levels: LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];

  function update<K extends keyof LiveLogStreamConfig>(
    key: K,
    value: LiveLogStreamConfig[K]
  ) {
    onChange({ ...config, [key]: value });
  }

  function toggleLevel(level: LogLevelKey) {
    const set = new Set(config.levels);
    if (set.has(level)) {
      // Backend requires at least one level.
      if (set.size <= 1) return;
      set.delete(level);
    } else {
      set.add(level);
    }
    update('levels', Array.from(set));
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="lls-title">Title</Label>
    <Input
      id="lls-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="lls-project">Project</Label>
    <ProjectSelect
      id="lls-project"
      value={config.projectId}
      onChange={handleProjectChange}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="lls-service">Service filter (optional)</Label>
    <SuggestInput
      id="lls-service"
      placeholder="Leave empty for all services"
      value={config.service ?? ''}
      options={services.list}
      loading={services.loading}
      onChange={(v) => update('service', v.length > 0 ? v : null)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Levels</Label>
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
    <Label for="lls-max-rows">Max rows shown</Label>
    <Input
      id="lls-max-rows"
      type="number"
      min="10"
      max="100"
      value={config.maxRows}
      oninput={(e) => {
        const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        if (!Number.isNaN(v)) update('maxRows', Math.min(100, Math.max(10, v)));
      }}
    />
  </div>
</div>
