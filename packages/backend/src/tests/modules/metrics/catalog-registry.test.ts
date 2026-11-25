import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/index.js';
import {
  registerMetricCatalog,
  distinctCatalogRows,
  resetMetricCatalogThrottle,
  metricCatalogThrottleSize,
  CATALOG_THROTTLE_MS,
} from '../../../modules/metrics/catalog/registry.js';

const T0 = new Date('2026-11-01T10:00:00Z');
const T1 = new Date('2026-11-01T10:05:00Z');
const T2 = new Date('2026-11-01T11:00:00Z');

function rec(over: Record<string, unknown> = {}) {
  return { time: T0, metricName: 'cpu.usage', metricType: 'gauge', ...over } as never;
}

async function rows(projectId: string) {
  return db.selectFrom('metric_catalog').selectAll().where('project_id', '=', projectId).orderBy('metric_name').execute();
}

describe('metric catalog registry', () => {
  let projectId: string;

  beforeEach(async () => {
    resetMetricCatalogThrottle();
    const ctx = await createTestContext();
    projectId = ctx.project.id;
  });

  it('collapses a batch to distinct (name, type) with the time span', () => {
    const out = distinctCatalogRows([
      rec({ time: T1, unit: 'By' }),
      rec({ time: T0 }),
      rec({ metricType: 'sum', isMonotonic: true }),
      rec({ metricName: '' }),
      rec({ time: new Date('nope') }),
    ]);
    expect(out).toHaveLength(2);
    const gauge = out.find((r) => r.type === 'gauge')!;
    expect(gauge.unit).toBe('By');
    expect(gauge.firstSeen).toEqual(T0);
    expect(gauge.lastSeen).toEqual(T1);
    expect(out.find((r) => r.type === 'sum')!.isMonotonic).toBe(true);
  });

  it('upserts one row per (name, type) and keeps min first_seen, max last_seen', async () => {
    const n = await registerMetricCatalog(
      [rec({ time: T1, unit: '%', description: 'cpu' }), rec({ time: T0 }), rec({ metricType: 'sum' })],
      projectId,
      1000
    );
    expect(n).toBe(2);
    let r = await rows(projectId);
    expect(r).toHaveLength(2);
    const gauge = r.find((x) => x.metric_type === 'gauge')!;
    expect(gauge.unit).toBe('%');
    expect(gauge.description).toBe('cpu');
    expect(gauge.first_seen_at).toEqual(T0);
    expect(gauge.last_seen_at).toEqual(T1);

    // older batch after the throttle: last_seen must not go back, first_seen goes back
    const older = new Date('2026-11-01T09:00:00Z');
    await registerMetricCatalog([rec({ time: older })], projectId, 1000 + CATALOG_THROTTLE_MS);
    r = await rows(projectId);
    const g2 = r.find((x) => x.metric_type === 'gauge')!;
    expect(g2.first_seen_at).toEqual(older);
    expect(g2.last_seen_at).toEqual(T1);
    expect(g2.unit).toBe('%'); // not erased by a record without a unit

    await registerMetricCatalog([rec({ time: T2 })], projectId, 1000 + 2 * CATALOG_THROTTLE_MS);
    expect((await rows(projectId)).find((x) => x.metric_type === 'gauge')!.last_seen_at).toEqual(T2);
  });

  it('throttles repeats inside the window but writes a changed unit or description at once', async () => {
    expect(await registerMetricCatalog([rec({ unit: 'By' })], projectId, 0)).toBe(1);
    expect(await registerMetricCatalog([rec({ unit: 'By', time: T2 })], projectId, 1000)).toBe(0);
    expect((await rows(projectId))[0].last_seen_at).toEqual(T0);

    expect(await registerMetricCatalog([rec({ unit: 'KiBy' })], projectId, 2000)).toBe(1);
    expect((await rows(projectId))[0].unit).toBe('KiBy');

    expect(await registerMetricCatalog([rec({ unit: 'KiBy', description: 'new text' })], projectId, 3000)).toBe(1);
    expect((await rows(projectId))[0].description).toBe('new text');

    // a record without unit never counts as a change
    expect(await registerMetricCatalog([rec()], projectId, 4000)).toBe(0);
    expect(metricCatalogThrottleSize()).toBe(1);
  });

  it('never throws and lets the next batch retry when the database fails', async () => {
    const spy = vi.spyOn(db, 'insertInto').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(registerMetricCatalog([rec()], projectId, 0)).resolves.toBe(0);
    spy.mockRestore();
    err.mockRestore();
    expect(metricCatalogThrottleSize()).toBe(0);
    expect(await registerMetricCatalog([rec()], projectId, 1)).toBe(1);
  });

  it('is a no-op for an empty batch', async () => {
    expect(await registerMetricCatalog([], projectId)).toBe(0);
    expect(await rows(projectId)).toHaveLength(0);
  });

  it('is cascaded away with the project', async () => {
    await registerMetricCatalog([rec()], projectId, 0);
    await db.deleteFrom('projects').where('id', '=', projectId).execute();
    expect(await rows(projectId)).toHaveLength(0);
  });
});
