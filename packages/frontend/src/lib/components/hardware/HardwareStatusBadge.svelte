<script lang="ts">
  import { hardwareStatusLabel, hardwareStatusTone } from './hardware-meta';

  interface Props {
    status: string;
  }

  let { status }: Props = $props();

  const tone = $derived(hardwareStatusTone(status));
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
  data-testid="hardware-status"
  data-status={status}
>
  <span class="h-1.5 w-1.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
  {hardwareStatusLabel(status)}
</span>
