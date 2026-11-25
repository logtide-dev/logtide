<!--
  Metrics tab: every metric a source sends, as small chart cards, 12 at a time.

  Props:
    kind, name       the source
    metricNames      sorted metric names of the source
    organizationId, projectIds, from, to   scope of the queries
-->
<script lang="ts">
  import type { MetricSourceKind } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import SourceMetricCard from './SourceMetricCard.svelte';
  import { buildMetricExploreHref } from './source-model';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    metricNames: string[];
    organizationId: string;
    projectIds: string[] | null;
    from: string;
    to: string;
  }

  let { kind, name, metricNames, organizationId, projectIds, from, to }: Props = $props();

  const PAGE = 12;

  let filter = $state('');
  let shown = $state(PAGE);

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? metricNames.filter((m) => m.toLowerCase().includes(q)) : metricNames;
  });
  const visible = $derived(filtered.slice(0, shown));

  $effect(() => {
    filter;
    shown = PAGE;
  });
</script>

{#if metricNames.length === 0}
  <EmptyState variant="no-data" title="No metrics in this window" description="This source sent no metrics in the selected time range." />
{:else}
  <div class="space-y-3" data-testid="metrics-grid">
    <div class="flex items-center gap-3">
      <Input class="h-9 max-w-xs" placeholder="Filter metrics" aria-label="Filter metrics" bind:value={filter} />
      <p class="text-xs text-muted-foreground">
        {filtered.length.toLocaleString('en-US')} of {metricNames.length.toLocaleString('en-US')} metrics
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each visible as metric (metric)}
        <SourceMetricCard
          {kind}
          {name}
          metricName={metric}
          {organizationId}
          {projectIds}
          {from}
          {to}
          exploreHref={buildMetricExploreHref(kind, name, metric, projectIds)}
        />
      {/each}
    </div>

    {#if filtered.length > shown}
      <div class="flex justify-center">
        <Button variant="outline" size="sm" onclick={() => (shown += PAGE)}>
          Show {Math.min(PAGE, filtered.length - shown)} more
        </Button>
      </div>
    {/if}
  </div>
{/if}
