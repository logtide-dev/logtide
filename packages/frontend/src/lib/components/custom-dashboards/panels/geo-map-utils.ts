// ============================================================================
// Geo map panel helpers
// ============================================================================

import type { FeatureCollection } from 'geojson';
import type { GeoMapConfig } from '@logtide/shared';

const MIN_RADIUS = 4;
const MAX_RADIUS = 18;

// Bubble AREA must track volume, so radius scales with sqrt(count): a country
// with 10x the traffic reads as 10x the ink, not 100x.
export function bubbleRadius(count: number, maxCount: number): number {
  if (maxCount <= 0) return MAX_RADIUS;
  const ratio = Math.min(1, Math.max(0, count / maxCount));
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(ratio);
}

// Signature of every config field that changes WHAT the panel queries (#304).
// The panel re-fits the viewport only when this key changes (or on first
// paint / the explicit control); background refreshes keep the user's pan and
// zoom. `title` is display-only, so it is excluded on purpose; level order is
// normalized because it does not change the query.
export function geoMapRefitKey(config: GeoMapConfig): string {
  return [
    config.mode,
    config.fieldPrefix,
    config.projectId ?? '',
    config.interval,
    [...config.levels].sort().join(','),
    config.service ?? '',
    config.hostname ?? '',
    String(config.limit),
  ].join('|');
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

/** What the geo map panel payload says about where its locations came from. */
export interface GeoMapSourceInfo {
  points: unknown[];
  droppedCount: number;
  source?: 'geo_fields' | 'ip' | 'none';
  ipField?: string;
  ipLimitReached?: boolean;
  geoipUnavailable?: boolean;
}

/** Title and hint of the empty panel, by what the server found. */
export function geoMapEmptyState(
  data: GeoMapSourceInfo | null,
  fieldPrefix: string
): { title: string; hint: string } {
  if (data?.geoipUnavailable) {
    return {
      title: 'IP locations are not available',
      hint: `Logs carry client IPs in "${data.ipField}", but the GeoLite2 database is not loaded on this server. It is downloaded on start, so check the server's network access.`,
    };
  }
  if (data?.source === 'ip') {
    return {
      title: 'No IP could be placed on the map',
      hint: `Client IPs come from "${data.ipField}". Private and unknown addresses have no location.`,
    };
  }
  return {
    title: 'No geo data in this time range',
    hint: `The map locates the client IP of each log (a field such as "client_ip", or the one set in the panel settings), or reads the fields of a GeoIP pipeline step (target "${fieldPrefix}").`,
  };
}

/** Footnotes under a non-empty map. */
export function geoMapFootnotes(data: GeoMapSourceInfo): string[] {
  const notes: string[] = [];
  if (data.source === 'ip') {
    notes.push(
      data.ipLimitReached
        ? `Located from "${data.ipField}" with GeoLite2, the 10,000 most frequent IPs`
        : `Located from "${data.ipField}" with GeoLite2`
    );
  }
  if (data.droppedCount > 0) {
    const n = data.droppedCount.toLocaleString('en-US');
    notes.push(
      data.source === 'ip'
        ? data.droppedCount === 1
          ? '1 address without a location was skipped'
          : `${n} addresses without a location were skipped`
        : `${n} values without valid coordinates were skipped`
    );
  }
  return notes;
}
