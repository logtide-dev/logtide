// ============================================================================
// log_table panel fetcher integration tests
// ============================================================================
// Real test db + reservoir, same style as geo-map-panel.test.ts:
// row shape + cell resolution, filters, tenancy, live short-circuit.

import { describe, it, expect, beforeEach } from 'vitest';
import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import type { LogTableSnapshot } from '../../../modules/custom-dashboards/panel-data-service.js';
import type { LogTableConfig } from '@logtide/shared';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

let orgId: string;
let projectId: string;
let userId: string;
let otherProjectId: string;

function baseConfig(overrides: Partial<LogTableConfig> = {}): LogTableConfig {
  return {
    type: 'log_table',
    title: 'WAN hits',
    source: 'logs',
    projectId,
    mode: 'snapshot',
    timeRange: '24h',
    levels: [],
    service: null,
    maxRows: 25,
    columns: ['http_host', 'geo.city', 'missing_key'],
    builtinColumns: ['time', 'level', 'service', 'message'],
    wrapCells: false,
    ...overrides,
  };
}

beforeEach(async () => {
  const ctx = await createTestContext();
  orgId = ctx.organization.id;
  projectId = ctx.project.id;
  userId = ctx.user.id;

  const otherCtx = await createTestContext();
  otherProjectId = otherCtx.project.id;

  await createTestLog({
    projectId,
    service: 'caddy',
    level: 'info',
    message: 'GET /',
    metadata: { http_host: 'a.example.com', geo: { city: 'Rome' }, http_status: 200 },
  });
  await createTestLog({
    projectId,
    service: 'caddy',
    level: 'error',
    message: 'GET /admin',
    metadata: { http_host: 'b.example.com', 'geo.city': 'LiteralCity', geo: { city: 'Nested' } },
  });
  await createTestLog({
    projectId,
    service: 'api',
    level: 'info',
    message: 'no metadata here',
  });

  // Other org (must never leak)
  await createTestLog({ projectId: otherProjectId, service: 'spy', level: 'info', message: 'secret' });
});

describe('log_table fetcher', () => {
  it('returns rows newest-first with cells aligned to columns', async () => {
    const data = (await fetchPanelData(baseConfig(), { organizationId: orgId, userId })) as LogTableSnapshot;

    expect(data.logs).toHaveLength(3);
    // Cells align 1:1 with config.columns
    for (const row of data.logs) {
      expect(row.cells).toHaveLength(3);
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
      expect(row.projectId).toBe(projectId);
    }
    const caddyA = data.logs.find((r) => r.message === 'GET /')!;
    expect(caddyA.cells).toEqual(['a.example.com', 'Rome', null]);
    // Exact key beats dot-path traversal
    const caddyB = data.logs.find((r) => r.message === 'GET /admin')!;
    expect(caddyB.cells[1]).toBe('LiteralCity');
    // No metadata -> all null cells
    const bare = data.logs.find((r) => r.message === 'no metadata here')!;
    expect(bare.cells).toEqual([null, null, null]);
    // Newest first
    const times = data.logs.map((r) => new Date(r.time).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('serializes object values as JSON cells', async () => {
    const data = (await fetchPanelData(
      baseConfig({ columns: ['geo'] }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    const caddyA = data.logs.find((r) => r.message === 'GET /')!;
    expect(caddyA.cells[0]).toBe('{"city":"Rome"}');
  });

  it('applies level and service filters', async () => {
    const errorsOnly = (await fetchPanelData(
      baseConfig({ levels: ['error', 'critical'] }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    expect(errorsOnly.logs).toHaveLength(1);
    expect(errorsOnly.logs[0].message).toBe('GET /admin');

    const apiOnly = (await fetchPanelData(
      baseConfig({ service: 'api' }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    expect(apiOnly.logs).toHaveLength(1);
    expect(apiOnly.logs[0].service).toBe('api');
  });

  it('caps rows at maxRows', async () => {
    for (let i = 0; i < 12; i++) {
      await createTestLog({ projectId, service: 'bulk', level: 'info', message: `bulk ${i}` });
    }
    const data = (await fetchPanelData(
      baseConfig({ maxRows: 10 }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    expect(data.logs).toHaveLength(10);
  });

  it('never leaks another org (tenancy, org-wide config)', async () => {
    const data = (await fetchPanelData(
      baseConfig({ projectId: null }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    expect(data.logs.some((r) => r.message === 'secret')).toBe(false);
    expect(data.logs).toHaveLength(3);
  });

  it('short-circuits live mode with an empty snapshot', async () => {
    const data = (await fetchPanelData(
      baseConfig({ mode: 'live' }),
      { organizationId: orgId, userId }
    )) as LogTableSnapshot;
    expect(data.logs).toEqual([]);
  });
});
