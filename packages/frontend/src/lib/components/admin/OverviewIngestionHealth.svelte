<script lang="ts">
  import type { IngestionHealthStats } from '$lib/api/admin';
  import { stateTone } from '$lib/utils/severity';
  import { formatCount } from '$lib/utils/format-number';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { ingestionCounterItems } from './overview-health';

  interface Props {
    health: IngestionHealthStats | null;
    loading: boolean;
    error?: string | null;
  }

  let { health, loading, error = null }: Props = $props();

  const items = $derived(health ? ingestionCounterItems(health.counters24h) : []);
  const hasProblems = $derived(items.some((i) => i.alarm && i.count > 0));
</script>

<Card class={hasProblems ? 'border-destructive/50' : ''}>
  <CardHeader class="pb-2">
    <CardTitle class="text-sm font-medium">Ingestion health, last 24 hours</CardTitle>
  </CardHeader>
  <CardContent>
    {#if loading && !health}
      <div class="grid gap-2 sm:grid-cols-2" aria-busy="true">
        <Skeleton class="h-5 w-full" />
        <Skeleton class="h-5 w-full" />
        <Skeleton class="h-5 w-full" />
        <Skeleton class="h-5 w-full" />
      </div>
    {:else if !health}
      <p class="text-sm text-muted-foreground">{error ?? 'Ingestion health is unavailable.'}</p>
    {:else}
      <dl class="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="ingestion-counters">
        {#each items as item (item.key)}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{item.label}</dt>
            <dd class="font-semibold tabular-nums {item.alarm && item.count > 0 ? stateTone('down').text : ''}">
              {formatCount(item.count)}
            </dd>
          </div>
        {/each}
      </dl>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span>
          GeoIP:
          <span class={health.enrichment.geoIp.ready ? stateTone('ok').text : stateTone('acknowledged').text}>
            {health.enrichment.geoIp.ready ? 'ready' : 'unavailable'}
          </span>
        </span>
        <span>
          IP reputation:
          <span class={health.enrichment.ipReputation.ready ? stateTone('ok').text : stateTone('acknowledged').text}>
            {health.enrichment.ipReputation.ready ? 'ready' : 'unavailable'}
          </span>
        </span>
      </div>
    {/if}
  </CardContent>
</Card>
