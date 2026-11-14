<script lang="ts">
  import type { HardwareFinding } from '@logtide/shared';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { componentLabel, formatFindingNumbers, hardwareStatusLabel, hardwareStatusTone } from './hardware-meta';

  interface Props {
    findings: HardwareFinding[];
    muted?: boolean;
  }

  let { findings, muted = false }: Props = $props();

  // Critical first, then by component order of appearance.
  const ordered = $derived(
    [...findings].sort(
      (a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical')
    )
  );
</script>

<section class="rounded-lg border bg-card" aria-labelledby="hw-findings-title">
  <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
    <h2 id="hw-findings-title" class="text-sm font-medium">Findings</h2>
    {#if muted && findings.length > 0}
      <span class="text-xs text-muted-foreground">Muted: no notifications or incidents</span>
    {/if}
  </div>
  {#if ordered.length === 0}
    <p class="px-4 py-3 text-sm text-muted-foreground" data-testid="no-findings">
      No problems found. All reported hardware is within its limits.
    </p>
  {:else}
    <ul class="divide-y">
      {#each ordered as f (f.code + ':' + f.hwId)}
        {@const tone = hardwareStatusTone(f.severity)}
        {@const numbers = formatFindingNumbers(f.value, f.threshold)}
        <li class="flex items-start gap-3 px-4 py-3" data-testid="finding" data-severity={f.severity}>
          {#if f.severity === 'critical'}
            <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 {tone.text}" aria-hidden="true" />
          {:else}
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 {tone.text}" aria-hidden="true" />
          {/if}
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-sm">{f.message}</p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium {tone.text}">{hardwareStatusLabel(f.severity)}</span>
              <span>{componentLabel(f.component)}</span>
              <span class="font-mono">{f.hwId}</span>
              {#if numbers}<span>Value {numbers}</span>{/if}
              <span class="font-mono">{f.code}</span>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
