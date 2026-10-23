<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { SpanRecord, TraceRecord } from '$lib/api/traces';
  import { buildSpanTree, flattenTree } from '$lib/utils/trace-tree';
  import { barGeometry, spanBarClass } from './waterfall';
  import { formatDuration } from './format';

  interface Props {
    spans: SpanRecord[];
    trace: TraceRecord;
    selectedSpanId: string | null;
    onSelect: (spanId: string | null) => void;
  }

  let { spans, trace, selectedSpanId, onSelect }: Props = $props();

  const tree = $derived(buildSpanTree(spans));
  let collapsed = $state<Set<string>>(new Set());

  // Expanded set = every span with children that the user has not collapsed.
  const expanded = $derived.by(() => {
    const set = new Set<string>();
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        if (!collapsed.has(node.span_id)) set.add(node.span_id);
        walk(node.children);
      }
    };
    walk(tree);
    return set;
  });
  const rows = $derived(flattenTree(tree, expanded));

  const traceStart = $derived(new Date(trace.start_time).getTime());
  const traceDuration = $derived.by(() => {
    const end = new Date(trace.end_time).getTime();
    const fromTimes = end - traceStart;
    if (Number.isFinite(fromTimes) && fromTimes > 0) return fromTimes;
    return Number.isFinite(trace.duration_ms) && trace.duration_ms > 0 ? trace.duration_ms : 0;
  });

  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => (f === 0 ? '0ms' : formatDuration(traceDuration * f))));

  function toggle(spanId: string) {
    const next = new Set(collapsed);
    if (next.has(spanId)) next.delete(spanId);
    else next.add(spanId);
    collapsed = next;
  }

  function select(spanId: string) {
    onSelect(selectedSpanId === spanId ? null : spanId);
  }

  function focusRow(el: HTMLElement | null) {
    el?.focus();
  }

  function onRowKeydown(e: KeyboardEvent, spanId: string, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(spanId);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const container = (e.currentTarget as HTMLElement).parentElement;
      const siblings = container?.querySelectorAll<HTMLElement>('[data-span-row]');
      focusRow(siblings?.[index + delta] ?? null);
    }
  }
</script>

<!-- Phones: the timeline scrolls sideways inside this box; the name column stays put. -->
<div class="max-md:overflow-x-auto" data-testid="waterfall-scroll">
<div class="text-sm max-md:min-w-[640px]">
  <div class="mb-2 flex border-b pb-2">
    <div class="w-[220px] shrink-0 pr-4 text-sm font-medium text-muted-foreground sm:w-[280px] max-md:sticky max-md:left-0 max-md:z-10 max-md:w-[170px] max-md:bg-card max-md:pr-2">
      Service and operation
    </div>
    <div class="relative flex-1">
      <div class="flex justify-between text-xs text-muted-foreground">
        {#each ticks as tick, i (i)}
          <span>{tick}</span>
        {/each}
      </div>
    </div>
  </div>

  <div class="space-y-1">
    {#each rows as span, index (span.span_id)}
      {@const geometry = barGeometry(span, traceStart, traceDuration)}
      {@const selected = selectedSpanId === span.span_id}
      <div
        data-span-row
        class="flex cursor-pointer items-center rounded py-1 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selected
          ? 'bg-muted'
          : ''}"
        role="button"
        tabindex="0"
        aria-pressed={selected}
        aria-label="{span.service_name}: {span.operation_name}, {formatDuration(span.duration_ms)}"
        onclick={() => select(span.span_id)}
        onkeydown={(e) => onRowKeydown(e, span.span_id, index)}
      >
        <div
          class="flex w-[220px] shrink-0 items-center gap-1 pr-4 sm:w-[280px] max-md:sticky max-md:left-0 max-md:z-10 max-md:w-[170px] max-md:pr-2 {selected ? 'max-md:bg-muted' : 'max-md:bg-card'}"
          style="padding-left: {span.depth * 16}px"
        >
          {#if span.children.length > 0}
            <button
              type="button"
              class="rounded p-0.5 hover:bg-muted"
              aria-label={expanded.has(span.span_id) ? 'Collapse children' : 'Expand children'}
              aria-expanded={expanded.has(span.span_id)}
              onclick={(e) => {
                e.stopPropagation();
                toggle(span.span_id);
              }}
              onkeydown={(e) => e.stopPropagation()}
            >
              {#if expanded.has(span.span_id)}
                <ChevronDown class="size-4" aria-hidden="true" />
              {:else}
                <ChevronRight class="size-4" aria-hidden="true" />
              {/if}
            </button>
          {:else}
            <div class="w-5"></div>
          {/if}
          <div class="min-w-0 flex-1 md:truncate max-md:break-words max-md:leading-tight" title="{span.service_name}: {span.operation_name}">
            <span class="text-xs text-muted-foreground">{span.service_name}</span>
            <span class="mx-1 text-xs">:</span>
            <span class="text-sm font-medium">{span.operation_name}</span>
          </div>
        </div>

        <div class="relative h-6 flex-1">
          <div class="absolute inset-0 rounded bg-muted/30"></div>
          <div
            data-span-bar
            class="absolute h-full rounded opacity-80 {spanBarClass(span)}"
            style="left: {geometry.left}%; width: {geometry.width}%"
            title="{span.operation_name}: {formatDuration(span.duration_ms)}"
          ></div>
          <div
            class="absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-xs"
            style="left: calc({geometry.left + geometry.width}% + 8px)"
          >
            {formatDuration(span.duration_ms)}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
</div>
