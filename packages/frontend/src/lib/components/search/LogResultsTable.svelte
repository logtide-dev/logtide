<script lang="ts">
  import { onMount } from "svelte";
  import type { LogEntry } from "$lib/api/logs";
  import { resolveMetadataPath, formatMetadataCell, type LogSearchQuery } from "@logtide/shared";
  import { formatTimestamp, formatRelative, getDisplayZoneLabel } from "$lib/utils/datetime";
  import { displayPreferences, type DisplayPreferences } from "$lib/stores/display-preferences";
  import SeverityBadge from "$lib/components/app/SeverityBadge.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { messageHighlights } from "./query-highlight";
  import { logHostname, rowKey } from "./log-fields";
  import { BUILTIN_COLUMN_LABELS, type BuiltinColumn } from "./builtin-columns";
  import {
    ROW_HEIGHT,
    centerScrollTop,
    computeWindow,
    isNearBottom,
    revealScrollTop,
  } from "./virtual-window";

  interface Props {
    logs: LogEntry[];
    projects: { id: string; name: string }[];
    /** Visible built-in columns, in display order. */
    columns: BuiltinColumn[];
    customColumns: string[];
    density: "comfortable" | "compact";
    selectedId: string | null;
    highlightQuery: LogSearchQuery | null;
    hasMore: boolean;
    loadingMore: boolean;
    /** Scroll this log to the middle of the list once it is present (permalinks). */
    centerOnId?: string | null;
    onSelect: (log: LogEntry) => void;
    onFilter: (key: "service" | "host" | "level", value: string) => void;
    onProjectFilter: (projectId: string) => void;
    onLoadMore: () => void;
    onScrollTopChange?: (atTop: boolean) => void;
  }

  let {
    logs,
    projects,
    columns,
    customColumns,
    density,
    selectedId,
    highlightQuery,
    hasMore,
    loadingMore,
    centerOnId = null,
    onSelect,
    onFilter,
    onProjectFilter,
    onLoadMore,
    onScrollTopChange,
  }: Props = $props();

  // Column widths in rem; the message column takes whatever is left.
  const WIDTHS: Record<BuiltinColumn, number | null> = {
    time: 13.5,
    project: 8,
    service: 9,
    host: 9,
    level: 6,
    message: null,
  };
  const CUSTOM_WIDTH = 8;
  const MESSAGE_MIN_WIDTH = 20;
  // A row is one truncated line, so the text beyond this is never visible.
  const MAX_MESSAGE_CHARS = 2000;
  const AT_TOP_PX = 8;

  let scroller = $state<HTMLDivElement | null>(null);
  let header = $state<HTMLTableSectionElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let atTop = true;
  let centeredFor: string | null = null;

  const rowHeight = $derived(ROW_HEIGHT[density]);
  const win = $derived(computeWindow({ scrollTop, viewportHeight, rowHeight, count: logs.length }));
  const keys = $derived(uniqueKeys(logs));
  const visible = $derived(logs.slice(win.start, win.end));
  const colCount = $derived(columns.length + customColumns.length);
  const projectNames = $derived(new Map(projects.map((p) => [p.id, p.name])));
  const minWidth = $derived(
    columns.reduce((sum, c) => sum + (WIDTHS[c] ?? MESSAGE_MIN_WIDTH), 0) + customColumns.length * CUSTOM_WIDTH,
  );
  // Reading the store re-renders the header when the zone preference changes.
  const zoneLabel = $derived.by(() => {
    $displayPreferences;
    return getDisplayZoneLabel();
  });

  /** Keys for the keyed list; a repeated id gets a suffix instead of breaking the list. */
  function uniqueKeys(list: LogEntry[]): string[] {
    const seen = new Map<string, number>();
    return list.map((log, i) => {
      const base = rowKey(log, i);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}#${n}`;
    });
  }

  // `_prefs` is passed from the template so the cell re-renders on a preference change.
  function timeText(time: string, _prefs: DisplayPreferences): string {
    return formatTimestamp(time, { precision: "ms", withDate: true });
  }

  function relativeText(time: string, _prefs: DisplayPreferences): string {
    return formatRelative(time);
  }

  function messageText(message: unknown): string {
    const text = typeof message === "string" ? message : String(message ?? "");
    return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) : text;
  }

  function customCell(log: LogEntry, key: string): string | null {
    const value = resolveMetadataPath(log.metadata ?? null, key);
    return value === undefined || value === null ? null : formatMetadataCell(value);
  }

  function measure() {
    if (!scroller) return;
    // The sticky header sits inside the scroll container and covers the first pixels.
    viewportHeight = Math.max(0, scroller.clientHeight - (header?.offsetHeight ?? 0));
  }

  function syncScroll() {
    if (!scroller) return;
    scrollTop = scroller.scrollTop;
    const nowAtTop = scrollTop < AT_TOP_PX;
    if (nowAtTop !== atTop) {
      atTop = nowAtTop;
      onScrollTopChange?.(nowAtTop);
    }
  }

  function handleScroll() {
    measure();
    syncScroll();
    if (!hasMore || loadingMore) return;
    if (
      isNearBottom({
        scrollTop,
        viewportHeight,
        contentHeight: logs.length * rowHeight,
        threshold: 10 * rowHeight,
      })
    ) {
      onLoadMore();
    }
  }

  function setScroll(top: number) {
    if (!scroller) return;
    scroller.scrollTop = top;
    syncScroll();
  }

  function indexOf(id: string): number {
    return logs.findIndex((log, i) => rowKey(log, i) === id);
  }

  /** Scroll the list back to the newest rows. */
  export function scrollToTop(): void {
    setScroll(0);
  }

  /** Scroll just enough to make the log with this id fully visible. */
  export function reveal(id: string): void {
    const index = indexOf(id);
    if (index < 0 || !scroller) return;
    measure();
    setScroll(revealScrollTop(index, rowHeight, viewportHeight, scroller.scrollTop));
  }

  function handleRowKeydown(event: KeyboardEvent, log: LogEntry) {
    if (event.key !== "Enter" || event.target !== event.currentTarget) return;
    event.preventDefault();
    // Keeps the page-level Enter shortcut from acting on the same key press.
    event.stopPropagation();
    onSelect(log);
  }

  function filterClick(event: MouseEvent, action: () => void) {
    event.stopPropagation();
    action();
  }

  $effect(() => {
    const id = centerOnId;
    if (!id || id === centeredFor || !scroller) return;
    const index = indexOf(id);
    if (index < 0) return;
    centeredFor = id;
    measure();
    setScroll(centerScrollTop(index, rowHeight, viewportHeight));
  });

  onMount(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && scroller) {
      observer = new ResizeObserver(onResize);
      observer.observe(scroller);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  });
</script>

<div class="rounded-md border overflow-hidden">
  <div
    bind:this={scroller}
    data-testid="log-results-scroll"
    class="overflow-auto"
    style="height: max(420px, calc(100dvh - 22rem));"
    onscroll={handleScroll}
  >
    <table class="table-fixed w-full text-sm" style="min-width: {minWidth}rem;">
      <colgroup>
        {#each columns as col (col)}
          <col style={WIDTHS[col] === null ? undefined : `width: ${WIDTHS[col]}rem;`} />
        {/each}
        {#each customColumns as col (col)}
          <col style="width: {CUSTOM_WIDTH}rem;" />
        {/each}
      </colgroup>
      <thead bind:this={header} class="sticky top-0 z-10 bg-muted">
        <tr class="h-9 border-b">
          {#each columns as col (col)}
            <th scope="col" class="px-3 text-left align-middle text-xs font-medium text-muted-foreground truncate">
              {col === "time" ? `Time (${zoneLabel})` : BUILTIN_COLUMN_LABELS[col]}
            </th>
          {/each}
          {#each customColumns as col (col)}
            <th
              scope="col"
              class="px-3 text-left align-middle text-xs font-medium font-mono text-muted-foreground truncate"
              title={col}
            >
              {col}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if win.padTop > 0}
          <tr aria-hidden="true" style="height: {win.padTop}px;">
            <td colspan={colCount} class="p-0"></td>
          </tr>
        {/if}
        {#each visible as log, j (keys[win.start + j])}
          {@const key = rowKey(log, win.start + j)}
          {@const selected = selectedId !== null && key === selectedId}
          {@const host = logHostname(log)}
          <tr
            data-log-row
            data-log-id={key}
            aria-selected={selected}
            tabindex="0"
            class="{density === 'compact' ? 'h-7' : 'h-9'} border-b cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {selected
              ? 'bg-accent'
              : ''}"
            onclick={() => onSelect(log)}
            onkeydown={(e) => handleRowKeydown(e, log)}
          >
            {#each columns as col (col)}
              {#if col === "time"}
                <td class="px-3 py-0 align-middle truncate font-mono text-xs">
                  <span title={relativeText(log.time, $displayPreferences)}
                    >{timeText(log.time, $displayPreferences)}</span
                  >
                </td>
              {:else if col === "project"}
                {@const name = projectNames.get(log.projectId) ?? "Unknown"}
                <td class="px-3 py-0 align-middle truncate">
                  <button
                    type="button"
                    class="max-w-full truncate rounded-md border border-input bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                    aria-label="Filter by project {name}"
                    title="Filter by project {name}"
                    onclick={(e) => filterClick(e, () => onProjectFilter(log.projectId))}
                  >
                    {name}
                  </button>
                </td>
              {:else if col === "service"}
                <td class="px-3 py-0 align-middle truncate">
                  <button
                    type="button"
                    class="max-w-full truncate text-left hover:underline underline-offset-2"
                    aria-label="Filter by service {log.service}"
                    title="Filter by service {log.service}"
                    onclick={(e) => filterClick(e, () => onFilter("service", log.service))}
                  >
                    {log.service}
                  </button>
                </td>
              {:else if col === "host"}
                <td class="px-3 py-0 align-middle truncate font-mono text-xs">
                  {#if host}
                    <button
                      type="button"
                      class="max-w-full truncate text-left text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                      aria-label="Filter by host {host}"
                      title="Filter by host {host}"
                      onclick={(e) => filterClick(e, () => onFilter("host", host))}
                    >
                      {host}
                    </button>
                  {:else}
                    <span class="text-muted-foreground">-</span>
                  {/if}
                </td>
              {:else if col === "level"}
                <td class="px-3 py-0 align-middle truncate">
                  <button
                    type="button"
                    class="max-w-full hover:opacity-80 transition-opacity"
                    aria-label="Filter by level {log.level}"
                    title="Filter by level {log.level}"
                    onclick={(e) => filterClick(e, () => onFilter("level", log.level))}
                  >
                    <SeverityBadge kind="level" value={log.level} />
                  </button>
                </td>
              {:else}
                <td class="px-3 py-0 align-middle truncate">
                  {#each messageHighlights(messageText(log.message), highlightQuery) as seg}
                    {#if seg.match}<mark class="rounded-sm bg-warning/30 text-inherit">{seg.text}</mark
                      >{:else}{seg.text}{/if}
                  {/each}
                </td>
              {/if}
            {/each}
            {#each customColumns as col (col)}
              {@const cell = customCell(log, col)}
              <td class="px-3 py-0 align-middle truncate font-mono text-xs" title={cell ?? undefined}>
                {#if cell !== null}
                  {cell}
                {:else}
                  <span class="text-muted-foreground">-</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
        {#if win.padBottom > 0}
          <tr aria-hidden="true" style="height: {win.padBottom}px;">
            <td colspan={colCount} class="p-0"></td>
          </tr>
        {/if}
        {#if loadingMore || hasMore}
          <tr data-results-footer>
            <td colspan={colCount} class="py-2 text-center">
              {#if loadingMore}
                <Spinner size="sm" class="text-muted-foreground" />
              {:else}
                <Button variant="outline" size="sm" onclick={onLoadMore}>Load more</Button>
              {/if}
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
