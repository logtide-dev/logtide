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
