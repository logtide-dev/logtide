<script lang="ts">
  import type { AlertStatusConfig } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';

  interface Props {
    config: AlertStatusConfig;
    onChange: (updated: AlertStatusConfig) => void;
  }

  let { config, onChange }: Props = $props();

  function update<K extends keyof AlertStatusConfig>(key: K, value: AlertStatusConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="as-title">Title</Label>
    <Input
      id="as-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="as-project">Project</Label>
    <ProjectSelect
      id="as-project"
      value={config.projectId}
      onChange={(projectId) => onChange({ ...config, projectId })}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="as-limit">Number of rules to show</Label>
    <Input
      id="as-limit"
      type="number"
      min="3"
      max="20"
      value={config.limit}
      oninput={(e) => {
        const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        if (!Number.isNaN(v)) update('limit', Math.min(20, Math.max(3, v)));
      }}
    />
  </div>

  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={config.showHistory}
      onchange={(e) => update('showHistory', (e.currentTarget as HTMLInputElement).checked)}
      class="h-4 w-4"
    />
    <span>Show recent trigger history</span>
  </label>

  <p class="text-xs text-muted-foreground">
    Shows every alert rule in the selected project, or in the whole organization when
    no project is selected.
  </p>
</div>
