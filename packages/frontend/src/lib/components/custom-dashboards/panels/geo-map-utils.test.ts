import { describe, it, expect } from 'vitest';
import { bubbleRadius, loadWorldGeoJson } from './geo-map-utils';

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
