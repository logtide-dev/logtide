import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../../database/index.js';
import { createTestContext, createTestProject } from '../../../helpers/index.js';
import { loadCatalog } from '../../../../modules/metrics/query/units.js';

const NOW = Date.now();

async function seed(projectId: string, name: string, extra: Record<string, unknown>) {
  await db
    .insertInto('metric_catalog')
    .values({
      project_id: projectId,
      metric_name: name,
      metric_type: 'histogram',
      unit: null,
      description: null,
      is_monotonic: null,
      temporality: null,
      first_seen_at: new Date(NOW - 3600_000),
      last_seen_at: new Date(NOW),
      ...extra,
    })
    .execute();
}

describe('loadCatalog', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let second: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    second = (await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id })).id;
  });

  it('reads type, unit, temporality and monotonic flag, filling gaps from older projects of the same type', async () => {
    await seed(ctx.project.id, 'lat', { unit: null, temporality: null });
    await seed(second, 'lat', { unit: 's', temporality: 'delta', last_seen_at: new Date(NOW - 60_000) });
    await seed(ctx.project.id, 'reqs', { metric_type: 'sum', is_monotonic: true, temporality: 'cumulative' });
    // an older row of another type does not lend its temporality
    await seed(second, 'reqs', { metric_type: 'gauge', temporality: 'delta', last_seen_at: new Date(NOW - 600_000) });

    const out = await loadCatalog([ctx.project.id, second], ['lat', 'reqs', 'missing']);
    expect(out.available).toBe(true);
    expect(out.entries.get('lat')).toEqual({ unit: 's', type: 'histogram', temporality: 'delta', isMonotonic: null });
    expect(out.entries.get('reqs')).toEqual({ unit: null, type: 'sum', temporality: 'cumulative', isMonotonic: true });
    expect(out.entries.has('missing')).toBe(false);
  });

  it('is scoped to the given projects', async () => {
    await seed(second, 'lat', { temporality: 'delta' });
    const out = await loadCatalog([ctx.project.id], ['lat']);
    expect(out.entries.size).toBe(0);
  });
});
