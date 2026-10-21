<script lang="ts">
  import type { LogEntry } from "$lib/api/logs";
  import type { IdentifierMatch } from "$lib/api/correlation";
  import Button from "$lib/components/ui/button/button.svelte";
  import IdentifierBadge from "$lib/components/IdentifierBadge.svelte";
  import BreadcrumbTimeline from "$lib/components/BreadcrumbTimeline.svelte";
  import { copyToClipboard } from "$lib/utils/clipboard";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Filter from "@lucide/svelte/icons/filter";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  interface Props {
    log: LogEntry;
    identifiers: IdentifierMatch[];
    breadcrumbsOpen: boolean;
    onToggleBreadcrumbs: () => void;
    onFilterTrace: (id: string) => void;
    onFilterSession: (id: string) => void;
    onOpenCorrelation: (type: string, value: string) => void;
    onOpenException: () => void;
  }

  let {
    log,
    identifiers,
    breadcrumbsOpen,
    onToggleBreadcrumbs,
    onFilterTrace,
    onFilterSession,
    onOpenCorrelation,
    onOpenException,
  }: Props = $props();

  type Breadcrumb = {
    type: string;
    category?: string;
    message: string;
    level?: string;
    timestamp: number;
    data?: Record<string, unknown>;
  };

  const crumbs = $derived.by((): Breadcrumb[] => {
    const bc = (log.metadata as Record<string, unknown> | undefined)?.breadcrumbs;
    return Array.isArray(bc) ? (bc as Breadcrumb[]) : [];
  });

  const isErrorLevel = $derived(log.level === "error" || log.level === "critical");

  // Copy-to-clipboard feedback for the metadata block
  let copied = $state(false);
  async function copyMetadata() {
    const ok = await copyToClipboard(JSON.stringify(log.metadata, null, 2));
    if (ok) {
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    }
  }
</script>

<div class="p-4 space-y-3 w-0 min-w-full">
  <div>
    <span class="font-semibold">Full Message:</span>
    <div
      class="mt-2 p-3 bg-background rounded-md text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
    >
      {log.message}
    </div>
  </div>
  {#if log.traceId}
    <div class="flex items-center flex-wrap gap-1.5">
      <span class="font-semibold">Trace ID:</span>
      {#if log.projectId}
        <a
          href="/dashboard/traces/{log.traceId}?projectId={log.projectId}"
          class="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
          title="Open trace timeline"
        >
          {log.traceId}
          <ArrowUpRight class="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
        </a>
        <button
          class="inline-flex items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onclick={() => onFilterTrace(log.traceId || "")}
          title="Filter by this trace ID"
          aria-label="Filter by this trace ID"
        >
          <Filter class="h-3 w-3" />
        </button>
      {:else}
        <button
          class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
          onclick={() => onFilterTrace(log.traceId || "")}
          title="Filter by this trace ID"
        >
          {log.traceId}
          <Filter class="h-3 w-3 opacity-60" />
        </button>
      {/if}
    </div>
  {/if}
  {#if log.sessionId}
    <div class="flex items-center flex-wrap gap-1.5">
      <span class="font-semibold">Session ID:</span>
      <button
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-teal-600 transition-colors hover:bg-teal-500/10 dark:text-teal-400"
        onclick={() => onFilterSession(log.sessionId || "")}
        title="Filter by this session ID"
      >
        {log.sessionId}
        <Filter class="h-3 w-3 opacity-60" />
      </button>
    </div>
  {/if}
  {#if identifiers.length > 0}
    <div>
      <span class="font-semibold">Identifiers:</span>
      <div class="flex flex-wrap items-center gap-2 mt-2">
        {#each identifiers as identifier}
          <IdentifierBadge
            type={identifier.type}
            value={identifier.value}
            onclick={() => onOpenCorrelation(identifier.type, identifier.value)}
          />
        {/each}
        <a
          href="/dashboard/settings/patterns"
          class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
        >
          <Settings2 class="w-3 h-3" />
          <span>Configure</span>
        </a>
      </div>
    </div>
  {/if}
  {#if log.metadata}
    <div>
      <span class="font-semibold">Metadata:</span>
      <div class="relative mt-2">
        <Button
          variant="ghost"
          size="icon"
          class="absolute right-1 top-1 z-10 h-6 w-6 bg-background/80 backdrop-blur hover:bg-accent"
          title="Copy metadata"
          aria-label="Copy metadata"
          onclick={copyMetadata}
        >
          {#if copied}
            <Check class="h-3 w-3 text-green-500" />
          {:else}
            <Copy class="h-3 w-3" />
          {/if}
        </Button>
        <div class="p-3 pr-9 bg-background rounded-md max-h-64 overflow-auto">
          <pre class="text-xs w-max">{JSON.stringify(log.metadata, null, 2)}</pre>
        </div>
      </div>
    </div>
  {/if}
  {#if isErrorLevel && log.id}
    <div class="pt-2 border-t mt-3">
      <Button variant="outline" size="sm" onclick={onOpenException} class="gap-2">
        <AlertTriangle class="w-4 h-4 text-red-500" />
        View Exception Details
      </Button>
    </div>
  {/if}
  {#if crumbs.length > 0}
    <div class="pt-2 border-t mt-3">
      <button
        type="button"
        class="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        onclick={onToggleBreadcrumbs}
      >
        <ListTree class="w-4 h-4" />
        Breadcrumbs ({crumbs.length})
        <span class="text-xs ml-auto">{breadcrumbsOpen ? "▾" : "▸"}</span>
      </button>
      {#if breadcrumbsOpen}
        <div class="mt-2 max-h-64 overflow-auto">
          <BreadcrumbTimeline breadcrumbs={crumbs} eventTime={log.time} />
        </div>
      {/if}
    </div>
  {/if}
</div>
