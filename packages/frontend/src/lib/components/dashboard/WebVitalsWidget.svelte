<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import Gauge from '@lucide/svelte/icons/gauge';
  import { stateTone } from '$lib/utils/severity';

  interface WebVitalMetric {
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    unit: string;
  }

  interface Props {
    metrics: WebVitalMetric[];
  }

  let { metrics }: Props = $props();

  function getRatingColor(rating: string): string {
    switch (rating) {
      case 'good': return stateTone('ok').badge;
      case 'needs-improvement': return stateTone('acknowledged').badge;
      case 'poor': return stateTone('down').badge;
      default: return stateTone('disabled').badge;
    }
  }

  function getRatingLabel(rating: string): string {
    switch (rating) {
      case 'good': return 'Good';
      case 'needs-improvement': return 'Needs work';
      case 'poor': return 'Poor';
      default: return rating;
    }
  }

  function formatValue(name: string, value: number): string {
    if (name === 'CLS') return value.toFixed(3);
    return Math.round(value).toString();
  }

  function getUnit(name: string): string {
    if (name === 'CLS') return '';
    return 'ms';
  }

  function getDescription(name: string): string {
    switch (name) {
      case 'LCP': return 'Largest contentful paint';
      case 'INP': return 'Interaction to next paint';
      case 'CLS': return 'Cumulative layout shift';
      default: return name;
    }
  }
</script>

<Card>
  <CardHeader>
    <div class="flex items-center gap-2">
      <Gauge class="h-5 w-5 text-muted-foreground" />
      <CardTitle>Core web vitals</CardTitle>
    </div>
  </CardHeader>
  <CardContent>
    {#if metrics.length === 0}
      <p class="text-sm text-muted-foreground text-center py-4">
        No Web Vitals data yet. Install <code class="text-xs bg-muted px-1 py-0.5 rounded">web-vitals</code> and enable <code class="text-xs bg-muted px-1 py-0.5 rounded">browser.webVitals</code> in your SDK.
      </p>
    {:else}
      <div class="grid gap-4">
        {#each metrics as metric (metric.name)}
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium">{metric.name}</p>
              <p class="text-xs text-muted-foreground">{getDescription(metric.name)}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-lg font-semibold tabular-nums">
                {formatValue(metric.name, metric.value)}{getUnit(metric.name)}
              </span>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium {getRatingColor(metric.rating)}">
                {getRatingLabel(metric.rating)}
              </span>
            </div>
          </div>
          {#if metric !== metrics[metrics.length - 1]}
            <div class="h-px bg-border"></div>
          {/if}
        {/each}
      </div>
    {/if}
  </CardContent>
</Card>
