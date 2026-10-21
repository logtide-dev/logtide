<script lang="ts">
  import {
    levelTone,
    severityTone,
    stateTone,
    levelLabel,
    severityLabel,
    stateLabel,
  } from '$lib/utils/severity';

  interface Props {
    kind: 'level' | 'severity' | 'state';
    value: string;
  }

  let { kind, value }: Props = $props();

  const tone = $derived(
    kind === 'level' ? levelTone(value) : kind === 'severity' ? severityTone(value) : stateTone(value),
  );
  const label = $derived(
    kind === 'level' ? levelLabel(value) : kind === 'severity' ? severityLabel(value) : stateLabel(value),
  );
</script>

<span
  data-testid="severity-badge"
  class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
>
  <span class="size-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>
  {label}
</span>
