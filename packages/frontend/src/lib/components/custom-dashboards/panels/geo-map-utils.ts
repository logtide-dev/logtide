// ============================================================================
// Geo map panel helpers
// ============================================================================

import type { FeatureCollection } from 'geojson';

const MIN_RADIUS = 4;
const MAX_RADIUS = 18;

// Bubble AREA must track volume, so radius scales with sqrt(count): a country
// with 10x the traffic reads as 10x the ink, not 100x.
export function bubbleRadius(count: number, maxCount: number): number {
  if (maxCount <= 0) return MAX_RADIUS;
  const ratio = Math.min(1, Math.max(0, count / maxCount));
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(ratio);
}

// World base layer: bundled Natural Earth 110m TopoJSON (about 106 KB),
// converted to GeoJSON at load. Lazy so the dashboard route only pays for it
// when a geo_map panel is actually rendered. Zero network requests: works
// air-gapped, unlike tile servers.
let worldPromise: Promise<FeatureCollection> | null = null;

export function loadWorldGeoJson(): Promise<FeatureCollection> {
  if (!worldPromise) {
    worldPromise = (async () => {
      const [{ default: world }, { feature }] = await Promise.all([
        import('world-atlas/countries-110m.json'),
        import('topojson-client'),
      ]);
      const topo = world as unknown as Parameters<typeof feature>[0];
      const countries = (topo as unknown as { objects: { countries: never } }).objects.countries;
      return feature(topo, countries) as unknown as FeatureCollection;
    })();
  }
  return worldPromise;
}
