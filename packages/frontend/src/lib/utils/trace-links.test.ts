import { describe, it, expect } from 'vitest';
import {
  traceDetailUrl,
  traceLogsUrl,
  spanLogsUrl,
  serviceLogsUrl,
  serviceErrorsUrl,
  tracesForServiceUrl,
  errorGroupUrl,
} from './trace-links';

const trace = {
  trace_id: 'abc123',
  start_time: '2026-10-22T10:00:00.000Z',
  end_time: '2026-10-22T10:00:02.000Z',
};

const parse = (href: string) => new URL(href, 'http://localhost');

describe('trace links', () => {
  it('traceLogsUrl carries q=trace:<id>, project and a window of start minus 5 min to end plus 5 min', () => {
    const u = parse(traceLogsUrl(trace, 'p1'));
    expect(u.pathname).toBe('/dashboard/logs');
    expect(u.searchParams.get('q')).toBe('trace:abc123');
    expect(u.searchParams.get('project')).toBe('p1');
    expect(u.searchParams.get('from')).toBe('2026-10-22T09:55:00.000Z');
    expect(u.searchParams.get('to')).toBe('2026-10-22T10:05:02.000Z');
  });

  it('spanLogsUrl uses span: and the same window', () => {
    const u = parse(spanLogsUrl({ span_id: 's9' }, trace, 'p1'));
    expect(u.searchParams.get('q')).toBe('span:s9');
    expect(u.searchParams.get('from')).toBe('2026-10-22T09:55:00.000Z');
    expect(u.searchParams.get('to')).toBe('2026-10-22T10:05:02.000Z');
  });

  it('traceLogsUrl omits the window when end is before start', () => {
    const u = parse(
      traceLogsUrl({ ...trace, start_time: '2026-10-22T10:00:05.000Z', end_time: '2026-10-22T10:00:00.000Z' }, 'p1')
    );
    expect(u.searchParams.has('from')).toBe(false);
    expect(u.searchParams.has('to')).toBe(false);
    expect(u.searchParams.get('q')).toBe('trace:abc123');
  });

  it('traceLogsUrl omits the window for an unparsable time', () => {
    const u = parse(traceLogsUrl({ ...trace, end_time: 'nope' }, 'p1'));
    expect(u.searchParams.has('from')).toBe(false);
  });

  it('serviceLogsUrl quotes a service name with spaces', () => {
    const u = parse(
      serviceLogsUrl('Checkout API', 'p1', {
        from: new Date('2026-10-22T10:00:00.000Z'),
        to: new Date('2026-10-22T11:00:00.000Z'),
      })
    );
    expect(u.searchParams.get('q')).toBe('service:"Checkout API"');
    expect(u.searchParams.get('project')).toBe('p1');
  });

  it('serviceErrorsUrl carries project, service and range', () => {
    const u = parse(serviceErrorsUrl('api', 'p1', { kind: 'preset', preset: '7d' }));
    expect(u.pathname).toBe('/dashboard/errors');
    expect(u.searchParams.get('project')).toBe('p1');
    expect(u.searchParams.get('service')).toBe('api');
    expect(u.searchParams.get('range')).toBe('7d');

    const custom = parse(
      serviceErrorsUrl('api', 'p1', {
        from: new Date('2026-10-22T10:00:00.000Z'),
        to: new Date('2026-10-22T11:00:00.000Z'),
      })
    );
    expect(custom.searchParams.get('from')).toBe('2026-10-22T10:00:00.000Z');
    expect(custom.searchParams.get('to')).toBe('2026-10-22T11:00:00.000Z');
    expect(custom.searchParams.has('range')).toBe(false);
  });

  it('logs links carry ISO from and to', () => {
    const links = [
      traceLogsUrl(trace, 'p1'),
      spanLogsUrl({ span_id: 's1' }, trace, 'p1'),
      serviceLogsUrl('api', 'p1', { kind: 'preset', preset: '24h' }),
      serviceLogsUrl('api', 'p1', {
        kind: 'custom',
        from: '2026-10-20T00:00:00.000Z',
        to: '2026-10-21T00:00:00.000Z',
      }),
    ];
    for (const href of links) {
      const u = parse(href);
      expect(u.pathname).toBe('/dashboard/logs');
      for (const key of ['from', 'to']) {
        const raw = u.searchParams.get(key)!;
        expect(new Date(raw).toISOString()).toBe(raw);
      }
    }
  });

  it('traceDetailUrl omits project when null', () => {
    expect(traceDetailUrl('abc', null)).toBe('/dashboard/traces/abc');
    expect(traceDetailUrl('abc')).toBe('/dashboard/traces/abc');
    expect(traceDetailUrl('abc', 'p1')).toBe('/dashboard/traces/abc?project=p1');
  });

  it('traceDetailUrl encodes the trace id', () => {
    expect(traceDetailUrl('a/b c', 'p1')).toBe('/dashboard/traces/a%2Fb%20c?project=p1');
  });

  it('tracesForServiceUrl and errorGroupUrl carry the project', () => {
    const t = parse(tracesForServiceUrl('Checkout API', 'p1', { kind: 'preset', preset: '1h' }));
    expect(t.pathname).toBe('/dashboard/traces');
    expect(t.searchParams.get('service')).toBe('Checkout API');
    expect(t.searchParams.get('range')).toBe('1h');
    expect(errorGroupUrl('g1', 'p1')).toBe('/dashboard/errors/g1?project=p1');
  });
});
