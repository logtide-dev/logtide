<script lang="ts">
  import type { MonitorStatusConfig } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';

  interface Props {
    config: MonitorStatusConfig;
    onChange: (updated: MonitorStatusConfig) => void;
  }

  let { config, onChange }: Props = $props();

  function update<K extends keyof MonitorStatusConfig>(key: K, value: MonitorStatusConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="mon-title">Title</Label>
    <Input
      id="mon-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mon-project">Project</Label>
    <ProjectSelect
      id="mon-project"
      value={config.projectId}
      onChange={(projectId) => onChange({ ...config, projectId })}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mon-limit">Number of monitors to show</Label>
    <Input
      id="mon-limit"
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

  <p class="text-xs text-muted-foreground">
    Shows every monitor in the selected project, or in the whole organization when no
    project is selected.
  </p>
</div>
