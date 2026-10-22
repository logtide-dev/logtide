<script lang="ts">
  import type { MonitorOutage } from '$lib/api/monitoring';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { formatDuration } from './monitor-meta';

  interface Props {
    outages: MonitorOutage[];
  }

  let { outages }: Props = $props();
</script>

{#if outages.length === 0}
  <p class="text-sm text-muted-foreground">Outages appear here once the monitor goes down.</p>
{:else}
  <ul class="divide-y rounded-md border">
    {#each outages as outage (outage.incidentId)}
      <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <SeverityBadge kind="severity" value={outage.severity} />
        <a
          href="/dashboard/incidents/{outage.incidentId}"
          class="font-medium hover:text-primary hover:underline"
        >
          {outage.title}
        </a>
        <span class="text-xs text-muted-foreground">
          <Timestamp value={outage.startedAt} />
        </span>
        <span class="ml-auto text-xs text-muted-foreground">
          {#if outage.resolvedAt === null}
            <span class="font-medium text-destructive-text">Ongoing</span>
          {:else}
            {formatDuration(outage.durationSeconds)}
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}
