// ============================================================================
// geo_map panel fetcher integration tests
// ============================================================================
// Real test db + reservoir, same style as panel-data-service.test.ts:
// happy path per mode, untrusted-value dropping, tenancy, empty.

import { describe, it, expect, beforeEach } from 'vitest';
import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import type { GeoMapData } from '../../../modules/custom-dashboards/panel-data-service.js';
import type { GeoMapConfig } from '@logtide/shared';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

let orgId: string;
let projectId: string;
let userId: string;
let otherOrgId: string;
let otherProjectId: string;

function baseConfig(overrides: Partial<GeoMapConfig> = {}): GeoMapConfig {
  return {
    type: 'geo_map',
    title: 'Traffic Map',
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

beforeEach(async () => {
  const ctx = await createTestContext();
  orgId = ctx.organization.id;
  projectId = ctx.project.id;
  userId = ctx.user.id;

  const otherCtx = await createTestContext();
  otherOrgId = otherCtx.organization.id;
  otherProjectId = otherCtx.project.id;

  const meta = (countryCode: string, place: string) => ({
    geo_country_code: countryCode,
    geo_place: place,
  });

  // Primary project: 3 IT hits (2 distinct places), 1 DE hit
  await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: meta('IT', '41.90,12.50|Rome, Italy') });
  await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: meta('IT', '41.90,12.50|Rome, Italy') });
  await createTestLog({ projectId, service: 'caddy', level: 'error', metadata: meta('IT', '45.46,9.19|Milan, Italy') });
  await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: meta('DE', '52.52,13.40|Berlin, Germany') });

  // Untrusted garbage under the same keys (must be dropped, not propagated)
  await createTestLog({ projectId, service: 'caddy', level: 'info', metadata: meta('XX', 'pizza') });

  // Other org (must never leak)
  await createTestLog({ projectId: otherProjectId, service: 'spy', level: 'info', metadata: meta('US', '39.83,-98.58|USA') });
});

describe('geo_map fetcher, country mode', () => {
  it('aggregates by country code and resolves centroids', async () => {
    const data = (await fetchPanelData(baseConfig(), { organizationId: orgId, userId })) as GeoMapData;

    const it_ = data.points.find((p) => p.countryCode === 'IT');
    const de = data.points.find((p) => p.countryCode === 'DE');
    expect(it_).toBeDefined();
    expect(it_!.count).toBe(3);
    expect(it_!.label).toBe('Italy');
    expect(it_!.lat).toBeCloseTo(42.72, 1);
    expect(de!.count).toBe(1);

    // XX has no centroid: dropped and counted
    expect(data.points.find((p) => p.countryCode === 'XX')).toBeUndefined();
    expect(data.droppedCount).toBe(1);
    expect(data.total).toBe(5); // all aggregated values, dropped included
  });

  it('applies the levels filter', async () => {
    const data = (await fetchPanelData(
      baseConfig({ levels: ['error', 'critical'] }),
      { organizationId: orgId, userId }
    )) as GeoMapData;

    expect(data.points).toHaveLength(1);
    expect(data.points[0].countryCode).toBe('IT');
    expect(data.points[0].count).toBe(1);
  });

  it('never leaks another org (tenancy)', async () => {
    const data = (await fetchPanelData(baseConfig(), { organizationId: orgId, userId })) as GeoMapData;
    expect(data.points.find((p) => p.countryCode === 'US')).toBeUndefined();
  });

  it('rejects a projectId from another org', async () => {
    await expect(
      fetchPanelData(baseConfig({ projectId: otherProjectId }), { organizationId: orgId, userId })
    ).rejects.toThrow();
  });
});

describe('geo_map fetcher, points mode', () => {
  it('parses geo_place values into weighted points and drops garbage', async () => {
    const data = (await fetchPanelData(
      baseConfig({ mode: 'points' }),
      { organizationId: orgId, userId }
    )) as GeoMapData;

    const rome = data.points.find((p) => p.label === 'Rome, Italy');
    expect(rome).toBeDefined();
    expect(rome!.count).toBe(2);
    expect(rome!.lat).toBeCloseTo(41.9, 2);
    expect(rome!.lon).toBeCloseTo(12.5, 2);
    expect(data.points).toHaveLength(3); // Rome, Milan, Berlin
    expect(data.droppedCount).toBe(1); // "pizza"
  });

  it('respects the custom field prefix', async () => {
    await createTestLog({
      projectId,
      service: 'caddy',
      level: 'info',
      metadata: { upstream_geo_place: '48.85,2.35|Paris, France' },
    });

    const data = (await fetchPanelData(
      baseConfig({ mode: 'points', fieldPrefix: 'upstream_geo' }),
      { organizationId: orgId, userId }
    )) as GeoMapData;

    expect(data.points).toHaveLength(1);
    expect(data.points[0].label).toBe('Paris, France');
  });
});

describe('geo_map fetcher, empty', () => {
  it('returns empty data when no logs carry geo keys', async () => {
    const emptyCtx = await createTestContext();
    const data = (await fetchPanelData(
      baseConfig({ projectId: emptyCtx.project.id }),
      { organizationId: emptyCtx.organization.id, userId: emptyCtx.user.id }
    )) as GeoMapData;

    expect(data.points).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.droppedCount).toBe(0);
  });
});
