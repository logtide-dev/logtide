import { describe, it, expect } from 'vitest';
import { bubbleRadius, loadWorldGeoJson, geoMapRefitKey, geoMapEmptyState, geoMapFootnotes } from './geo-map-utils';
import type { GeoMapConfig } from '@logtide/shared';

describe('bubbleRadius', () => {
  it('scales with the square root of count (area tracks volume)', () => {
    const max = bubbleRadius(100, 100);
    const quarter = bubbleRadius(25, 100);
    // sqrt(25/100) = 0.5: the radius above the minimum is half of max's
    expect(quarter - 4).toBeCloseTo((max - 4) / 2, 5);
  });

  it('returns the minimum radius for count 0 and the maximum for count = maxCount', () => {
    expect(bubbleRadius(0, 100)).toBe(4);
    expect(bubbleRadius(100, 100)).toBe(18);
  });

  it('never exceeds bounds on degenerate inputs', () => {
    expect(bubbleRadius(5, 0)).toBe(18); // maxCount 0 guard
    expect(bubbleRadius(200, 100)).toBe(18); // count > maxCount clamps
  });
});

describe('geoMapRefitKey (#304)', () => {
  const base: GeoMapConfig = {
    type: 'geo_map',
    title: 'Traffic Map',
    source: 'logs',
    projectId: null,
    interval: '24h',
    mode: 'country',
    limit: 100,
    fieldPrefix: 'geo',
    levels: [],
    service: null,
    hostname: null,
  };

  it('is stable across title-only changes and object identity', () => {
    expect(geoMapRefitKey({ ...base, title: 'Renamed' })).toBe(geoMapRefitKey({ ...base }));
  });

  it('changes when any query-shaping field changes', () => {
    const key = geoMapRefitKey(base);
    expect(geoMapRefitKey({ ...base, mode: 'points' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, fieldPrefix: 'geoip' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, projectId: 'p1' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, interval: '48h' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, levels: ['error'] })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, service: 'caddy' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, hostname: 'edge-1' })).not.toBe(key);
    expect(geoMapRefitKey({ ...base, limit: 200 })).not.toBe(key);
  });

  it('ignores level ordering', () => {
    expect(geoMapRefitKey({ ...base, levels: ['error', 'info'] })).toBe(
      geoMapRefitKey({ ...base, levels: ['info', 'error'] })
    );
  });
});

describe('loadWorldGeoJson', () => {
  it('loads a FeatureCollection with country features', async () => {
    const world = await loadWorldGeoJson();
    expect(world.type).toBe('FeatureCollection');
    expect(world.features.length).toBeGreaterThan(150);
  });

  it('unwraps antimeridian jumps so no ring segment spans the map', async () => {
    // Russia and Fiji cross the antimeridian; a raw +180 -> -180 jump renders
    // as a horizontal line across the whole world map.
    const world = await loadWorldGeoJson();
    const rings = (coords: unknown, geomType: string): number[][][] =>
      geomType === 'Polygon' ? (coords as number[][][]) : (coords as number[][][][]).flat();

    for (const f of world.features) {
      if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
      for (const ring of rings(f.geometry.coordinates, f.geometry.type)) {
        for (let i = 1; i < ring.length; i++) {
          const jump = Math.abs(ring[i][0] - ring[i - 1][0]);
          expect(jump, `feature ${String(f.id)} has a ${jump.toFixed(1)} degree lon jump`).toBeLessThan(180);
        }
      }
    }
  });
});

describe('geo map source texts', () => {
  it('explains an empty map by what the server found', () => {
    expect(geoMapEmptyState(null, 'geo').title).toBe('No geo data in this time range');
    expect(geoMapEmptyState({ points: [], droppedCount: 0, source: 'none' }, 'geo').hint).toContain('"client_ip"');
    expect(
      geoMapEmptyState({ points: [], droppedCount: 3, source: 'ip', ipField: 'remote_addr' }, 'geo')
    ).toEqual({
      title: 'No IP could be placed on the map',
      hint: 'Client IPs come from "remote_addr". Private and unknown addresses have no location.',
    });
    expect(
      geoMapEmptyState({ points: [], droppedCount: 0, source: 'ip', ipField: 'client_ip', geoipUnavailable: true }, 'geo')
        .title
    ).toBe('IP locations are not available');
  });

  it('says where the locations come from under the map', () => {
    expect(geoMapFootnotes({ points: [1], droppedCount: 0, source: 'geo_fields' })).toEqual([]);
    expect(geoMapFootnotes({ points: [1], droppedCount: 2, source: 'geo_fields' })).toEqual([
      '2 values without valid coordinates were skipped',
    ]);
    expect(geoMapFootnotes({ points: [1], droppedCount: 1, source: 'ip', ipField: 'client_ip' })).toEqual([
      'Located from "client_ip" with GeoLite2',
      '1 address without a location was skipped',
    ]);
    expect(
      geoMapFootnotes({ points: [1], droppedCount: 1200, source: 'ip', ipField: 'ip', ipLimitReached: true })
    ).toEqual([
      'Located from "ip" with GeoLite2, the 10,000 most frequent IPs',
      '1,200 addresses without a location were skipped',
    ]);
  });
});
