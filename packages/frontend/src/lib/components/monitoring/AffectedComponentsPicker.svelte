<script lang="ts">
  import type { Monitor } from '$lib/api/monitoring';
  import { monitorTitle } from './monitor-meta';

  interface Props {
    monitors: Monitor[];
    selected: string[];
    legend?: string;
  }

  let { monitors, selected = $bindable([]), legend = 'Affected components' }: Props = $props();

  function toggle(id: string, checked: boolean) {
    if (checked) {
      if (!selected.includes(id)) selected = [...selected, id];
    } else {
      selected = selected.filter((s) => s !== id);
    }
  }
</script>

<fieldset class="space-y-2">
  <legend class="text-sm font-medium">{legend}</legend>
  {#if monitors.length === 0}
    <p class="text-xs text-muted-foreground">This project has no monitors yet.</p>
  {:else}
    <div class="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {#each monitors as m (m.id)}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="rounded"
            checked={selected.includes(m.id)}
            onchange={(e) => toggle(m.id, e.currentTarget.checked)}
          />
          <span class="truncate">{monitorTitle(m)}</span>
        </label>
      {/each}
    </div>
    <p class="text-xs text-muted-foreground">Shown on the public status page next to the update.</p>
  {/if}
</fieldset>
