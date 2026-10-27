<script lang="ts">
  interface Props {
    values: number[];
    /** Accessible name, e.g. "Logs per hour, last 24 hours". */
    label: string;
    width?: number;
    height?: number;
  }

  let { values, label, width = 110, height = 26 }: Props = $props();

  const PAD = 2;

  const points = $derived.by(() => {
    const n = values.length;
    if (n === 0) return '';
    const max = Math.max(...values, 0);
    const innerW = width - PAD * 2;
    const innerH = height - PAD * 2;
    return values
      .map((v, i) => {
        const x = n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
        // All-zero (or negative) data draws a flat line on the baseline.
        const y = max > 0 ? PAD + innerH - (Math.max(v, 0) / max) * innerH : PAD + innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
</script>

{#if values.length === 0}
  <span class="text-muted-foreground">-</span>
{:else}
  <svg
    class="text-primary"
    role="img"
    aria-label={label}
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    fill="none"
  >
    <polyline
      {points}
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/if}
