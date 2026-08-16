<script lang="ts">
  // CSS-Grid based dashboard layout with svelte-dnd-action drag-to-reorder.
  //
  // Layout strategy:
  //   - Responsive grid: 1 column on mobile (<640px), 6 cols on tablet
  //     (640-1024px), 12 cols on desktop (>=1024px). The "logical" panel
  //     width stored in layout.w is always in the 12-column reference;
  //     it's clamped at render time to the effective number of columns.
  //   - Auto-flow placement in both view and edit mode so the post-save
  //     layout matches what the user saw while editing.
  //   - `grid-auto-flow: dense` lets smaller panels fill leftover gaps so
  //     mixed sizes don't leave holes in the grid.
  //
  // The container itself is dumb - it gets `panels` + `panelData` + edit mode
  // flag, dispatches reorder/edit/remove events upward.

  import { onMount } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import type { PanelInstance, PanelLayout } from '@logtide/shared';
  import PanelRenderer from './PanelRenderer.svelte';
  import { getPanelDefinition } from './panel-registry';
  import type { PanelDataEntry } from '$lib/stores/custom-dashboards';

  interface Props {
    panels: PanelInstance[];
    panelData: Record<string, PanelDataEntry>;
    editMode: boolean;
    pausedPanelIds?: Set<string>;
    onReorder?: (panels: PanelInstance[]) => void;
    onResizePanel?: (panelId: string, layout: PanelLayout) => void;
    onEditPanel?: (panelId: string) => void;
    onRemovePanel?: (panelId: string) => void;
    onRefreshPanel?: (panelId: string) => void;
    onTogglePanelPause?: (panelId: string) => void;
  }

  let {
    panels,
    panelData,
    editMode,
    pausedPanelIds = new Set<string>(),
    onReorder,
    onResizePanel,
    onEditPanel,
    onRemovePanel,
    onRefreshPanel,
    onTogglePanelPause,
  }: Props = $props();

  const ROW_HEIGHT_PX = 80;
  const ROW_GAP_PX = 16; // matches gap-4 (1rem)
  const COL_GAP_PX = 16;

  // Breakpoint -> effective number of columns. Panels' stored `w` values
  // are scaled relative to this. The drag resize step also uses this so
  // 1 unit = the actual visible column at the current viewport.
  function colsForViewport(width: number): number {
    if (width < 640) return 1; // mobile
    if (width < 1024) return 6; // tablet
    return 12; // desktop
  }

  let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  let effectiveCols = $derived(colsForViewport(viewportWidth));

  onMount(() => {
    const onResize = () => {
      viewportWidth = window.innerWidth;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  let gridEl: HTMLDivElement | undefined = $state();

  /**
   * Compute pixel size of one column unit at the current container width.
   * Uses the *effective* number of columns so resize delta is accurate
   * across breakpoints.
   */
  function colWidthPx(): number {
    if (!gridEl) return 80;
    const width = gridEl.clientWidth;
    const cols = effectiveCols;
    if (cols <= 1) return width;
    return (width - (cols - 1) * COL_GAP_PX) / cols;
  }

  /**
   * Map a panel's stored 12-col width down to the effective grid.
   * Always clamped to [1, effectiveCols] so a panel can never overflow
   * the visible grid.
   */
  function effectiveSpanFor(storedW: number): number {
    if (effectiveCols >= 12) return Math.min(12, Math.max(1, storedW));
    // Scale proportionally: a 6-of-12 panel becomes 3-of-6, 6-of-12 of 1 → 1
    const scaled = Math.round((storedW / 12) * effectiveCols);
    return Math.min(effectiveCols, Math.max(1, scaled));
  }

  // ─── Resize drag state ────────────────────────────────────────────────

  let resizeState: {
    panelId: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    minW: number;
    minH: number;
  } | null = null;

  function handleResizeStart(panelId: string, ev: PointerEvent) {
    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;
    const def = getPanelDefinition(panel.config.type);
    resizeState = {
      panelId,
      startX: ev.clientX,
      startY: ev.clientY,
      startW: panel.layout.w,
      startH: panel.layout.h,
      minW: def.minW,
      minH: def.minH,
    };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
  }

  function handleResizeMove(ev: PointerEvent) {
    if (!resizeState) return;
    const dx = ev.clientX - resizeState.startX;
    const dy = ev.clientY - resizeState.startY;
    const colW = colWidthPx();
    const rowStride = ROW_HEIGHT_PX + ROW_GAP_PX;

    // Width resize only makes sense on the canonical 12-col desktop grid.
    // Below 12 effective columns the visible->stored conversion snaps the
    // logical width by whole rows (a single visible column maps to 12/effectiveCols
    // stored units), which makes resizing erratic and unusable on tablet/mobile.
    // In those breakpoints we keep the stored width unchanged and allow only
    // height resizing.
    let storedDeltaCols = 0;
    if (effectiveCols >= 12) {
      const visibleDeltaCols = Math.round(dx / (colW + COL_GAP_PX));
      storedDeltaCols = visibleDeltaCols;
    }
    const deltaRows = Math.round(dy / rowStride);

    const newW = Math.min(12, Math.max(resizeState.minW, resizeState.startW + storedDeltaCols));
    const newH = Math.min(20, Math.max(resizeState.minH, resizeState.startH + deltaRows));

    const panel = panels.find((p) => p.id === resizeState!.panelId);
    if (!panel) return;

    if (panel.layout.w !== newW || panel.layout.h !== newH) {
      onResizePanel?.(resizeState.panelId, {
        ...panel.layout,
        w: newW,
        h: newH,
      });
    }
  }

  function handleResizeEnd() {
    resizeState = null;
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', handleResizeEnd);
  }

  // svelte-dnd-action requires items to have an `id` field - PanelInstance does.
  // It also mutates internally; we always pass back through onReorder so the
  // store remains the source of truth.
  function handleConsider(e: CustomEvent<{ items: PanelInstance[] }>): void {
    onReorder?.(e.detail.items);
  }

  function handleFinalize(e: CustomEvent<{ items: PanelInstance[] }>): void {
    onReorder?.(e.detail.items);
  }

  function gridStyleFor(panel: PanelInstance): string {
    // Auto-flow placement: panel claims `w` columns and `h` rows, browser
    // places it after the previous one. Same in view and edit mode so the
    // post-save layout matches what the user saw while editing.
    // The width is mapped from the canonical 12-col space to the effective
    // grid so panels naturally collapse on tablet/mobile.
    const w = effectiveSpanFor(panel.layout.w);
    const h = Math.max(1, panel.layout.h);
    return `grid-column: span ${w} / span ${w}; grid-row: span ${h} / span ${h};`;
  }

  function getEntry(id: string): PanelDataEntry {
    return (
      panelData[id] ?? {
        data: null,
        loading: false,
        error: null,
        lastFetchedAt: null,
      }
    );
  }
</script>

<div
  bind:this={gridEl}
  class="grid gap-4"
  style="grid-template-columns: repeat({effectiveCols}, minmax(0, 1fr)); grid-auto-rows: 80px; grid-auto-flow: dense;"
  use:dndzone={{
    items: panels,
    flipDurationMs: 200,
    dragDisabled: !editMode,
    dropTargetStyle: {},
  }}
  onconsider={handleConsider}
  onfinalize={handleFinalize}
>
  {#each panels as panel (panel.id)}
    {@const entry = getEntry(panel.id)}
    <div style={gridStyleFor(panel)} class="min-w-0">
      <PanelRenderer
        {panel}
        data={entry.data}
        loading={entry.loading}
        error={entry.error}
        {editMode}
        paused={pausedPanelIds.has(panel.id)}
        onEdit={onEditPanel}
        onRemove={onRemovePanel}
        onRefresh={onRefreshPanel}
        onTogglePause={onTogglePanelPause ? () => onTogglePanelPause(panel.id) : undefined}
        onResizeStart={handleResizeStart}
      />
    </div>
  {/each}
</div>
