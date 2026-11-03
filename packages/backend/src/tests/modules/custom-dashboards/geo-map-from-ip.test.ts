// ============================================================================
// geo_map panel: locating client IPs when the GeoIP pipeline fields are missing
// ============================================================================
// Real test db + reservoir; the GeoLite2 database is replaced by a fixed table
// so the expectations do not depend on the downloaded database.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GeoMapConfig } from '@logtide/shared';

const geo = vi.hoisted(() => ({
  ready: true,
  table: {
    '81.2.69.142': { country: 'United Kingdom', countryCode: 'GB', city: 'London', latitude: 51.5142, longitude: -0.0931 },
    '2.125.160.216': { country: 'United Kingdom', countryCode: 'GB', city: 'Boxford', latitude: 51.75, longitude: -1.25 },
    '89.160.20.112': { country: 'Sweden', countryCode: 'SE', city: 'Linköping', latitude: 58.4167, longitude: 15.6167 },
    // Known only by country: GeoLite2 answers 0,0
    '203.0.113.9': { country: 'Italy', countryCode: 'IT', city: null, latitude: 0, longitude: 0 },
  } as Record<string, { country: string; countryCode: string; city: string | null; latitude: number; longitude: number }>,
}));

vi.mock('../../../modules/siem/geolite2-service.js', () => ({
  geoLite2Service: {
    isReady: () => geo.ready,
    lookup: (ip: string) => geo.table[ip] ?? null,
  },
}));

import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import type { GeoMapData } from '../../../modules/custom-dashboards/panel-data-service.js';
import { aggregateIpsToGeo, firstIp, pickIpField } from '../../../modules/custom-dashboards/geo-from-ip.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

let orgId: string;
let projectId: string;
let userId: string;

function config(overrides: Partial<GeoMapConfig> = {}): GeoMapConfig {
  return {
    type: 'geo_map',
    title: 'Traffic map',
    source: 'logs',
    projectId,
    interval: '24h',
    mode: 'country',
    limit: 100,
    fieldPrefix: 'geo',
    levels: [],
    service: null,
    hostname: null,
    ...overrides,
  };
}

const fetchMap = async (c: GeoMapConfig) =>
  (await fetchPanelData(c, { organizationId: orgId, userId })) as GeoMapData;

describe('geo_map from client IPs', () => {
  beforeEach(async () => {
    geo.ready = true;
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;

    const ips = [
      '81.2.69.142', '81.2.69.142', '81.2.69.142',
      '2.125.160.216, 10.0.0.1', // forwarded-for list: the first entry is the client
      '89.160.20.112:51234',
      '203.0.113.9',
      '10.0.0.1', // private: not in the database
      'not-an-ip',
    ];
    for (const ip of ips) {
      await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: { client_ip: ip } });
    }
  });

  it('locates the IPs per country when the GeoIP fields are missing', async () => {
    const data = await fetchMap(config());

    expect(data.source).toBe('ip');
    expect(data.ipField).toBe('client_ip');
    expect(data.ipLimitReached).toBe(false);
    const byCountry = Object.fromEntries(data.points.map((p) => [p.countryCode, p.count]));
    expect(byCountry).toEqual({ GB: 4, SE: 1, IT: 1 });
    expect(data.points.find((p) => p.countryCode === 'GB')!.label).toBe('United Kingdom');
    expect(data.total).toBe(8);
    expect(data.droppedCount).toBe(2); // 10.0.0.1 and not-an-ip
  });

  it('locates the IPs per place in points mode, country-only IPs on the country', async () => {
    const data = await fetchMap(config({ mode: 'points' }));

    expect(data.source).toBe('ip');
    const byLabel = Object.fromEntries(data.points.map((p) => [p.label, p.count]));
    expect(byLabel).toEqual({ 'London, United Kingdom': 3, 'Boxford, United Kingdom': 1, 'Linköping, Sweden': 1, Italy: 1 });
    const italy = data.points.find((p) => p.label === 'Italy')!;
    expect(italy.lat).not.toBe(0);
    expect(data.points[0]).toMatchObject({ label: 'London, United Kingdom', lat: 51.51, lon: -0.09 });
  });

  it('applies the panel filters to the IPs', async () => {
    await createTestLog({ projectId, service: 'api', level: 'error', metadata: { client_ip: '89.160.20.112' } });

    const data = await fetchMap(config({ levels: ['error'] }));

    expect(data.points.map((p) => [p.countryCode, p.count])).toEqual([['SE', 1]]);
    expect(data.total).toBe(1);
  });

  it('prefers the GeoIP pipeline fields when the logs have them', async () => {
    await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: { client_ip: '81.2.69.142', geo_country_code: 'FR' } });

    const data = await fetchMap(config());

    expect(data.source).toBe('geo_fields');
    expect(data.points.map((p) => [p.countryCode, p.count])).toEqual([['FR', 1]]);
  });

  it('uses the configured IP field, even with GeoIP fields present', async () => {
    await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: { peer: '89.160.20.112', geo_country_code: 'FR' } });

    const data = await fetchMap(config({ ipField: 'peer' }));

    expect(data.source).toBe('ip');
    expect(data.ipField).toBe('peer');
    expect(data.points.map((p) => [p.countryCode, p.count])).toEqual([['SE', 1]]);
  });

  it('says when the GeoLite2 database is not loaded', async () => {
    geo.ready = false;

    const data = await fetchMap(config());

    expect(data).toMatchObject({ source: 'ip', ipField: 'client_ip', geoipUnavailable: true, points: [], total: 0 });
  });

  it('returns source none when the logs carry neither GeoIP fields nor a known IP field', async () => {
    const other = await createTestContext();
    await createTestLog({ projectId: other.project.id, service: 'x', level: 'info', metadata: { user: 'a' } });

    const data = (await fetchPanelData(config({ projectId: other.project.id }), {
      organizationId: other.organization.id,
      userId: other.user.id,
    })) as GeoMapData;

    expect(data).toMatchObject({ source: 'none', points: [], total: 0 });
  });

  it('never reads another organization', async () => {
    const other = await createTestContext();

    const data = (await fetchPanelData(config({ projectId: null }), {
      organizationId: other.organization.id,
      userId: other.user.id,
    })) as GeoMapData;

    expect(data.points).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('rejects an IP field outside the metadata key charset', async () => {
    await expect(fetchMap(config({ ipField: "ip') OR 1=1 --" }))).rejects.toThrow('Invalid geo map IP field');
  });
});

describe('geo-from-ip helpers', () => {
  it('reads the client IP out of the usual value shapes', () => {
    expect(firstIp('81.2.69.142')).toBe('81.2.69.142');
    expect(firstIp(' 81.2.69.142 , 10.0.0.1')).toBe('81.2.69.142');
    expect(firstIp('81.2.69.142:8080')).toBe('81.2.69.142');
    expect(firstIp('2001:db8::1')).toBe('2001:db8::1');
    expect(firstIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(firstIp('999.1.1.1')).toBeNull();
    expect(firstIp('example.com')).toBeNull();
    expect(firstIp('')).toBeNull();
  });

  it('picks the first known IP field name', () => {
    expect(pickIpField(['user', 'remote_addr', 'client_ip'])).toBe('client_ip');
    expect(pickIpField(['user', 'remote_addr'])).toBe('remote_addr');
    expect(pickIpField(['user', 'http.client_ip'])).toBeNull();
  });

  it('keeps the top places in points mode', () => {
    const lookup = (ip: string) => geo.table[ip] ?? null;
    const values = [
      { value: '81.2.69.142', count: 5 },
      { value: '89.160.20.112', count: 3 },
      { value: '2.125.160.216', count: 1 },
    ];
    const { points, total } = aggregateIpsToGeo(values, 'points', 2, lookup);
    expect(points.map((p) => p.label)).toEqual(['London, United Kingdom', 'Linköping, Sweden']);
    expect(total).toBe(9);
  });
});
