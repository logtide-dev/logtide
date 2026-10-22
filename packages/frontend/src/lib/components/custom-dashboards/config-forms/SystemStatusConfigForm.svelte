<script lang="ts">
  import type { SystemStatusConfig } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';

  interface Props {
    config: SystemStatusConfig;
    onChange: (updated: SystemStatusConfig) => void;
  }

  let { config, onChange }: Props = $props();

  function update<K extends keyof SystemStatusConfig>(key: K, value: SystemStatusConfig[K]) {
    onChange({ ...config, [key]: value });
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

  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={config.showCounts}
      onchange={(e) => update('showCounts', (e.currentTarget as HTMLInputElement).checked)}
      class="h-4 w-4"
    />
    <span>Show up/down/unknown counts on the right side</span>
  </label>

  <p class="text-xs text-muted-foreground">
    Aggregates every monitor in scope into a single status: operational (all up),
    degraded (some down), or outage (all down). Use a wide layout (12 columns,
    2 rows) for the best look.
  </p>
</div>
