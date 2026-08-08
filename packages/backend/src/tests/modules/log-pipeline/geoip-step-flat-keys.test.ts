import { describe, it, expect, vi } from 'vitest';
import { runGeoIpStep } from '../../../modules/log-pipeline/steps/geoip.js';
import type { GeoIpStep } from '../../../modules/log-pipeline/types.js';

vi.mock('../../../modules/siem/geolite2-service.js', () => ({
  geoLite2Service: {
    lookup: vi.fn((ip: string) => {
      if (ip === '203.0.113.10') {
        return {
          ip,
          country: 'Italy',
          countryCode: 'IT',
          city: 'Rome',
          latitude: 41.9027835,
          longitude: 12.4963655,
          timezone: 'Europe/Rome',
          accuracy: 50,
          subdivision: 'Lazio',
          postalCode: '00100',
        };
      }
      if (ip === '198.51.100.7') {
        return {
          ip,
          country: 'Singapore',
          countryCode: 'SG',
          city: null,
          latitude: 1.3521,
          longitude: 103.8198,
          timezone: 'Asia/Singapore',
          accuracy: 100,
          subdivision: null,
          postalCode: null,
        };
      }
      return null;
    }),
  },
}));

const step: GeoIpStep = { type: 'geoip', field: 'client_ip', target: 'geo' };

describe('geoip step flat keys', () => {
  it('writes nested object plus flat keys on successful lookup', async () => {
    const result = await runGeoIpStep(step, {
      metadata: { client_ip: '203.0.113.10' },
    } as never);

    expect(result.geo).toMatchObject({ country: 'Italy', countryCode: 'IT' });
    expect(result.geo_country).toBe('Italy');
    expect(result.geo_country_code).toBe('IT');
    expect(result.geo_city).toBe('Rome');
    expect(result.geo_place).toBe('41.90,12.50|Rome, Italy');
  });

  it('omits city key when city is null', async () => {
    const result = await runGeoIpStep(step, {
      metadata: { client_ip: '198.51.100.7' },
    } as never);

    expect(result.geo_country_code).toBe('SG');
    expect(result).not.toHaveProperty('geo_city');
    expect(result.geo_place).toBe('1.35,103.82|Singapore');
  });

  it('uses the step target as flat key prefix', async () => {
    const upstream: GeoIpStep = { type: 'geoip', field: 'upstream_ip', target: 'upstream_geo' };
    const result = await runGeoIpStep(upstream, {
      metadata: { upstream_ip: '203.0.113.10' },
    } as never);

    expect(result.upstream_geo_country_code).toBe('IT');
    expect(result.upstream_geo_place).toBe('41.90,12.50|Rome, Italy');
    expect(result).not.toHaveProperty('geo_country_code');
  });

  it('returns empty object when lookup misses', async () => {
    const result = await runGeoIpStep(step, {
      metadata: { client_ip: '192.0.2.99' },
    } as never);
    expect(result).toEqual({});
  });

  it('returns empty object when the ip field is absent', async () => {
    const result = await runGeoIpStep(step, { metadata: {} } as never);
    expect(result).toEqual({});
  });
});
