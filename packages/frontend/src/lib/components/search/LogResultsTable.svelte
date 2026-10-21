<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LogEntry } from "$lib/api/logs";
  import { resolveMetadataPath, formatMetadataCell, type LogSearchQuery } from "@logtide/shared";
  import { formatTimeAgo } from "$lib/utils/datetime";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "$lib/components/ui/table";
  import { messageHighlights } from "./query-highlight";

  interface Props {
    logs: LogEntry[];
    projects: { id: string; name: string }[];
    customColumns: string[];
    rowDensity: "comfortable" | "compact";
    selectedIndex: number;
    expandedRows: Set<number>;
    highlightQuery: LogSearchQuery | null;
    onToggleRow: (index: number) => void;
    onOpenContext: (log: LogEntry) => void;
    onFilterService: (value: string) => void;
    onFilterHost: (value: string) => void;
    onFilterLevel: (value: string) => void;
    details: Snippet<[LogEntry, number]>;
  }

  let {
    logs,
    projects,
    customColumns,
    rowDensity,
    selectedIndex,
    expandedRows,
    highlightQuery,
    onToggleRow,
    onOpenContext,
    onFilterService,
    onFilterHost,
    onFilterLevel,
    details,
  }: Props = $props();

  function getLevelColor(level: LogEntry["level"]): string {
    switch (level) {
      case "critical":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-700";
      case "error":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300 dark:border-red-700";
      case "warn":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700";
      case "info":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700";
      case "debug":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
    }
  }

  // Top-level host first (1.6 payloads), then the legacy metadata.hostname.
  function hostOf(log: LogEntry): string | null {
    if (typeof log.hostname === "string" && log.hostname) return log.hostname;
    const meta = log.metadata?.hostname;
    return typeof meta === "string" && meta ? meta : null;
  }

  function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
</script>

<div class="rounded-md border overflow-x-auto">
  <Table class="w-full {rowDensity === 'compact' ? '[&_td]:py-1 [&_th]:py-1' : ''}">
    <TableHeader>
      <TableRow>
        <TableHead class="w-[180px]">Time</TableHead>
        <TableHead class="w-[120px]">Project</TableHead>
        <TableHead class="w-[150px]">Service</TableHead>
        <TableHead class="w-[100px]">Level</TableHead>
        <TableHead>Message</TableHead>
        {#each customColumns as col (col)}
          <TableHead class="w-[120px]">{col}</TableHead>
        {/each}
        <TableHead class="w-[80px]">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {#each logs as log, i}
        {@const hostname = hostOf(log)}
        <TableRow data-log-row class={selectedIndex === i ? 'bg-accent/50 ring-1 ring-primary/30' : ''}>
          <TableCell class="font-mono text-xs">
            <span title={formatTimeAgo(log.time)}>{formatDateTime(log.time)}</span>
          </TableCell>
          <TableCell>
            <a
              href="/dashboard/projects/{log.projectId}"
              class="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {projects.find((p) => p.id === log.projectId)?.name || "Unknown"}
            </a>
          </TableCell>
          <TableCell>
            <div class="flex flex-col gap-0.5">
              <button
                onclick={() => onFilterService(log.service)}
                title="Click to filter by this service"
                class="hover:opacity-80 transition-opacity"
              >
                <Badge variant="outline">{log.service}</Badge>
              </button>
              {#if hostname}
                <button
                  onclick={() => onFilterHost(hostname)}
                  title="Click to filter by this host"
                  class="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors truncate max-w-[140px]"
                >
                  @{hostname}
                </button>
              {/if}
            </div>
          </TableCell>
          <TableCell>
            <button
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase {getLevelColor(
                log.level,
              )} hover:opacity-80 transition-opacity cursor-pointer"
              onclick={() => onFilterLevel(log.level)}
              title="Click to filter by this level"
            >
              {log.level}
            </button>
          </TableCell>
          <TableCell class="max-w-md truncate">
            {#each messageHighlights(log.message, highlightQuery) as seg}
              {#if seg.match}<mark
                  class="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-500/40"
                  >{seg.text}</mark
                >{:else}{seg.text}{/if}
            {/each}
          </TableCell>
          {#each customColumns as col (col)}
            {@const cellValue = resolveMetadataPath(log.metadata, col)}
            <TableCell
              class="font-mono text-xs max-w-[120px] truncate"
              title={cellValue !== undefined && cellValue !== null
                ? formatMetadataCell(cellValue)
                : undefined}
            >
              {#if cellValue !== undefined && cellValue !== null}
                {formatMetadataCell(cellValue)}
              {:else}
                <span class="text-muted-foreground">-</span>
              {/if}
            </TableCell>
          {/each}
          <TableCell>
            <div class="flex gap-2">
              <Button variant="ghost" size="sm" onclick={() => onToggleRow(i)}>
                {expandedRows.has(i) ? "Hide" : "Details"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => onOpenContext(log)}
                title="View logs before and after this entry"
              >
                Context
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {#if expandedRows.has(i)}
          <TableRow>
            <TableCell colspan={6 + customColumns.length} class="bg-muted/50 !p-0">
              {@render details(log, i)}
            </TableCell>
          </TableRow>
        {/if}
      {/each}
    </TableBody>
  </Table>
</div>
