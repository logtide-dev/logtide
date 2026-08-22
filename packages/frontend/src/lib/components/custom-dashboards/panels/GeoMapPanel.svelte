<script lang="ts">
  import { browser } from '$app/environment';
  import { tick, onMount } from 'svelte';
  import type { Map as LeafletMap, LayerGroup } from 'leaflet';
  import type { GeoMapConfig } from '@logtide/shared';
  import { bubbleRadius, loadWorldGeoJson, geoMapRefitKey } from './geo-map-utils';

  interface GeoMapPoint {
    lat: number;
    lon: number;
    count: number;
    label: string;
    countryCode?: string;
  }

  interface GeoMapData {
    points: GeoMapPoint[];
    total: number;
    droppedCount: number;
  }

  interface Props {
    config: GeoMapConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  const typed = $derived(data as GeoMapData | null);
  const refitKey = $derived(geoMapRefitKey(config));

  let mapContainer: HTMLDivElement | undefined = $state();
  let map: LeafletMap | null = null;
  // Container element the live map was created on. The empty state unmounts
  // the canvas div, so a later non-empty payload binds a NEW div and the old
  // map instance must be dropped.
  let mapEl: HTMLDivElement | null = null;
  let bubbles: LayerGroup | null = null;
  let leaflet: typeof import('leaflet') | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Refit key at the last automatic fit. The viewport auto-fits ONLY on first
  // paint or when this key changes (#304); background refreshes must never
  // move a viewport the user may have panned/zoomed.
  let lastFitKey: string | null = null;
  let mapError = $state<string | null>(null);
  let isSyncing = false;
  let syncQueued = false;
  let isMounted = false;

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function destroyMap() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (map) {
      try {
        map.remove();
      } catch {
        // ignore cleanup errors
      }
      map = null;
    }
    bubbles = null;
    mapEl = null;
    lastFitKey = null;
  }

  function fitToData() {
    const points = typed?.points ?? [];
    if (!map || !leaflet || points.length === 0) return;
    if (points.length > 1) {
      const bounds = leaflet.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 5 });
    } else {
      map.setView([points[0].lat, points[0].lon], 4);
    }
  }

  function addFitControl() {
    if (!map || !leaflet) return;
    const L = leaflet;
    const FitControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'leaflet-bar');
        const link = L.DomUtil.create('a', 'geo-map-fit', div) as HTMLAnchorElement;
        link.href = '#';
        link.title = 'Fit map to data';
        link.setAttribute('role', 'button');
        link.setAttribute('aria-label', 'Fit map to data');
        link.textContent = '⛶';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(link, 'click', (e: Event) => {
          e.preventDefault();
          fitToData();
        });
        return div;
      },
    });
    map.addControl(new FitControl({ position: 'topleft' }));
  }

  function attachResizeObserver(container: HTMLDivElement) {
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      // The old rebuild-on-every-refresh accidentally hid stale sizes; a
      // persistent map must be told when the panel is resized (edit mode
      // drag handle, window resizes).
      map?.invalidateSize();
    });
    resizeObserver.observe(container);
  }

  function renderBubbles(points: GeoMapPoint[]) {
    if (!map || !bubbles || !leaflet) return;
    bubbles.clearLayers();
    const maxCount = Math.max(...points.map((p) => p.count));
    for (const point of points) {
      const marker = leaflet
        .circleMarker([point.lat, point.lon], {
          radius: bubbleRadius(point.count, maxCount),
          className: 'geo-map-bubble',
          weight: 1,
        })
        .addTo(bubbles);
      marker.bindTooltip(
        `<span class="font-medium">${escapeHtml(point.label)}</span> ${point.count.toLocaleString('en-US')}`,
        { direction: 'top' }
      );
    }
  }

  // Incremental update (#304): the map, base layer and controls are created
  // once per container; data refreshes only swap the bubble layer group.
  async function doSync() {
    if (!browser || !isMounted) return;
    await tick();
    const container = mapContainer;
    const points = typed?.points;
    if (!container || !points || points.length === 0) return;
    if (!document.body.contains(container)) return;

    try {
      if (!leaflet) {
        leaflet = await import('leaflet');
        await import('leaflet/dist/leaflet.css');
      }

      if (map && mapEl !== container) destroyMap();

      let created = false;
      if (!map) {
        const world = await loadWorldGeoJson();
        if (!isMounted || mapContainer !== container || !document.body.contains(container)) {
          return;
        }
        // No tile layer on purpose: the bundled world GeoJSON is the base
        // map, so the panel works air-gapped and follows the app theme.
        map = leaflet
          .map(container, {
            attributionControl: false,
            zoomControl: true,
            minZoom: 1,
            maxZoom: 8,
            worldCopyJump: true,
            // Wheel over an embedded panel must scroll the dashboard, not
            // zoom the map: with it enabled, scrolling past the panel both
            // scrolls the page AND silently destroys the user's framing,
            // defeating the viewport preservation this panel guarantees
            // (#304). Zoom stays available via +/-, double click and pinch.
            scrollWheelZoom: false,
          })
          .setView([20, 0], 1);
        leaflet
          .geoJSON(world, {
            style: () => ({ className: 'geo-map-country', weight: 0.5 }),
            interactive: false,
          })
          .addTo(map);
        bubbles = leaflet.layerGroup().addTo(map);
        addFitControl();
        attachResizeObserver(container);
        mapEl = container;
        created = true;
      }

      renderBubbles(points);

      if (created || lastFitKey !== refitKey) {
        fitToData();
        lastFitKey = refitKey;
      }

      mapError = null;
    } catch (err) {
      console.error('Failed to initialize geo map:', err);
      mapError = 'Failed to load map';
    }
  }

  async function syncMap() {
    // Coalesce overlapping runs: a refresh landing mid-initialization is
    // replayed once the current pass finishes instead of racing it.
    if (isSyncing) {
      syncQueued = true;
      return;
    }
    isSyncing = true;
    try {
      await doSync();
    } finally {
      isSyncing = false;
      if (syncQueued) {
        syncQueued = false;
        void syncMap();
      }
    }
  }

  onMount(() => {
    isMounted = true;
    return () => {
      isMounted = false;
      destroyMap();
    };
  });

  $effect(() => {
    const points = typed?.points;
    const container = mapContainer;
    // Tracked on purpose: a config edit must resync (and re-fit) even when
    // the data reference has not changed yet.
    const key = refitKey;
    if (browser && isMounted && container && points && points.length > 0 && key) {
      const timeout = setTimeout(() => {
        void syncMap();
      }, 100);
      return () => clearTimeout(timeout);
    }
  });
</script>

<div class="flex h-full flex-col">
  {#if !typed || typed.points.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
      <p class="text-sm text-muted-foreground">No geo data in this time range</p>
      <p class="text-xs text-muted-foreground">
        Logs need geo metadata: add a GeoIP step to a parsing pipeline
        (target "{config.fieldPrefix}").
      </p>
    </div>
  {:else if mapError}
    <div class="flex flex-1 items-center justify-center text-sm text-destructive">
      {mapError}
    </div>
  {:else}
    <div bind:this={mapContainer} class="geo-map-canvas min-h-0 flex-1 rounded-md"></div>
    {#if typed.droppedCount > 0}
      <p class="px-2 pt-1 text-xs text-muted-foreground">
        {typed.droppedCount.toLocaleString('en-US')} values without valid coordinates were skipped
      </p>
    {/if}
  {/if}
</div>

<style>
  :global(.geo-map-country) {
    fill: hsl(var(--muted));
    fill-opacity: 0.5;
    stroke: hsl(var(--border));
  }
  :global(.geo-map-bubble) {
    fill: hsl(var(--primary));
    fill-opacity: 0.55;
    stroke: hsl(var(--primary));
    stroke-opacity: 0.9;
  }
  /* leaflet.css is imported dynamically AFTER these component styles are
     injected, so plain :global(.leaflet-*) selectors lose the cascade tie to
     it. Anchoring on the scoped container class wins on specificity instead,
     which keeps the map theme-correct in dark mode. */
  .geo-map-canvas {
    background: transparent;
    font: inherit;
    /* Leaflet stacks its panes at z-index 400-1000, far above the app's
       dialogs (z-50). Isolating the canvas creates a stacking context so
       those values stay contained and the map can never paint on top of an
       open dialog. */
    isolation: isolate;
  }
  .geo-map-canvas :global(.leaflet-tooltip) {
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    border-color: hsl(var(--border));
  }
  .geo-map-canvas :global(.leaflet-tooltip-top::before) {
    border-top-color: hsl(var(--popover));
  }
  .geo-map-canvas :global(.leaflet-bar a) {
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    border-color: hsl(var(--border));
  }
  .geo-map-canvas :global(a.geo-map-fit) {
    font-size: 16px;
    line-height: 26px;
  }
</style>
