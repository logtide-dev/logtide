<script lang="ts">
  import { onMount } from "svelte";
  import * as echarts from "echarts";
  import { LOG_LEVELS, type LogLevel } from "@logtide/shared";
  import type { LogHistogramBucket } from "$lib/api/logs";
  import { themeStore } from "$lib/stores/theme";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import { levelTone } from "$lib/utils/severity";
  import { formatTimestamp } from "$lib/utils/datetime";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { buildHistogramOption, pointerSelection } from "./histogram";

  interface Props {
    buckets: LogHistogramBucket[];
    bucketSeconds: number;
    /** Logs in the whole window; null while unknown. */
    total: number | null;
    loading: boolean;
    error: string | null;
    /** Live tail: the time range cannot change, so selections are ignored. */
    disabled?: boolean;
    onRangeSelect: (from: Date, to: Date) => void;
    onRetry?: () => void;
  }

  let { buckets, bucketSeconds, total, loading, error, disabled = false, onRangeSelect, onRetry }: Props = $props();

  const DAY_MS = 86_400_000;
  const CLICK_PX = 4;

  const colors = Object.fromEntries(LOG_LEVELS.map((l) => [l, levelTone(l).chart])) as Record<LogLevel, string>;

  type ZrPointer = { offsetX: number; offsetY: number };

  let chartEl: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let drag = $state<{ startX: number; currentX: number; downTime: number } | null>(null);

  const extent = $derived(
    buckets.length > 0
      ? {
          from: Date.parse(buckets[0].time),
          to: Date.parse(buckets[buckets.length - 1].time) + bucketSeconds * 1000,
        }
      : null,
  );
  const totalText = $derived(total === null ? "" : `${total.toLocaleString("en-US")} ${total === 1 ? "log" : "logs"}`);
  const selection = $derived(
    drag && Math.abs(drag.currentX - drag.startX) >= CLICK_PX
      ? { left: Math.min(drag.startX, drag.currentX), width: Math.abs(drag.currentX - drag.startX) }
      : null,
  );

  function buildOption() {
    const withDate = extent !== null && extent.to - extent.from > DAY_MS;
    return buildHistogramOption({
      buckets,
      bucketSeconds,
      colors,
      formatAxis: (ms) => formatTimestamp(ms, { precision: "minute", withDate }),
    });
  }

  function redraw() {
    chart?.setOption(buildOption(), true);
  }

  function timeAt(x: number): number | null {
    if (!chart) return null;
    const value = chart.convertFromPixel({ xAxisIndex: 0 }, x) as unknown;
    const n = Array.isArray(value) ? Number(value[0]) : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function onDown(e: ZrPointer) {
    if (disabled || !extent || !chart) return;
    if (!chart.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
    const downTime = timeAt(e.offsetX);
    if (downTime === null) return;
    drag = { startX: e.offsetX, currentX: e.offsetX, downTime };
    window.addEventListener("mouseup", onWindowUp);
  }

  function onMove(e: ZrPointer) {
    if (drag) drag = { ...drag, currentX: e.offsetX };
  }

  function finish(x: number) {
    const started = drag;
    drag = null;
    window.removeEventListener("mouseup", onWindowUp);
    if (!started || disabled || !extent) return;
    const upTime = timeAt(x) ?? started.downTime;
    const picked = pointerSelection({
      downTime: started.downTime,
      upTime,
      movedPx: Math.abs(x - started.startX),
      bucketSeconds,
      extent,
    });
    onRangeSelect(picked.from, picked.to);
  }

  function onUp(e: ZrPointer) {
    if (drag) finish(e.offsetX);
  }

  // A release outside the canvas still ends the drag at the last known position.
  function onWindowUp() {
    if (drag) finish(drag.currentX);
  }

  onMount(() => {
    const instance = echarts.init(chartEl);
    chart = instance;
    instance.setOption(buildOption());
    const zr = instance.getZr();
    zr.on("mousedown", onDown);
    zr.on("mousemove", onMove);
    zr.on("mouseup", onUp);

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => chart?.resize()) : null;
    observer?.observe(chartEl);
    // Colours and axis labels live in the option, so theme and clock changes redraw it.
    const unsubTheme = themeStore.subscribe(() => redraw());
    const unsubPrefs = displayPreferences.subscribe(() => redraw());

    return () => {
      observer?.disconnect();
      unsubTheme();
      unsubPrefs();
      window.removeEventListener("mouseup", onWindowUp);
      zr.off("mousedown", onDown);
      zr.off("mousemove", onMove);
      zr.off("mouseup", onUp);
      instance.dispose();
      chart = null;
    };
  });

  $effect(() => {
    buckets;
    bucketSeconds;
    redraw();
  });
</script>

<div class="rounded-md border px-3 pt-2 pb-1">
  <div class="flex h-5 items-center justify-between gap-2">
    <p class="text-sm font-medium tabular-nums">{totalText}</p>
    {#if !disabled && buckets.length > 0 && !error}
      <p class="text-xs text-muted-foreground">Click a bar or drag to zoom</p>
    {/if}
  </div>
  <div class="relative h-24 select-none">
    <div
      bind:this={chartEl}
      role="img"
      aria-label="Log volume by level"
      class="h-full w-full {error ? 'invisible' : ''} {loading && buckets.length > 0 ? 'opacity-60' : ''} {disabled
        ? ''
        : 'cursor-crosshair'}"
    ></div>
    {#if selection}
      <div
        data-testid="histogram-selection"
        class="pointer-events-none absolute inset-y-0 border-x border-primary/60 bg-primary/15"
        style="left: {selection.left}px; width: {selection.width}px;"
      ></div>
    {/if}
    {#if loading && buckets.length === 0 && !error}
      <div data-testid="histogram-loading" class="absolute inset-0 py-2">
        <Skeleton class="h-full w-full" />
      </div>
    {/if}
    {#if error}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <p class="text-sm text-muted-foreground">Could not load the histogram</p>
        {#if onRetry}
          <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
        {/if}
      </div>
    {/if}
  </div>
</div>
