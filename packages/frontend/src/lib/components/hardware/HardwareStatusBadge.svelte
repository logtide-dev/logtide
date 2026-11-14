<script lang="ts">
  import { hardwareStatusLabel, hardwareStatusTone, isNoSensors, NO_SENSORS_TOOLTIP } from './hardware-meta';

  interface Props {
    status: string;
    isVirtual?: boolean;
  }

  let { status, isVirtual = false }: Props = $props();

  const noSensors = $derived(isNoSensors({ status, isVirtual }));
  const tone = $derived(hardwareStatusTone(status));
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
  data-testid="hardware-status"
  data-status={status}
  data-no-sensors={noSensors ? 'true' : undefined}
  title={noSensors ? NO_SENSORS_TOOLTIP : undefined}
>
  <span class="h-1.5 w-1.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
  {noSensors ? 'No sensors' : hardwareStatusLabel(status)}
</span>
