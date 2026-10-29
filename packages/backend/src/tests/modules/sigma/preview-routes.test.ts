import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';

// Wrap previewRule so one test can hold a preview open; everything else runs
// the real implementation against the real reservoir.
const hoisted = vi.hoisted(() => ({ previewRule: vi.fn() }));
vi.mock('../../../modules/sigma/preview-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/sigma/preview-service.js')>();
  hoisted.previewRule.mockImplementation(actual.previewRule);
  return { ...actual, previewRule: hoisted.previewRule };
});

import { build } from '../../../server.js';
import { createTestContext, createTestSigmaRule, createTestLog, createTestProject } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  return { ...ctx, orgId: ctx.organization.id, token: session.token };
}
type S = Awaited<ReturnType<typeof setup>>;

const NEEDLE_RULE = {
  logsource: {},
  detection: { selection: { 'message|contains': 'needle' }, condition: 'selection' },
};

describe('sigma rule history preview', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const preview = (s: S, ruleId: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${ruleId}/preview`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, ...body },
    });

  it('rejects a range other than 24h and 7d with 400', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    expect((await preview(s, rule.id, { range: '30d' })).statusCode).toBe(400);
    expect((await preview(s, rule.id, {})).statusCode).toBe(400);
  });

  it('returns matches for seeded logs in a 24h window and none outside it', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    await createTestLog({ projectId: s.project.id, message: 'a needle in 1h', time: hoursAgo(1) });
    await createTestLog({ projectId: s.project.id, message: 'plain line', time: hoursAgo(2) });
    await createTestLog({ projectId: s.project.id, message: 'needle 30h ago', time: hoursAgo(30) });

    const day = await preview(s, rule.id, { range: '24h' });
    expect(day.statusCode).toBe(200);
    expect(day.json()).toMatchObject({ range: '24h', scanned: 2, matches: 1, suppressed: 0, truncated: false });
    expect(day.json().samples).toHaveLength(1);
    expect(day.json().samples[0]).toMatchObject({ message: 'a needle in 1h', projectId: s.project.id });

    const week = await preview(s, rule.id, { range: '7d' });
    expect(week.json()).toMatchObject({ scanned: 3, matches: 2 });
  });

  it('counts suppressed matches from the rule exceptions', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    await createTestLog({ projectId: s.project.id, service: 'noisy', message: 'needle a', time: hoursAgo(1) });
    await createTestLog({ projectId: s.project.id, service: 'api', message: 'needle b', time: hoursAgo(1) });
    await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: s.orgId,
        sigma_rule_id: rule.id,
        conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['noisy'] }]),
      })
      .execute();

    const res = await preview(s, rule.id, { range: '24h' });
    expect(res.json()).toMatchObject({ matches: 1, suppressed: 1 });
  });

  it('other organization rule returns 404 and a non member 403', async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await createTestSigmaRule({ organizationId: other.orgId, ...NEEDLE_RULE });
    expect((await preview(s, foreign.id, { range: '24h' })).statusCode).toBe(404);

    const mine = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${mine.id}/preview`,
      headers: auth(s.token),
      payload: { organizationId: other.orgId, range: '24h' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a second concurrent preview returns 429 and the slot is released afterwards', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const emptyResult = {
      range: '24h', from: '', to: '', scanned: 0, matches: 0, suppressed: 0,
      truncated: false, truncatedReason: null, samples: [],
    };
    hoisted.previewRule.mockImplementationOnce(async () => {
      await gate;
      return emptyResult;
    });

    const callsBefore = hoisted.previewRule.mock.calls.length;
    const first = preview(s, rule.id, { range: '24h' });
    // wait until the first request holds the slot
    for (let i = 0; i < 100 && hoisted.previewRule.mock.calls.length === callsBefore; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = await preview(s, rule.id, { range: '24h' });
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe('A preview is already running for this organization');

    // another organization is not blocked by it
    const other = await setup();
    const otherRule = await createTestSigmaRule({ organizationId: other.orgId, ...NEEDLE_RULE });
    expect((await preview(other, otherRule.id, { range: '24h' })).statusCode).toBe(200);

    release();
    expect((await first).statusCode).toBe(200);
    expect((await preview(s, rule.id, { range: '24h' })).statusCode).toBe(200);
  });

  it('releases the slot when the preview throws', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    hoisted.previewRule.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    expect((await preview(s, rule.id, { range: '24h' })).statusCode).toBe(500);
    expect((await preview(s, rule.id, { range: '24h' })).statusCode).toBe(200);
  });

  it('unsaved yaml preview uses the posted yaml', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    await createTestLog({ projectId: s.project.id, message: 'needle here', time: hoursAgo(1) });
    await createTestLog({ projectId: s.project.id, message: 'haystack here', time: hoursAgo(1) });

    const yaml = [
      'title: Draft',
      'logsource: {}',
      'detection:',
      '  selection:',
      "    message|contains: 'haystack'",
      '  condition: selection',
      '',
    ].join('\n');
    const res = await preview(s, rule.id, { range: '24h', yaml });
    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toBe(1);
    expect(res.json().samples[0].message).toBe('haystack here');

    const bad = await preview(s, rule.id, { range: '24h', yaml: 'title: nothing' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('Invalid rule');

    const big = await preview(s, rule.id, { range: '24h', yaml: `title: ${'a'.repeat(65540)}` });
    expect(big.statusCode).toBe(400);
  });

  it('a rule project scope limits scanned logs to that project', async () => {
    const s = await setup();
    const second = await createTestProject({ organizationId: s.orgId });
    const scoped = await createTestSigmaRule({ organizationId: s.orgId, projectId: s.project.id, ...NEEDLE_RULE });
    const orgWide = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    await createTestLog({ projectId: s.project.id, message: 'needle one', time: hoursAgo(1) });
    await createTestLog({ projectId: second.id, message: 'needle two', time: hoursAgo(1) });

    expect((await preview(s, scoped.id, { range: '24h' })).json()).toMatchObject({ scanned: 1, matches: 1 });
    expect((await preview(s, orgWide.id, { range: '24h' })).json()).toMatchObject({ scanned: 2, matches: 2 });
  });

  it('skips soft deleted projects', async () => {
    const s = await setup();
    const gone = await createTestProject({ organizationId: s.orgId });
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', gone.id).execute();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    await createTestLog({ projectId: gone.id, message: 'needle gone', time: hoursAgo(1) });
    expect((await preview(s, rule.id, { range: '24h' })).json()).toMatchObject({ scanned: 0, matches: 0 });
  });

  it('an organization without projects returns zeros', async () => {
    const s = await setup();
    await db.deleteFrom('projects').where('organization_id', '=', s.orgId).execute();
    const rule = await createTestSigmaRule({ organizationId: s.orgId, ...NEEDLE_RULE });
    expect((await preview(s, rule.id, { range: '7d' })).json()).toMatchObject({ scanned: 0, matches: 0, truncated: false });
  });
});
