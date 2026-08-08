<script lang="ts">
  import { browser } from '$app/environment';
  import { tick, onMount } from 'svelte';
  import type { Map as LeafletMap } from 'leaflet';
  import type { GeoMapConfig } from '@logtide/shared';
  import { bubbleRadius, loadWorldGeoJson } from './geo-map-utils';

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

  let mapContainer: HTMLDivElement | undefined = $state();
  let map: LeafletMap | null = null;
  let mapError = $state<string | null>(null);
  let isInitializing = false;
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
    if (map) {
      try {
        map.remove();
      } catch {
        // ignore cleanup errors
      }
      map = null;
    }
  }

  async function renderMap() {
    if (isInitializing || !browser || !isMounted) return;
    await tick();
    if (!mapContainer || !typed || typed.points.length === 0) return;

    if ((mapContainer as unknown as { _leaflet_id?: number })._leaflet_id) {
      destroyMap();
      await tick();
    }
    if (!mapContainer || !document.body.contains(mapContainer)) return;

    isInitializing = true;
    try {
      const [L, world] = await Promise.all([import('leaflet'), loadWorldGeoJson()]);
      await import('leaflet/dist/leaflet.css');

      if (!mapContainer || !document.body.contains(mapContainer)) return;

      // No tile layer on purpose: the bundled world GeoJSON is the base map,
      // so the panel works air-gapped and follows the app theme.
      map = L.map(mapContainer, {
        attributionControl: false,
        zoomControl: true,
        minZoom: 1,
        maxZoom: 8,
        worldCopyJump: true,
      }).setView([20, 0], 1);

      L.geoJSON(world, {
        style: () => ({ className: 'geo-map-country', weight: 0.5 }),
        interactive: false,
      }).addTo(map);

      const maxCount = Math.max(...typed.points.map((p) => p.count));
      const bounds = L.latLngBounds([]);

      for (const point of typed.points) {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: bubbleRadius(point.count, maxCount),
          className: 'geo-map-bubble',
          weight: 1,
        }).addTo(map);

        marker.bindTooltip(
          `<span class="font-medium">${escapeHtml(point.label)}</span> ${point.count.toLocaleString('en-US')}`,
          { direction: 'top' }
        );
        bounds.extend([point.lat, point.lon]);
      }

      if (typed.points.length > 1) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 5 });
      } else {
        map.setView([typed.points[0].lat, typed.points[0].lon], 4);
      }

      mapError = null;
    } catch (err) {
      console.error('Failed to initialize geo map:', err);
      mapError = 'Failed to load map';
    } finally {
      isInitializing = false;
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
    if (browser && isMounted && container && points && points.length > 0) {
      const timeout = setTimeout(() => {
        renderMap();
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
    <div bind:this={mapContainer} class="min-h-0 flex-1 rounded-md"></div>
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
  :global(.leaflet-container) {
    background: transparent;
    font: inherit;
  }
  :global(.leaflet-tooltip) {
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    border-color: hsl(var(--border));
  }
</style>
