<script lang="ts">
  import { HARDWARE_COMPONENT_KEYS, type HardwareComponentKey, type HardwareComponentStatus } from '@logtide/shared';
  import { componentLabel, componentTooltip, hardwareStatusTone } from './hardware-meta';

  interface Props {
    components: Record<HardwareComponentKey, HardwareComponentStatus>;
  }

  let { components }: Props = $props();
</script>

<ul class="flex flex-wrap gap-1" aria-label="Component status">
  {#each HARDWARE_COMPONENT_KEYS as key (key)}
    {@const status = components[key] ?? 'unknown'}
    {@const tone = hardwareStatusTone(status)}
    <li
      class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium {status === 'unknown'
        ? 'border-dashed border-border text-muted-foreground'
        : tone.badge}"
      title={componentTooltip(key, status)}
      aria-label={componentTooltip(key, status)}
      data-testid="chip-{key}"
      data-status={status}
    >
      <span class="h-1.5 w-1.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
      {componentLabel(key)}
    </li>
  {/each}
</ul>
