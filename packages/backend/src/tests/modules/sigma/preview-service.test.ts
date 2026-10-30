import { describe, it, expect } from 'vitest';
import type { QueryParams, QueryResult, StoredLogRecord } from '@logtide/reservoir';
import {
  previewRule,
  PREVIEW_MAX_LOGS,
  PREVIEW_PAGE_SIZE,
  PREVIEW_DEADLINE_CHECK_EVERY,
  PREVIEW_TIMEOUT_MS,
  PREVIEW_MAX_SAMPLES,
} from '../../../modules/sigma/preview-service.js';
import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';
import type { ParsedSigmaRule } from '../../../modules/sigma/types.js';

const rule: ParsedSigmaRule = {
  id: 'rule-1',
  title: 'Needle',
  level: 'high',
  status: 'stable',
  logsource: {},
  detection: { selection: { 'message|contains': 'needle' }, condition: 'selection' },
} as ParsedSigmaRule;

function record(i: number, message: string, overrides: Partial<StoredLogRecord> = {}): StoredLogRecord {
  return {
    id: `log-${i}`,
    time: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - i * 1000),
    projectId: 'p1',
    service: 'api',
    level: 'error',
    message,
    ...overrides,
  };
}

/** A fake paged reservoir over `total` generated logs. */
function fakeQuery(total: number, messageFor: (i: number) => string, calls: QueryParams[] = []) {
  return async (params: QueryParams): Promise<QueryResult<StoredLogRecord>> => {
    calls.push(params);
    const start = params.cursor ? Number(params.cursor) : 0;
    const limit = params.limit ?? PREVIEW_PAGE_SIZE;
    const end = Math.min(start + limit, total);
    const logs: StoredLogRecord[] = [];
    for (let i = start; i < end; i++) logs.push(record(i, messageFor(i)));
    const hasMore = end < total;
    return { logs, total, hasMore, limit, offset: 0, nextCursor: hasMore ? String(end) : undefined };
  };
}

const base = { organizationId: 'org', rule, projectIds: ['p1'], range: '24h' as const, exceptions: [] };

describe('previewRule', () => {
  it('scans pages until hasMore is false', async () => {
    const calls: QueryParams[] = [];
    const out = await previewRule(base, { query: fakeQuery(2500, (i) => (i % 500 === 0 ? 'a needle here' : 'noise'), calls) });
    expect(out.scanned).toBe(2500);
    expect(out.matches).toBe(5);
    expect(out.truncated).toBe(false);
    expect(out.truncatedReason).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ projectId: ['p1'], sortOrder: 'desc', limit: PREVIEW_PAGE_SIZE });
    expect(calls[1].cursor).toBe('1000');
  });

  it('exactly 50000 logs scanned is not truncated', async () => {
    const out = await previewRule(base, { query: fakeQuery(PREVIEW_MAX_LOGS, () => 'noise') });
    expect(out.scanned).toBe(PREVIEW_MAX_LOGS);
    expect(out.truncated).toBe(false);
    expect(out.truncatedReason).toBeNull();
  });

  it('50001 available is truncated with reason max_logs and scanned 50000', async () => {
    const out = await previewRule(base, { query: fakeQuery(PREVIEW_MAX_LOGS + 1, () => 'noise') });
    expect(out.scanned).toBe(PREVIEW_MAX_LOGS);
    expect(out.truncated).toBe(true);
    expect(out.truncatedReason).toBe('max_logs');
  });

  it('timeout mid scan returns truncated timeout with partial counts', async () => {
    let t = Date.UTC(2026, 0, 1);
    const query = fakeQuery(10_000, (i) => (i < 2000 ? 'needle' : 'noise'));
    const out = await previewRule(base, {
      now: () => new Date(t),
      query: async (p) => {
        const res = await query(p);
        t += PREVIEW_TIMEOUT_MS / 2 + 1; // each page takes just over half the budget
        return res;
      },
    });
    expect(out.truncated).toBe(true);
    expect(out.truncatedReason).toBe('timeout');
    expect(out.scanned).toBe(PREVIEW_PAGE_SIZE);
    expect(out.matches).toBe(PREVIEW_PAGE_SIZE);
  });

  it('a finished scan is not reported as timeout even when the clock ran out', async () => {
    let t = Date.UTC(2026, 0, 1);
    const query = fakeQuery(PREVIEW_DEADLINE_CHECK_EVERY - 1, () => 'noise');
    const out = await previewRule(base, {
      now: () => new Date(t),
      query: async (p) => {
        t += PREVIEW_TIMEOUT_MS * 2;
        return query(p);
      },
    });
    expect(out.truncated).toBe(false);
  });

  it('the deadline is enforced inside a page, not only between pages', async () => {
    let t = Date.UTC(2026, 0, 1);
    const out = await previewRule(base, {
      now: () => new Date((t += PREVIEW_TIMEOUT_MS / 4)),
      query: fakeQuery(PREVIEW_PAGE_SIZE, () => 'noise'),
    });
    expect(out.truncated).toBe(true);
    expect(out.truncatedReason).toBe('timeout');
    expect(out.scanned).toBeLessThan(PREVIEW_PAGE_SIZE);
  });

  it('suppressed matches are counted separately and excluded from samples', async () => {
    const query = async (): Promise<QueryResult<StoredLogRecord>> => ({
      logs: [
        record(0, 'needle one', { service: 'noisy' }),
        record(1, 'needle two', { service: 'api' }),
        record(2, 'needle three', { service: 'noisy' }),
      ],
      total: 3,
      hasMore: false,
      limit: 1000,
      offset: 0,
    });
    const out = await previewRule(
      {
        ...base,
        exceptions: [
          {
            id: 'e1',
            ruleId: 'rule-1',
            conditions: [{ field: 'service', operator: 'equals', values: ['noisy'] }],
            expiresAt: null,
          },
        ],
      },
      { query }
    );
    expect(out.matches).toBe(1);
    expect(out.suppressed).toBe(2);
    expect(out.samples.map((s) => s.message)).toEqual(['needle two']);
  });

  it('expired exceptions do not suppress', async () => {
    const query = async (): Promise<QueryResult<StoredLogRecord>> => ({
      logs: [record(0, 'needle', { service: 'noisy' })],
      total: 1,
      hasMore: false,
      limit: 1000,
      offset: 0,
    });
    const out = await previewRule(
      {
        ...base,
        exceptions: [
          {
            id: 'e1',
            ruleId: 'rule-1',
            conditions: [{ field: 'service', operator: 'equals', values: ['noisy'] }],
            expiresAt: new Date(Date.now() - 60_000),
          },
        ],
      },
      { query }
    );
    expect(out.matches).toBe(1);
    expect(out.suppressed).toBe(0);
  });

  it('returns at most 20 samples with the message cut to 500', async () => {
    const long = `needle ${'x'.repeat(900)}`;
    const out = await previewRule(base, { query: fakeQuery(60, () => long) });
    expect(out.matches).toBe(60);
    expect(out.samples).toHaveLength(PREVIEW_MAX_SAMPLES);
    expect(out.samples[0].message).toHaveLength(500);
    expect(out.samples[0]).toMatchObject({ id: 'log-0', projectId: 'p1', service: 'api', level: 'error' });
  });

  it('zero projects returns zeros without querying', async () => {
    let called = false;
    const out = await previewRule(
      { ...base, projectIds: [] },
      {
        query: async () => {
          called = true;
          throw new Error('should not be called');
        },
      }
    );
    expect(called).toBe(false);
    expect(out).toMatchObject({ scanned: 0, matches: 0, suppressed: 0, truncated: false, samples: [] });
  });

  it('zero logs returns zeros', async () => {
    const out = await previewRule(base, { query: fakeQuery(0, () => 'x') });
    expect(out).toMatchObject({ scanned: 0, matches: 0, truncated: false });
  });

  it('range bounds follow the injected clock', async () => {
    const t = new Date('2026-02-10T12:00:00.000Z');
    const calls: QueryParams[] = [];
    const out = await previewRule(
      { ...base, range: '7d' },
      { now: () => t, query: fakeQuery(1, () => 'x', calls) }
    );
    expect(out.to).toBe(t.toISOString());
    expect(out.from).toBe(new Date(t.getTime() - 7 * 86_400_000).toISOString());
    expect(calls[0].from).toEqual(new Date(out.from));
  });

  it('matcher parity: a log that detection would match is a preview match', async () => {
    const logs = [record(0, 'needle'), record(1, 'noise'), record(2, 'NEEDLE upper')];
    const query = async (): Promise<QueryResult<StoredLogRecord>> => ({
      logs,
      total: 3,
      hasMore: false,
      limit: 1000,
      offset: 0,
    });
    const out = await previewRule(base, { query });
    const expected = logs.filter((l) => SigmaDetectionEngine.matchRule(rule, SigmaDetectionEngine.toLogEntry(l)) !== null);
    expect(out.matches).toBe(expected.length);
    expect(out.samples.map((s) => s.id)).toEqual(expected.map((l) => l.id));
  });
});
