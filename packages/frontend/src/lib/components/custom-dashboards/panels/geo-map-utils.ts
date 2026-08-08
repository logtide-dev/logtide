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

// Rings that cross the antimeridian (Russia, Fiji) jump from +180 to -180
// between consecutive points; drawn as-is, that segment is a horizontal line
// across the whole map. Unwrap by shifting each point into the copy of the
// world closest to its predecessor; Leaflet renders coordinates beyond +-180
// fine (worldCopyJump shows the wrapped copies).
function unwrapRing(ring: number[][]): void {
  for (let i = 1; i < ring.length; i++) {
    const delta = ring[i][0] - ring[i - 1][0];
    if (delta > 180) ring[i][0] -= 360;
    else if (delta < -180) ring[i][0] += 360;
  }
}

function unwrapAntimeridian(world: FeatureCollection): FeatureCollection {
  for (const f of world.features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      for (const ring of f.geometry.coordinates) unwrapRing(ring as number[][]);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) unwrapRing(ring as number[][]);
      }
    }
  }
  return world;
}

export function loadWorldGeoJson(): Promise<FeatureCollection> {
  if (!worldPromise) {
    worldPromise = (async () => {
      const [{ default: world }, { feature }] = await Promise.all([
        import('world-atlas/countries-110m.json'),
        import('topojson-client'),
      ]);
      const topo = world as unknown as Parameters<typeof feature>[0];
      const countries = (topo as unknown as { objects: { countries: never } }).objects.countries;
      return unwrapAntimeridian(feature(topo, countries) as unknown as FeatureCollection);
    })();
  }
  return worldPromise;
}
