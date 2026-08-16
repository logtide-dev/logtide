<script lang="ts">
  // Generic panel shell. Knows nothing about specific panel types - looks up
  // the registry by panel.config.type and renders the matching component.

  import type { PanelInstance } from '@logtide/shared';
  import { getPanelDefinition } from './panel-registry';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import X from '@lucide/svelte/icons/x';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';

  interface Props {
    panel: PanelInstance;
    data: unknown;
    loading: boolean;
    error: string | null;
    editMode: boolean;
    paused?: boolean;
    onEdit?: (panelId: string) => void;
    onRemove?: (panelId: string) => void;
    onRefresh?: (panelId: string) => void;
    onTogglePause?: () => void;
    onResizeStart?: (panelId: string, ev: PointerEvent) => void;
  }

  let {
    panel,
    data,
    loading,
    error,
    editMode,
    paused = false,
    onEdit,
    onRemove,
    onRefresh,
    onTogglePause,
    onResizeStart,
  }: Props = $props();

  const def = $derived(getPanelDefinition(panel.config.type));
  const PanelComponent = $derived(def.component);

  function handleResizePointerDown(ev: PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    onResizeStart?.(panel.id, ev);
  }
</script>

<div
  class="relative h-full flex flex-col rounded-lg border bg-card overflow-hidden"
  class:ring-2={editMode}
  class:ring-primary={editMode}
>
  <!-- Header strip -->
  <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
    <div class="flex items-center gap-2 min-w-0">
      {#if editMode}
        <span class="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground" title="Drag to reorder">
          <GripVertical class="w-4 h-4" />
        </span>
      {/if}
      <h3 class="text-sm font-medium truncate">{panel.config.title}</h3>
      {#if paused && !editMode}
        <span class="flex-shrink-0 text-[10px] uppercase tracking-wide text-amber-500">Paused</span>
      {/if}
    </div>
    <div class="flex items-center gap-1 flex-shrink-0">
      {#if !editMode && onTogglePause}
        <button
          type="button"
          class="p-1 rounded hover:bg-accent {paused
            ? 'text-amber-500 hover:text-amber-500'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => onTogglePause?.()}
          title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
        >
          {#if paused}
            <Play class="w-3.5 h-3.5" />
          {:else}
            <Pause class="w-3.5 h-3.5" />
          {/if}
        </button>
      {/if}
      {#if !editMode && onRefresh}
        <button
          type="button"
          class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onclick={() => onRefresh?.(panel.id)}
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
        </button>
      {/if}
      {#if editMode}
        <button
          type="button"
          class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          onclick={() => onEdit?.(panel.id)}
          title="Configure panel"
        >
          <Settings2 class="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          class="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          onclick={() => onRemove?.(panel.id)}
          title="Remove panel"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      {/if}
    </div>
  </div>

  <!-- Body -->
  <div class="flex-1 min-h-0 overflow-hidden">
    {#if loading && data === null}
      <div class="p-3 h-full">
        <Skeleton class="h-full w-full" />
      </div>
    {:else if error}
      <div class="flex h-full items-center justify-center p-4 text-center text-sm text-destructive">
        {error}
      </div>
    {:else}
      <PanelComponent config={panel.config as any} {data} {loading} {error} {paused} />
    {/if}
  </div>

  <!-- Resize handle (edit mode only) -->
  {#if editMode}
    <button
      type="button"
      class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-muted-foreground hover:text-primary z-20"
      title="Drag to resize"
      onpointerdown={handleResizePointerDown}
      aria-label="Resize panel"
    >
      <svg viewBox="0 0 16 16" class="w-full h-full" fill="currentColor" aria-hidden="true">
        <path d="M14 14h-2v-2h2v2zm0-4h-2V8h2v2zm0-4h-2V4h2v2zm-4 8H8v-2h2v2zm0-4H8V8h2v2zm-4 4H4v-2h2v2z" />
      </svg>
    </button>
  {/if}
</div>
