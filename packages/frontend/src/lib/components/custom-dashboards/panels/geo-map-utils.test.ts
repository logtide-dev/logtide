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
});
