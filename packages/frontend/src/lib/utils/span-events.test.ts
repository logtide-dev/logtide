import { describe, it, expect } from 'vitest';
import { extractExceptions, matchErrorGroup } from './span-events';
import type { SpanRecord, TraceErrorGroup } from '$lib/api/traces';

function span(over: Partial<SpanRecord> = {}): SpanRecord {
  return {
    span_id: 's1',
    trace_id: 't1',
    parent_span_id: null,
    service_name: 'api',
    operation_name: 'GET /a',
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1000,
    kind: 'SERVER',
    status_code: 'OK',
    status_message: null,
    attributes: null,
    events: null,
    links: null,
    resource_attributes: null,
    ...over,
  };
}

function group(over: Partial<TraceErrorGroup> = {}): TraceErrorGroup {
  return {
    errorGroupId: 'g1',
    status: 'open',
    exceptionType: 'TypeError',
    exceptionMessage: null,
    projectId: 'p1',
    logId: 'l1',
    spanId: null,
    occurredAt: '2026-10-22T10:00:00.000Z',
    ...over,
  };
}

describe('extractExceptions', () => {
  it('extracts type, message and stacktrace from an exception event', () => {
    const out = extractExceptions(
      span({
        events: [
          {
            name: 'exception',
            time: '2026-10-22T10:00:00.500Z',
            attributes: {
              'exception.type': 'TypeError',
              'exception.message': 'x is undefined',
              'exception.stacktrace': 'at foo (a.js:1)',
            },
          },
        ],
      })
    );
    expect(out).toEqual([
      {
        time: '2026-10-22T10:00:00.500Z',
        type: 'TypeError',
        message: 'x is undefined',
        stacktrace: 'at foo (a.js:1)',
      },
    ]);
  });

  it('ignores non-exception events', () => {
    expect(extractExceptions(span({ events: [{ name: 'cache.miss', time: 'x' }] }))).toEqual([]);
    expect(extractExceptions(span({ events: null }))).toEqual([]);
  });

  it('coerces non-string attributes and leaves missing ones null', () => {
    const out = extractExceptions(
      span({
        events: [{ name: 'exception', time: 't', attributes: { 'exception.message': 42 } }],
      })
    );
    expect(out[0].message).toBe('42');
    expect(out[0].type).toBeNull();
    expect(out[0].stacktrace).toBeNull();
  });

  it('keeps markup as plain text', () => {
    const out = extractExceptions(
      span({
        events: [{ name: 'exception', time: 't', attributes: { 'exception.stacktrace': '<img onerror=x>' } }],
      })
    );
    expect(out[0].stacktrace).toBe('<img onerror=x>');
  });
});

describe('matchErrorGroup', () => {
  const typed = span({
    status_code: 'ERROR',
    events: [{ name: 'exception', time: 't', attributes: { 'exception.type': 'TypeError' } }],
  });

  it('matches by span id first', () => {
    const groups = [group({ errorGroupId: 'a', exceptionType: 'TypeError' }), group({ errorGroupId: 'b', spanId: 's1', exceptionType: 'Other' })];
    expect(matchErrorGroup(typed, groups)?.errorGroupId).toBe('b');
  });

  it('matches by exception type', () => {
    const groups = [group({ errorGroupId: 'a', exceptionType: 'RangeError' }), group({ errorGroupId: 'b', exceptionType: 'TypeError' })];
    expect(matchErrorGroup(typed, groups)?.errorGroupId).toBe('b');
  });

  it('falls back to the single group for an ERROR span', () => {
    const plain = span({ status_code: 'ERROR' });
    expect(matchErrorGroup(plain, [group({ exceptionType: 'Other' })])?.errorGroupId).toBe('g1');
  });

  it('returns null for an OK span with several groups', () => {
    const ok = span({ status_code: 'OK' });
    expect(matchErrorGroup(ok, [group({ errorGroupId: 'a' }), group({ errorGroupId: 'b' })])).toBeNull();
  });

  it('returns null for an OK span with a single unrelated group', () => {
    expect(matchErrorGroup(span({ status_code: 'OK' }), [group()])).toBeNull();
  });

  it('returns null without groups', () => {
    expect(matchErrorGroup(typed, [])).toBeNull();
  });
});
