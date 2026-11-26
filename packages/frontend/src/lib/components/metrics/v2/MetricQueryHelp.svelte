<!--
  "How does this work" popover of the metric query builder, the metrics twin of
  the logs QuerySyntaxHelp.
-->
<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import CircleHelp from '@lucide/svelte/icons/circle-help';

  const PARTS: { term: string; meaning: string }[] = [
    { term: 'A, B, ...', meaning: 'Each query reads one metric. Several queries draw in the same chart.' },
    { term: 'avg, sum, min, max', meaning: 'How the points of one series are combined inside each interval.' },
    { term: 'rate', meaning: 'Per second change of a counter (requests/s, bytes/s).' },
    { term: 'p50, p95, p99', meaning: 'Percentiles of a histogram, e.g. request duration.' },
    { term: 'by host.name', meaning: 'One series per value (one line per host). Without it, everything is one series.' },
    { term: 'top 10', meaning: 'Keeps the 10 highest series; the rest go into "Other".' },
    { term: 'host.name = vps-app', meaning: 'Filter: only data where the attribute matches.' },
    { term: 'A / B * 100', meaning: 'Formula over the query letters: numbers, + - * / and parentheses.' },
    { term: 'Compare', meaning: 'Adds the same series one hour, day or week earlier, dashed.' },
  ];
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" class="h-8 w-8 shrink-0" aria-label="How metric queries work" title="How metric queries work">
        <CircleHelp class="h-4 w-4" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[400px] p-3" align="end">
    <div class="space-y-3 text-sm">
      <div>
        <p class="font-medium">Metric queries</p>
        <p class="text-xs text-muted-foreground">Pick a metric, choose how to aggregate it, then split or filter it by attributes.</p>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {#each PARTS as row (row.term)}
          <dt><code class="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.term}</code></dt>
          <dd class="self-center text-xs text-muted-foreground">{row.meaning}</dd>
        {/each}
      </dl>
      <p class="text-xs text-muted-foreground">
        Attributes come in two kinds. <span class="font-medium text-foreground">Source</span> attributes describe who sent the
        metric (host.name, service.name, k8s.pod.name). <span class="font-medium text-foreground">Data point</span> attributes
        describe the value itself (cpu state, mountpoint, HTTP route).
      </p>
    </div>
  </Popover.Content>
</Popover.Root>
