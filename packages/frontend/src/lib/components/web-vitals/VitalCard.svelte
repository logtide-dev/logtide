<script lang="ts">
  import type { WebVitalSummary } from '$lib/api/web-vitals';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { levelTone } from '$lib/utils/severity';
  import {
    VITAL_LABELS,
    RATING_LABELS,
    ratingTone,
    formatVitalValue,
    thresholdsLine,
    percentages,
  } from './format';

  interface Props {
    metric: WebVitalSummary;
  }

  let { metric }: Props = $props();

  const tone = $derived(metric.rating ? ratingTone(metric.rating) : levelTone('debug'));
  const hasData = $derived(metric.p75 !== null);

  const segments = $derived.by(() => {
    const d = metric.distribution;
    const pct = percentages([d.good, d.needsImprovement, d.poor]);
    return [
      { key: 'good', label: 'Good', count: d.good, pct: pct[0], tone: ratingTone('good') },
      {
        key: 'needs-improvement',
        label: 'Needs improvement',
        count: d.needsImprovement,
        pct: pct[1],
        tone: ratingTone('needs-improvement'),
      },
      { key: 'poor', label: 'Poor', count: d.poor, pct: pct[2], tone: ratingTone('poor') },
    ];
  });
</script>

<Card data-testid="vital-card">
  <CardContent class="space-y-3 p-5">
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-lg font-semibold">{metric.name}</p>
        <p class="text-xs text-muted-foreground">{VITAL_LABELS[metric.name]}</p>
      </div>
      {#if metric.rating}
        <span
          data-testid="vital-rating"
          class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
        >
          <span class="size-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>
          {RATING_LABELS[metric.rating]}
        </span>
      {/if}
    </div>

    {#if hasData}
      <div>
        <p class="text-3xl font-semibold tabular-nums" data-testid="vital-value">
          {formatVitalValue(metric.name, metric.p75 as number)}
        </p>
        <p class="text-xs text-muted-foreground">
          p75 from {metric.samples.toLocaleString('en-US')} samples
        </p>
      </div>

      <div
        class="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}
      >
        {#each segments as seg (seg.key)}
          {#if seg.pct > 0}
            <div
              data-testid="vital-segment"
              data-segment={seg.key}
              data-pct={seg.pct}
              class={seg.tone.dot}
              style="width: {seg.pct}%"
            ></div>
          {/if}
        {/each}
      </div>
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {#each segments as seg (seg.key)}
          <li class="inline-flex items-center gap-1.5">
            <span class="size-2 rounded-full {seg.tone.dot}" aria-hidden="true"></span>
            {seg.label}
            <span class="tabular-nums text-foreground">{seg.pct}%</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="py-3 text-sm text-muted-foreground" data-testid="vital-no-data">No data</p>
    {/if}

    <p class="text-xs text-muted-foreground">{thresholdsLine(metric.name)}</p>
  </CardContent>
</Card>
