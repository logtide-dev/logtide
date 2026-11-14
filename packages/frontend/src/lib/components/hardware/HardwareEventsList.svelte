<script lang="ts">
  import type { HardwareEvent } from '@logtide/shared';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { levelLabel, levelTone } from '$lib/utils/severity';

  interface Props {
    events: HardwareEvent[];
  }

  let { events }: Props = $props();

  const typeLabel = (t: string) => t.replace(/_/g, ' ');
</script>

<ul class="max-h-96 divide-y overflow-y-auto" data-testid="events">
  {#each events as e (e.id)}
    <li class="flex flex-col gap-1 px-4 py-2 text-xs sm:flex-row sm:items-start sm:gap-3">
      <span class="shrink-0 text-muted-foreground sm:w-40">
        <Timestamp value={e.time} />
      </span>
      <span class="flex shrink-0 items-center gap-1.5">
        <span class="rounded border px-1.5 py-0.5 font-medium {levelTone(e.level).badge}">
          {levelLabel(e.level)}
        </span>
        {#if e.eventType}
          <span class="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{typeLabel(e.eventType)}</span>
        {/if}
      </span>
      <span class="min-w-0 break-words font-mono">{e.message}</span>
    </li>
  {/each}
</ul>
