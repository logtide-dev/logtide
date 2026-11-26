import { describe, it, expect } from 'vitest';
import { EMPTY_FILTERS, TAB_LEVELS, buildSourceLogsQuery, sourceClause, sourceLogsHref, toggleValue } from './source-logs';

describe('source logs query', () => {
  it('starts with the source clause, quoting names that need it', () => {
    expect(sourceClause('host', 'vps-app')).toBe('host:vps-app');
    expect(sourceClause('service', 'checkout api')).toBe('service:"checkout api"');
    expect(buildSourceLogsQuery('host', 'vps-app', EMPTY_FILTERS)).toBe('host:vps-app');
  });

  it('adds levels, services and free text', () => {
    expect(buildSourceLogsQuery('host', 'vps-app', { levels: ['error'], services: [], text: '' })).toBe('host:vps-app level:error');
    expect(
      buildSourceLogsQuery('host', 'vps-app', { levels: ['error', 'critical'], services: ['checkout-api', 'orders service'], text: ' timeout ' }),
    ).toBe('host:vps-app level:(error OR critical) service:(checkout-api OR "orders service") timeout');
  });

  it('ignores the service filter on a service page', () => {
    expect(buildSourceLogsQuery('service', 'api', { levels: [], services: ['other'], text: '' })).toBe('service:api');
  });

  it('lists the worst levels first', () => {
    expect(TAB_LEVELS[0]).toBe('critical');
    expect(TAB_LEVELS.at(-1)).toBe('debug');
  });

  it('toggles a value in and out of a filter', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('source logs links', () => {
  const base = { query: 'host:vps-app level:error', projectIds: ['p1', 'p2'], from: '2026-11-26T10:00:00.000Z', to: '2026-11-26T11:00:00.000Z' };

  it('opens the explorer with the same query, projects and window', () => {
    const url = new URL(sourceLogsHref(base), 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('host:vps-app level:error');
    expect(url.searchParams.get('logId')).toBeNull();
  });

  it('centres the explorer on one log', () => {
    const url = new URL(sourceLogsHref({ ...base, logId: 'l1', logProjectId: 'p2' }), 'http://x');
    expect(url.searchParams.get('logId')).toBe('l1');
  });
});
