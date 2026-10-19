import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { recordSpanIngestion, recordMetricIngestion, meteringRecorder } from '../../../modules/metering/index.js';
import { getUsageBreakdown } from '../../../modules/metering/index.js';
import { createTestContext } from '../../helpers/factories.js';

describe('recordSpanIngestion', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  it('records the span count for an ingested batch', async () => {
    recordSpanIngestion({ spanCount: 7, organizationId: orgId, projectId });
    await meteringRecorder.flush();

    const rows = await db
      .selectFrom('metering_events')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('type', '=', 'spans.ingested')
      .execute();

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(7);
    expect(rows[0].project_id).toBe(projectId);
  });

  it('records nothing for a zero-span batch', async () => {
    recordSpanIngestion({ spanCount: 0, organizationId: orgId, projectId });
    await meteringRecorder.flush();

    const rows = await db
      .selectFrom('metering_events')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('type', '=', 'spans.ingested')
      .execute();

    expect(rows).toHaveLength(0);
  });
});

describe('recordMetricIngestion', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  const rows = () =>
    db
      .selectFrom('metering_events')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('type', '=', 'metrics.ingested.datapoints')
      .execute();

  it('records the datapoint count and surfaces it in the usage breakdown', async () => {
    recordMetricIngestion({ datapointCount: 9, organizationId: orgId, projectId });
    await meteringRecorder.flush();

    const r = await rows();
    expect(r).toHaveLength(1);
    expect(Number(r[0].quantity)).toBe(9);

    const b = await getUsageBreakdown({
      organizationId: orgId,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 5 * 60 * 1000),
    });
    const byType = Object.fromEntries(b.byType.map((t) => [t.type, t.quantity]));
    expect(byType['metrics.ingested.datapoints']).toBe(9);
  });

  it('records nothing for a zero-datapoint batch', async () => {
    recordMetricIngestion({ datapointCount: 0, organizationId: orgId, projectId });
    await meteringRecorder.flush();
    expect(await rows()).toHaveLength(0);
  });
});

describe('span and metric byte metering (telemetry quota)', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  const sumOf = async (type: string) => {
    await meteringRecorder.flush();
    const r = await db
      .selectFrom('metering_events')
      .select('quantity')
      .where('organization_id', '=', orgId)
      .where('type', '=', type as any)
      .execute();
    return { rows: r.length, total: r.reduce((a, x) => a + Number(x.quantity), 0) };
  };

  const injected = { organizationId: 'org-x', projectId: 'proj-x' };
  const spans = [
    { ...injected, time: 't0', startTime: 't0', spanId: 'a', attributes: { k: 'v', time: 'kept' } },
    { ...injected, time: 't1', startTime: 't1', spanId: 'b', attributes: { k: 'w' } },
  ];
  const points = [{ ...injected, metricName: 'm', value: 1 }, { ...injected, metricName: 'n', value: 2 }];
  // Customer-provided projection: no tenant ids, no span 'time' copy (nested keys untouched).
  const spanBytes = Buffer.byteLength(JSON.stringify([
    { startTime: 't0', spanId: 'a', attributes: { k: 'v', time: 'kept' } },
    { startTime: 't1', spanId: 'b', attributes: { k: 'w' } },
  ]));
  const pointBytes = Buffer.byteLength(JSON.stringify([{ metricName: 'm', value: 1 }, { metricName: 'n', value: 2 }]));

  it('records the JSON byte size of the customer-provided span fields', async () => {
    recordSpanIngestion({ spanCount: 2, organizationId: orgId, projectId, spans });
    expect(await sumOf('spans.ingested.bytes')).toEqual({ rows: 1, total: spanBytes });
  });

  it('records the JSON byte size of the customer-provided datapoint fields', async () => {
    const before = JSON.stringify(points);
    recordMetricIngestion({ datapointCount: 2, organizationId: orgId, projectId, records: points });
    expect(await sumOf('metrics.ingested.bytes')).toEqual({ rows: 1, total: pointBytes });
    expect(JSON.stringify(points)).toBe(before); // stored records are not mutated
  });

  it('prorates a partially accepted batch', async () => {
    recordSpanIngestion({ spanCount: 1, organizationId: orgId, projectId, spans });
    expect((await sumOf('spans.ingested.bytes')).total).toBe(Math.round(spanBytes / 2));
  });

  it('records no bytes when nothing was accepted or no records were given', async () => {
    recordSpanIngestion({ spanCount: 0, organizationId: orgId, projectId, spans });
    recordMetricIngestion({ datapointCount: 0, organizationId: orgId, projectId, records: points });
    recordSpanIngestion({ spanCount: 3, organizationId: orgId, projectId });
    expect((await sumOf('spans.ingested.bytes')).rows).toBe(0);
    expect((await sumOf('metrics.ingested.bytes')).rows).toBe(0);
  });

  it('surfaces the byte types in the usage breakdown', async () => {
    recordSpanIngestion({ spanCount: 2, organizationId: orgId, projectId, spans });
    recordMetricIngestion({ datapointCount: 2, organizationId: orgId, projectId, records: points });
    await meteringRecorder.flush();
    const b = await getUsageBreakdown({
      organizationId: orgId,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 5 * 60 * 1000),
    });
    const types = b.byType.map((t) => t.type);
    expect(types).toContain('spans.ingested.bytes');
    expect(types).toContain('metrics.ingested.bytes');
  });
});
