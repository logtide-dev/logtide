import { describe, it, expect } from 'vitest';
import type { ErrorGroup } from '@logtide/shared';
import {
  buildCreateAlertHref,
  buildLogsWindowHref,
  buildTraceHref,
  buildSessionHref,
  buildErrorDetailHref,
} from './error-group-links';

function group(over: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    id: 'g1',
    organizationId: 'o1',
    projectId: 'p1',
    fingerprint: 'fp',
    exceptionType: 'TypeError',
    exceptionMessage: 'boom',
    language: 'nodejs',
    occurrenceCount: 3,
    firstSeen: '2026-10-21T10:00:00.000Z',
    lastSeen: '2026-10-21T11:00:00.000Z',
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    affectedServices: ['api'],
    sampleLogId: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    ...over,
  };
}

const parse = (href: string) => new URL(href, 'http://localhost');

describe('error group links', () => {
  it('create alert href carries project, service, levels and quoted query', () => {
    const url = parse(buildCreateAlertHref(group()));
    expect(url.pathname).toBe('/dashboard/alerts');
    expect(url.searchParams.get('create')).toBe('1');
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('name')).toBe('TypeError errors');
    expect(url.searchParams.get('levels')).toBe('error,critical');
    expect(url.searchParams.get('query')).toBe('"TypeError"');
    expect(url.searchParams.get('service')).toBe('api');
  });

  it('unknown service is skipped', () => {
    const url = parse(buildCreateAlertHref(group({ affectedServices: ['unknown', 'worker'] })));
    expect(url.searchParams.get('service')).toBe('worker');
    const none = parse(buildCreateAlertHref(group({ affectedServices: ['unknown'] })));
    expect(none.searchParams.has('service')).toBe(false);
    const empty = parse(buildCreateAlertHref(group({ affectedServices: [] })));
    expect(empty.searchParams.has('service')).toBe(false);
  });

  it('type with quotes is sanitised', () => {
    const url = parse(buildCreateAlertHref(group({ exceptionType: 'Weird"Error' })));
    expect(url.searchParams.get('query')).toBe('"WeirdError"');
    expect(url.searchParams.get('name')).toBe('WeirdError errors');
  });

  it('create alert omits the project when the group has none', () => {
    const url = parse(buildCreateAlertHref(group({ projectId: null })));
    expect(url.searchParams.has('projectId')).toBe(false);
  });

  it('logs window is exactly 5 minutes each side', () => {
    const url = parse(buildLogsWindowHref({ projectId: 'p1', time: '2026-10-21T10:00:00.000Z' }));
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-21T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-21T10:05:00.000Z');
  });

  it('logId omitted when absent', () => {
    const without = parse(buildLogsWindowHref({ projectId: 'p1', time: new Date('2026-10-21T10:00:00Z') }));
    expect(without.searchParams.has('logId')).toBe(false);
    const withId = parse(buildLogsWindowHref({ projectId: null, time: '2026-10-21T10:00:00Z', logId: 'l1' }));
    expect(withId.searchParams.get('logId')).toBe('l1');
    expect(withId.searchParams.has('project')).toBe(false);
  });

  it('trace and session hrefs use the project param', () => {
    const trace = parse(buildTraceHref('t-1', 'p1'));
    expect(trace.pathname).toBe('/dashboard/traces/t-1');
    expect(trace.searchParams.get('project')).toBe('p1');
    const session = parse(buildSessionHref('s-1', 'p1'));
    expect(session.pathname).toBe('/dashboard/sessions/s-1');
    expect(session.searchParams.get('project')).toBe('p1');
    expect(buildTraceHref('t-1', null)).toBe('/dashboard/traces/t-1');
  });

  it('detail href keeps the scope search', () => {
    expect(buildErrorDetailHref('g1', '?project=p1&range=24h')).toBe('/dashboard/errors/g1?project=p1&range=24h');
    expect(buildErrorDetailHref('g1', 'range=7d')).toBe('/dashboard/errors/g1?range=7d');
    expect(buildErrorDetailHref('g1', '')).toBe('/dashboard/errors/g1');
  });
});
