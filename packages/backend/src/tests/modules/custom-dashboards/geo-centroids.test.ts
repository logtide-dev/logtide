import { describe, it, expect } from 'vitest';
import { COUNTRY_CENTROIDS } from '../../../modules/custom-dashboards/geo-centroids.js';

describe('COUNTRY_CENTROIDS', () => {
  it('covers the common GeoIP countries including microstates', () => {
    for (const code of ['US', 'DE', 'IT', 'CN', 'BR', 'SG', 'HK', 'MT', 'LU']) {
      expect(COUNTRY_CENTROIDS[code], code).toBeDefined();
    }
  });

  it('has coordinates within bounds and a non-empty name for every entry', () => {
    for (const [code, c] of Object.entries(COUNTRY_CENTROIDS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(c.lat, code).toBeGreaterThanOrEqual(-90);
      expect(c.lat, code).toBeLessThanOrEqual(90);
      expect(c.lon, code).toBeGreaterThanOrEqual(-180);
      expect(c.lon, code).toBeLessThanOrEqual(180);
      expect(c.name.length, code).toBeGreaterThan(0);
    }
  });

  it('keeps France on the mainland (not dragged into the Atlantic by overseas territories)', () => {
    const fr = COUNTRY_CENTROIDS.FR;
    expect(fr.lat).toBeCloseTo(46.6, 0);
    expect(fr.lon).toBeCloseTo(2.35, 0);
  });

  it('has a plausible entry count', () => {
    expect(Object.keys(COUNTRY_CENTROIDS).length).toBeGreaterThan(220);
  });
});
