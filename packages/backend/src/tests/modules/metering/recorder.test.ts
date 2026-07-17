import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { MeteringRecorder } from '../../../modules/metering/recorder.js';
import { createTestContext } from '../../helpers/factories.js';

const tick = () => new Promise((r) => setImmediate(r));

describe('MeteringRecorder', () => {
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  it('buffers without writing until flush', async () => {
    const rec = new MeteringRecorder({ maxBuffer: 1000 });
    rec.record({ type: 'logs.ingested.events', quantity: 5, organizationId: orgId, projectId });

    expect(rec.bufferSize).toBe(1);
    let rows = await db.selectFrom('metering_events').selectAll().where('organization_id', '=', orgId).execute();
    expect(rows).toHaveLength(0);

    await rec.flush();
    expect(rec.bufferSize).toBe(0);
    rows = await db.selectFrom('metering_events').selectAll().where('organization_id', '=', orgId).execute();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(5);
  });

  it('flush on empty buffer is a no-op', async () => {
    const rec = new MeteringRecorder({ maxBuffer: 1000 });
    await expect(rec.flush()).resolves.toBeUndefined();
  });

  it('auto-flushes when buffer reaches maxBuffer', async () => {
    const rec = new MeteringRecorder({ maxBuffer: 2 });
    rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
    rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
    await tick();
    const rows = await db.selectFrom('metering_events').selectAll().where('organization_id', '=', orgId).execute();
    expect(rows).toHaveLength(2);
  });

  it('drops events past the hard cap and counts them (loss-tolerant)', () => {
    const rec = new MeteringRecorder({ maxBuffer: 1_000_000, hardCap: 2 });
    rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
    rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
    rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
    expect(rec.bufferSize).toBe(2);
    expect(rec.droppedCount).toBe(1);
  });

  it('stop() flushes the remaining buffer', async () => {
    const rec = new MeteringRecorder({ maxBuffer: 1000 });
    rec.record({ type: 'logs.ingested.bytes', quantity: 99, organizationId: orgId, projectId });
    await rec.stop();
    const rows = await db.selectFrom('metering_events').selectAll().where('organization_id', '=', orgId).execute();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(99);
  });

  describe('METERING_ENABLED gate', () => {
    const original = config.METERING_ENABLED;

    afterEach(() => {
      config.METERING_ENABLED = original;
    });

    it('still buffers an ingestion.* health counter when metering is disabled', () => {
      config.METERING_ENABLED = false;
      const rec = new MeteringRecorder({ maxBuffer: 1000 });
      rec.record({ type: 'ingestion.timestamp_skew', quantity: 1, organizationId: orgId, projectId });
      expect(rec.bufferSize).toBe(1);
    });

    it('does not buffer a usage event when metering is disabled', () => {
      config.METERING_ENABLED = false;
      const rec = new MeteringRecorder({ maxBuffer: 1000 });
      rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
      expect(rec.bufferSize).toBe(0);
    });

    it('buffers both ingestion.* and usage events when metering is enabled', () => {
      config.METERING_ENABLED = true;
      const rec = new MeteringRecorder({ maxBuffer: 1000 });
      rec.record({ type: 'ingestion.timestamp_skew', quantity: 1, organizationId: orgId, projectId });
      rec.record({ type: 'logs.ingested.events', quantity: 1, organizationId: orgId, projectId });
      expect(rec.bufferSize).toBe(2);
    });
  });
});
