<script lang="ts">
  import type { HardwareSeries } from '@logtide/shared';
  import Sparkline from '$lib/components/app/Sparkline.svelte';
  import { seriesLatest } from './hardware-meta';

  interface Props {
    series: HardwareSeries[];
  }

  let { series }: Props = $props();
</script>

{#if series.length > 0}
  <div class="border-t px-4 py-3" data-testid="trends">
    <p class="mb-2 text-xs font-medium text-muted-foreground">Last 7 days</p>
    <ul class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {#each series as s (s.key)}
        <li class="flex items-center justify-between gap-3 text-xs" data-testid="trend">
          <span class="min-w-0 truncate" title={s.label}>{s.label}</span>
          <span class="flex shrink-0 items-center gap-2">
            <Sparkline
              values={s.points.map((p) => p.value)}
              label="{s.label}, last 7 days"
              width={120}
              height={24}
            />
            <span class="w-20 text-right font-medium tabular-nums">{seriesLatest(s)}</span>
          </span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
