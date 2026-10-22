import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../database/connection.js', () => ({ db: {} }));

import {
  isExceptionActive,
  matchesException,
  partitionMatches,
  type ActiveException,
} from '../../../modules/sigma/exceptions.js';
import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';
import type { ExceptionCondition } from '@logtide/shared';

const flat = (log: Record<string, any>) => SigmaDetectionEngine.flatten({ message: 'm', ...log });
const cond = (
  field: string,
  operator: ExceptionCondition['operator'],
  ...values: string[]
): ExceptionCondition => ({ field, operator, values });

describe('matchesException', () => {
  it('equals is case-insensitive', () => {
    expect(matchesException(flat({ service: 'API' }), { conditions: [cond('service', 'equals', 'api')] })).toBe(true);
    expect(matchesException(flat({ service: 'api2' }), { conditions: [cond('service', 'equals', 'api')] })).toBe(false);
  });

  it('contains matches substring', () => {
    expect(matchesException(flat({ message: 'Disk full on node-3' }), { conditions: [cond('message', 'contains', 'full on')] })).toBe(true);
    expect(matchesException(flat({ message: 'ok' }), { conditions: [cond('message', 'contains', 'full')] })).toBe(false);
  });

  it('in matches any value', () => {
    const e = { conditions: [cond('level', 'in', 'warn', 'error')] };
    expect(matchesException(flat({ level: 'error' }), e)).toBe(true);
    expect(matchesException(flat({ level: 'info' }), e)).toBe(false);
  });

  it('all conditions must match', () => {
    const e = { conditions: [cond('service', 'equals', 'api'), cond('level', 'equals', 'error')] };
    expect(matchesException(flat({ service: 'api', level: 'error' }), e)).toBe(true);
    expect(matchesException(flat({ service: 'api', level: 'info' }), e)).toBe(false);
  });

  it('absent field never matches', () => {
    expect(matchesException(flat({ service: 'api' }), { conditions: [cond('hostname', 'equals', 'a')] })).toBe(false);
    expect(matchesException(flat({ hostname: null }), { conditions: [cond('hostname', 'contains', 'a')] })).toBe(false);
  });

  it('metadata dot path matches via flattened keys', () => {
    const f = flat({ metadata: { user: { name: 'Bob' }, ip: '10.0.0.1' } });
    expect(matchesException(f, { conditions: [cond('metadata.user.name', 'equals', 'bob')] })).toBe(true);
    expect(matchesException(f, { conditions: [cond('ip', 'equals', '10.0.0.1')] })).toBe(true);
  });

  it('array field matches any element', () => {
    const f = flat({ metadata: { tags: ['a', 'Prod'] } });
    expect(matchesException(f, { conditions: [cond('metadata.tags', 'equals', 'prod')] })).toBe(true);
    expect(matchesException(f, { conditions: [cond('metadata.tags', 'equals', 'dev')] })).toBe(false);
  });

  it('an exception without conditions never matches', () => {
    expect(matchesException(flat({ service: 'api' }), { conditions: [] })).toBe(false);
  });
});

describe('isExceptionActive', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('expired exception is inactive', () => {
    expect(isExceptionActive({ expiresAt: new Date('2026-10-21T11:59:59Z') }, now)).toBe(false);
    expect(isExceptionActive({ expiresAt: now }, now)).toBe(false);
  });
  it('exception with null expiry is active', () => {
    expect(isExceptionActive({ expiresAt: null }, now)).toBe(true);
    expect(isExceptionActive({ expiresAt: new Date('2026-10-21T12:00:01Z') }, now)).toBe(true);
  });
});

describe('partitionMatches', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const logs = [
    { message: 'a', service: 'api' },
    { message: 'b', service: 'web' },
    { message: 'c', service: 'api' },
  ];
  const matches = [
    { logIndex: 0, sigmaRuleId: 'r1' },
    { logIndex: 1, sigmaRuleId: 'r1' },
    { logIndex: 2, sigmaRuleId: 'r1' },
    { logIndex: 0, sigmaRuleId: 'r2' },
  ];

  it('counts suppressed per exception and keeps unmatched', () => {
    const ex: ActiveException = { id: 'e1', ruleId: 'r1', conditions: [cond('service', 'equals', 'api')], expiresAt: null };
    const { kept, suppressed } = partitionMatches(matches, logs, [ex], now);
    expect(kept).toEqual([
      { logIndex: 1, sigmaRuleId: 'r1' },
      { logIndex: 0, sigmaRuleId: 'r2' },
    ]);
    expect(suppressed.get('e1')).toBe(2);
  });

  it('accepts a map keyed by rule id', () => {
    const ex: ActiveException = { id: 'e1', ruleId: 'r2', conditions: [cond('service', 'equals', 'api')], expiresAt: null };
    const { kept, suppressed } = partitionMatches(matches, logs, new Map([['r2', [ex]]]), now);
    expect(kept).toHaveLength(3);
    expect(suppressed.get('e1')).toBe(1);
  });

  it('expired exception does not suppress', () => {
    const ex: ActiveException = { id: 'e1', ruleId: 'r1', conditions: [cond('service', 'equals', 'api')], expiresAt: new Date('2026-10-21T11:00:00Z') };
    const { kept, suppressed } = partitionMatches(matches, logs, [ex], now);
    expect(kept).toHaveLength(4);
    expect(suppressed.size).toBe(0);
  });

  it('no exceptions keeps everything', () => {
    const { kept } = partitionMatches(matches, logs, [], now);
    expect(kept).toEqual(matches);
  });
});
