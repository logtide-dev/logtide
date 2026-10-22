import { describe, it, expect } from 'vitest';
import { parseLogQuery } from '@logtide/shared';
import type { MetadataFilter } from '@logtide/shared';
import {
  buildMatchedLogsUrl,
  composeAlertQuery,
  countTriggers24h,
  deriveRuleState,
  parseAlertPrefill,
  stripPrefillParams,
  summarizeRule,
  validateAlertQuery,
} from './alert-model';

const NOW = new Date('2026-10-22T12:00:00.000Z');

function filter(f: Partial<MetadataFilter> & Pick<MetadataFilter, 'key' | 'op'>): MetadataFilter {
  return { include_missing: false, ...f } as MetadataFilter;
}

describe('deriveRuleState', () => {
  it('disabled beats snoozed', () => {
    expect(
      deriveRuleState({ enabled: false, state: 'firing', snoozedUntil: '2026-10-23T00:00:00Z' }, NOW)
    ).toBe('disabled');
  });

  it('snoozed beats firing', () => {
    expect(
      deriveRuleState({ enabled: true, state: 'firing', snoozedUntil: '2026-10-23T00:00:00Z' }, NOW)
    ).toBe('snoozed');
  });

  it('snoozedUntil in the past is not snoozed', () => {
    expect(
      deriveRuleState({ enabled: true, state: 'firing', snoozedUntil: '2026-10-21T00:00:00Z' }, NOW)
    ).toBe('firing');
  });

  it('payload without lifecycle fields is ok', () => {
    expect(deriveRuleState({ enabled: true }, NOW)).toBe('ok');
  });
});

describe('countTriggers24h', () => {
  const history = [
    { ruleId: 'a', triggeredAt: '2026-10-22T10:00:00Z' },
    { ruleId: 'a', triggeredAt: '2026-10-22T01:00:00Z' },
    { ruleId: 'a', triggeredAt: '2026-10-20T01:00:00Z' },
    { ruleId: 'b', triggeredAt: '2026-10-22T10:00:00Z' },
  ];

  it('prefers the server field', () => {
    expect(countTriggers24h({ id: 'a', triggers24h: 9 }, history, NOW)).toBe(9);
  });

  it('falls back to history within 24 h and ignores other rules', () => {
    expect(countTriggers24h({ id: 'a' }, history, NOW)).toBe(2);
  });
});

describe('summarizeRule', () => {
  it('describes a threshold rule', () => {
    expect(
      summarizeRule({
        alertType: 'threshold',
        threshold: 10,
        timeWindow: 5,
        deviationMultiplier: null,
        baselineType: null,
      })
    ).toBe('10 logs in 5 minutes');
  });

  it('never prints a threshold for rate_of_change', () => {
    const text = summarizeRule({
      alertType: 'rate_of_change',
      threshold: 777,
      timeWindow: 5,
      deviationMultiplier: 3,
      baselineType: 'rolling_7d_avg',
    });
    expect(text).toBe('3x above 7-day rolling avg');
    expect(text).not.toContain('777');
  });
});

describe('composeAlertQuery', () => {
  it('builds levels, service and every metadata operator', () => {
    const { q, skipped } = composeAlertQuery({
      levels: ['error', 'critical'],
      service: 'api',
      metadataFilters: [
        filter({ key: 'env', op: 'equals', value: 'prod' }),
        filter({ key: 'env', op: 'not_equals', value: 'dev' }),
        filter({ key: 'region', op: 'in', values: ['eu', 'us'] }),
        filter({ key: 'region', op: 'not_in', values: ['ap', 'sa'] }),
        filter({ key: 'user', op: 'exists' }),
        filter({ key: 'debug', op: 'not_exists' }),
        filter({ key: 'path', op: 'contains', value: 'health' }),
      ],
    });
    expect(skipped).toEqual([]);
    expect(q).toContain('level:(error OR critical)');
    expect(q).toContain('service:api');
    expect(q).toContain('env:prod');
    expect(q).toContain('-env:dev');
    expect(q).toContain('region:(eu OR us)');
    expect(q).toContain('-region:(ap OR sa)');
    expect(q).toContain('user:*');
    expect(q).toContain('-debug:*');
    expect(q).toContain('path:*health*');
  });

  it('uses a single level without parentheses and keeps the free text first', () => {
    const { q } = composeAlertQuery({ query: 'timeout', levels: ['error'] });
    expect(q).toBe('timeout level:error');
  });

  it('quotes values with spaces and parentheses', () => {
    const { q } = composeAlertQuery({
      service: 'my service',
      metadataFilters: [filter({ key: 'msg', op: 'equals', value: 'a (b) c' })],
    });
    expect(q).toContain('service:"my service"');
    expect(q).toContain('msg:"a (b) c"');
  });

  it('output always parses ok with parseLogQuery', () => {
    const inputs = [
      { service: 'api' },
      { service: 'a"b' },
      { levels: ['warn', 'error'], service: 'x y' },
      { metadataFilters: [filter({ key: 'a.b', op: 'equals', value: 'say "hi"' })] },
      { metadataFilters: [filter({ key: 'k', op: 'in', values: ['a b', '(c)', 'd:e'] })] },
      { metadataFilters: [filter({ key: 'a key', op: 'equals', value: 'v' })] },
      { metadataFilters: [filter({ key: 'k', op: 'contains', value: 'two words' })] },
      { query: 'error timeout', metadataFilters: [filter({ key: 'k', op: 'not_exists' })] },
    ];
    for (const input of inputs) {
      const { q } = composeAlertQuery(input);
      expect(parseLogQuery(q).ok, q).toBe(true);
    }
  });

  it('reports a clause it cannot express in skipped', () => {
    const { q, skipped } = composeAlertQuery({
      metadataFilters: [
        filter({ key: 'a key', op: 'equals', value: 'v' }),
        filter({ key: 'ok', op: 'equals', value: 'v' }),
      ],
    });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('a key');
    expect(q).toBe('ok:v');
  });
});

describe('validateAlertQuery', () => {
  it('accepts a valid query', () => {
    expect(validateAlertQuery('level:error timeout')).toEqual({ ok: true });
  });

  it('returns position for OR across different keys', () => {
    const result = validateAlertQuery('a:1 OR b:2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.position).toBe(4);
    }
  });
});

describe('buildMatchedLogsUrl', () => {
  it('for an org-wide rule has no project param', () => {
    const url = buildMatchedLogsUrl({
      projectId: null,
      levels: ['error'],
      triggeredAt: '2026-10-22T12:00:00.000Z',
      windowMinutes: 5,
    });
    const params = new URL(url, 'http://x').searchParams;
    expect(params.has('project')).toBe(false);
    expect(params.get('q')).toBe('level:error');
  });

  it('uses from = triggeredAt - window and to = triggeredAt as ISO', () => {
    const url = buildMatchedLogsUrl({
      projectId: 'p1',
      triggeredAt: '2026-10-22T12:00:00.000Z',
      windowMinutes: 15,
    });
    const params = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/dashboard/logs?')).toBe(true);
    expect(params.get('project')).toBe('p1');
    expect(params.get('from')).toBe('2026-10-22T11:45:00.000Z');
    expect(params.get('to')).toBe('2026-10-22T12:00:00.000Z');
  });

  it('encodes a service with special characters and the q re-parses', () => {
    const url = buildMatchedLogsUrl({
      projectId: 'p1',
      service: 'a&b "c"',
      triggeredAt: '2026-10-22T12:00:00.000Z',
      windowMinutes: 5,
    });
    const q = new URL(url, 'http://x').searchParams.get('q') as string;
    expect(parseLogQuery(q).ok).toBe(true);
    expect(q).toContain('a&b');
  });
});

describe('parseAlertPrefill', () => {
  it('reads create=1, projectId, query, levels, service, name', () => {
    const r = parseAlertPrefill(
      new URL(
        'http://x/dashboard/alerts?create=1&projectId=p1&query=timeout&levels=error,critical&service=api&name=My%20alert'
      )
    );
    expect(r.open).toBe(true);
    expect(r.prefill).toEqual({
      projectId: 'p1',
      query: 'timeout',
      levels: ['error', 'critical'],
      service: 'api',
      name: 'My alert',
    });
  });

  it('still honours new=1', () => {
    expect(parseAlertPrefill(new URL('http://x/dashboard/alerts?new=1')).open).toBe(true);
  });

  it('drops invalid levels', () => {
    const r = parseAlertPrefill(new URL('http://x/a?create=1&levels=error,fatal,INFO,,bogus'));
    expect(r.prefill?.levels).toEqual(['error', 'info']);
  });

  it('reads edit=<ruleId>', () => {
    const r = parseAlertPrefill(new URL('http://x/a?edit=r1'));
    expect(r).toEqual({ open: false, editRuleId: 'r1' });
  });

  it('does nothing without params', () => {
    expect(parseAlertPrefill(new URL('http://x/a'))).toEqual({ open: false });
  });
});

describe('stripPrefillParams', () => {
  it('keeps unrelated params', () => {
    const out = stripPrefillParams(
      new URL('http://x/dashboard/alerts?create=1&projectId=p&query=q&tab=history&project=p2')
    );
    expect(out).toBe('/dashboard/alerts?tab=history&project=p2');
  });

  it('returns the bare path when nothing is left', () => {
    expect(stripPrefillParams(new URL('http://x/dashboard/alerts?new=1&edit=r'))).toBe(
      '/dashboard/alerts'
    );
  });
});
