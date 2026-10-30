import { describe, it, expect } from 'vitest';
import { parseLogQuery, type LogSearchQuery } from '@logtide/shared';
import {
  createLiveTailFilter,
  toMatchableLog,
  type LiveTailLog,
} from '../../../modules/streaming/live-tail-filter.js';

function query(input: string): LogSearchQuery {
  const parsed = parseLogQuery(input);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.query;
}

const log = (overrides: Partial<LiveTailLog> = {}): LiveTailLog => ({
  service: 'api',
  level: 'info',
  message: 'user login timeout',
  metadata: { region: 'eu', hostname: 'web-1' },
  ...overrides,
});

describe('createLiveTailFilter', () => {
  it('passes everything without options', () => {
    const filter = createLiveTailFilter({});
    expect(filter(log())).toBe(true);
    expect(filter(log({ metadata: null }))).toBe(true);
    expect(filter(log({ service: 'worker', level: 'debug', message: '' }))).toBe(true);
  });

  it('applies service, level and hostname lists', () => {
    const filter = createLiveTailFilter({ services: ['api', 'web'], levels: ['info', 'error'], hostnames: ['web-1'] });
    expect(filter(log())).toBe(true);
    expect(filter(log({ service: 'worker' }))).toBe(false);
    expect(filter(log({ level: 'debug' }))).toBe(false);
    expect(filter(log({ metadata: { hostname: 'web-2' } }))).toBe(false);
    // a missing host fails a hostname list, as before
    expect(filter(log({ metadata: { region: 'eu' } }))).toBe(false);
    expect(filter(log({ metadata: null }))).toBe(false);
  });

  it('treats empty lists as no filter', () => {
    const filter = createLiveTailFilter({ services: [], levels: [], hostnames: [] });
    expect(filter(log({ metadata: null }))).toBe(true);
  });

  it('applies the query', () => {
    const filter = createLiveTailFilter({ query: query('timeout -debug region:eu') });
    expect(filter(log())).toBe(true);
    expect(filter(log({ metadata: { region: 'us' } }))).toBe(false);
    expect(filter(log({ message: 'debug login timeout' }))).toBe(false);
    expect(filter(log({ message: 'login ok' }))).toBe(false);
  });

  it('reads host clauses from metadata.hostname', () => {
    const filter = createLiveTailFilter({ query: query('host:web-1') });
    expect(filter(log())).toBe(true);
    expect(filter(log({ metadata: { hostname: 'web-2' } }))).toBe(false);
    expect(filter(log({ metadata: {} }))).toBe(false);

    const negated = createLiveTailFilter({ query: query('-host:web-1') });
    expect(negated(log())).toBe(false);
    expect(negated(log({ metadata: { hostname: 'web-2' } }))).toBe(true);
    // negated clauses match logs without the key
    expect(negated(log({ metadata: {} }))).toBe(true);
  });

  it('reads trace, session and span clauses from the log fields', () => {
    const traced = log({ traceId: 't-1', sessionId: 's-1', spanId: '00f067aa0ba902b7' });
    expect(createLiveTailFilter({ query: query('trace:t-1') })(traced)).toBe(true);
    expect(createLiveTailFilter({ query: query('session:s-1') })(traced)).toBe(true);
    expect(createLiveTailFilter({ query: query('span:00f067aa0ba902b7') })(traced)).toBe(true);
    expect(createLiveTailFilter({ query: query('trace:t-2') })(traced)).toBe(false);
    expect(createLiveTailFilter({ query: query('trace:t-1') })(log({ traceId: null }))).toBe(false);
  });

  it('combines lists and query with AND', () => {
    const filter = createLiveTailFilter({ services: ['api'], query: query('region:eu') });
    expect(filter(log())).toBe(true);
    expect(filter(log({ service: 'worker' }))).toBe(false);
    expect(filter(log({ metadata: { region: 'us', hostname: 'web-1' } }))).toBe(false);
  });

  it('ignores a non-string metadata hostname', () => {
    const listFilter = createLiveTailFilter({ hostnames: ['42'] });
    expect(listFilter(log({ metadata: { hostname: 42 } }))).toBe(false);
    const clauseFilter = createLiveTailFilter({ query: query('host:42') });
    expect(clauseFilter(log({ metadata: { hostname: 42 } }))).toBe(false);
    expect(createLiveTailFilter({ query: query('-host:42') })(log({ metadata: { hostname: 42 } }))).toBe(true);
  });
});

describe('toMatchableLog', () => {
  it('takes the host from metadata.hostname when the log has no top-level host', () => {
    expect(toMatchableLog(log()).hostname).toBe('web-1');
    expect(toMatchableLog(log({ hostname: 'top' })).hostname).toBe('top');
    expect(toMatchableLog(log({ metadata: { hostname: 7 } })).hostname ?? null).toBeNull();
    expect(toMatchableLog(log({ metadata: undefined })).hostname ?? null).toBeNull();
  });

  it('keeps the matchable fields', () => {
    const matchable = toMatchableLog(log({ traceId: 't', sessionId: 's', spanId: 'p' }));
    expect(matchable).toMatchObject({
      message: 'user login timeout',
      level: 'info',
      service: 'api',
      traceId: 't',
      sessionId: 's',
      spanId: 'p',
      metadata: { region: 'eu', hostname: 'web-1' },
    });
  });
});
