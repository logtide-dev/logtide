import { describe, it, expect } from 'vitest';
import {
  LOGS_PATH,
  LOG_LINK_WINDOW_MS,
  parseExplorerUrl,
  buildExplorerUrl,
  buildLogsUrl,
  logPermalink,
  alertPrefillUrl,
  toSavedState,
  savedSearchUrl,
  type ExplorerState,
} from './explorer-url';

const u = (s: string) => new URL('http://localhost/dashboard/logs' + s);
const at = (path: string) => new URL(path, 'http://localhost');

function state(overrides: Partial<ExplorerState> = {}): ExplorerState {
  return {
    q: 'timeout',
    projectIds: ['p1', 'p2'],
    range: { kind: 'preset', preset: '1h' },
    view: 'table',
    live: false,
    logId: null,
    logProjectId: null,
    savedId: null,
    ...overrides,
  };
}

describe('parseExplorerUrl', () => {
  it('translates legacy filter params into clauses', () => {
    const p = parseExplorerUrl(u('?q=timeout&service=api&level=error,critical&traceId=abc&sessionId=s1'));
    expect(p.q).toBe('timeout service:api level:(error OR critical) trace:abc session:s1');
    expect(p.legacy).toBe(true);
  });

  it('accepts levels as an alias of level', () => {
    expect(parseExplorerUrl(u('?levels=warn,error')).q).toBe('level:(warn OR error)');
    expect(parseExplorerUrl(u('?level=error&levels=warn')).q).toBe('level:error');
    expect(parseExplorerUrl(u('?levels=warn')).legacy).toBe(true);
  });

  it('maps hostname and spanId', () =>
    expect(parseExplorerUrl(u('?hostname=web-1&spanId=sp1')).q).toBe('host:web-1 span:sp1'));

  it('turns substring mode into a phrase', () => {
    expect(parseExplorerUrl(u('?q=connection refused&mode=substring')).q).toBe('"connection refused"');
    expect(parseExplorerUrl(u('?q=timeout&searchMode=substring')).q).toBe('"timeout"');
    expect(parseExplorerUrl(u('?q=timeout&searchMode=fulltext')).q).toBe('timeout');
    expect(parseExplorerUrl(u('?q=a "b"&mode=substring&service=api')).q).toBe('"a \\"b\\"" service:api');
  });

  it('quotes legacy values that need it', () => {
    const p = parseExplorerUrl(u(`?service=${encodeURIComponent('my svc')}&traceId=${encodeURIComponent('a:b')}`));
    expect(p.q).toBe('service:"my svc" trace:"a:b"');
  });

  it('drops unknown legacy levels and keeps the query parseable', () => {
    expect(parseExplorerUrl(u('?level=error,fatal')).q).toBe('level:error');
    expect(parseExplorerUrl(u('?q=service:a&service=b')).q).toBe('service:a');
  });

  it('reads a legacy logId link', () => {
    const p = parseExplorerUrl(u('?logId=L1&projectId=P1'));
    expect(p.logId).toBe('L1');
    expect(p.logProjectId).toBe('P1');
    expect(p.scope.projectIds).toEqual(['P1']);
    expect(p.legacy).toBe(true);
  });

  it('prefers logProject, then the single scoped project, for the log project', () => {
    expect(parseExplorerUrl(u('?logId=L1&logProject=P2&project=p1,p3')).logProjectId).toBe('P2');
    expect(parseExplorerUrl(u('?logId=L1&project=p1')).logProjectId).toBe('p1');
    expect(parseExplorerUrl(u('?logId=L1&project=p1,p2')).logProjectId).toBeNull();
    expect(parseExplorerUrl(u('?project=p1')).logProjectId).toBeNull();
  });

  it('reads the canonical params', () => {
    const p = parseExplorerUrl(u('?q=a&project=p1,p2&range=1h&view=terminal&live=true&saved=s9'));
    expect(p.legacy).toBe(false);
    expect(p.q).toBe('a');
    expect(p.scope).toEqual({ projectIds: ['p1', 'p2'], range: { kind: 'preset', preset: '1h' } });
    expect(p.view).toBe('terminal');
    expect(p.live).toBe(true);
    expect(p.savedId).toBe('s9');
    expect(p.logId).toBeNull();
  });

  it('reads a custom window', () => {
    const p = parseExplorerUrl(u('?from=2026-10-21T10:37:13.123Z&to=2026-10-21T10:47:13.123Z'));
    expect(p.scope.range).toEqual({ kind: 'custom', from: '2026-10-21T10:37:13.123Z', to: '2026-10-21T10:47:13.123Z' });
    expect(p.legacy).toBe(false);
  });

  it('ignores an unknown view', () => {
    expect(parseExplorerUrl(u('?view=grid')).view).toBeNull();
    expect(parseExplorerUrl(u('')).view).toBeNull();
    expect(parseExplorerUrl(u('?live=1')).live).toBe(false);
  });
});

describe('buildExplorerUrl', () => {
  it('writes the canonical url', () => {
    const url = at(buildExplorerUrl(state()));
    expect(url.pathname).toBe(LOGS_PATH);
    expect(url.searchParams.get('q')).toBe('timeout');
    expect(url.searchParams.get('project')).toBe('p1,p2');
    expect(url.searchParams.get('range')).toBe('1h');
    expect(url.searchParams.get('view')).toBe('table');
    for (const key of ['live', 'logId', 'logProject', 'saved', 'from', 'to']) {
      expect(url.searchParams.has(key), key).toBe(false);
    }
  });

  it('omits q when empty and the project for all projects', () => {
    const url = at(buildExplorerUrl(state({ q: '  ', projectIds: [] })));
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('project')).toBe(false);
    expect(url.searchParams.get('range')).toBe('1h');
  });

  it('writes a custom window as from and to', () => {
    const url = at(
      buildExplorerUrl(
        state({ range: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' } }),
      ),
    );
    expect(url.searchParams.get('from')).toBe('2026-10-21T10:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-21T11:00:00.000Z');
    expect(url.searchParams.has('range')).toBe(false);
  });

  it('writes logProject only when the scope is not that project', () => {
    const only = at(buildExplorerUrl(state({ projectIds: ['p1'], logId: 'L1', logProjectId: 'p1' })));
    expect(only.searchParams.get('logId')).toBe('L1');
    expect(only.searchParams.has('logProject')).toBe(false);
    const several = at(buildExplorerUrl(state({ projectIds: ['p1', 'p2'], logId: 'L1', logProjectId: 'p1' })));
    expect(several.searchParams.get('logProject')).toBe('p1');
    const all = at(buildExplorerUrl(state({ projectIds: [], logId: 'L1', logProjectId: 'p1' })));
    expect(all.searchParams.get('logProject')).toBe('p1');
  });

  it('round-trips state through the url', () => {
    const s = state({
      q: 'level:error "a b" -host:web-1',
      projectIds: ['p1', 'p2'],
      range: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' },
      view: 'terminal',
      live: true,
      logId: 'L1',
      logProjectId: 'p2',
      savedId: 's1',
    });
    const p = parseExplorerUrl(at(buildExplorerUrl(s)));
    expect(p.q).toBe(s.q);
    expect(p.scope.projectIds).toEqual(s.projectIds);
    expect(p.scope.range).toEqual(s.range);
    expect(p.view).toBe(s.view);
    expect(p.live).toBe(true);
    expect(p.logId).toBe('L1');
    expect(p.logProjectId).toBe('p2');
    expect(p.savedId).toBe('s1');
    expect(p.legacy).toBe(false);
  });
});

describe('links for other pages', () => {
  it('builds a logs link from loose input', () => {
    const url = at(
      buildLogsUrl({ q: 'trace:abc', projectIds: ['p1'], from: new Date('2026-10-21T10:00:00Z'), to: '2026-10-21T11:00:00.000Z' }),
    );
    expect(url.pathname).toBe(LOGS_PATH);
    expect(url.searchParams.get('q')).toBe('trace:abc');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-21T10:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-21T11:00:00.000Z');
    expect(at(buildLogsUrl({ range: '7d', live: true, view: 'terminal' })).searchParams.toString()).toBe(
      'range=7d&view=terminal&live=true',
    );
    expect(buildLogsUrl({})).toBe(LOGS_PATH);
  });

  it('builds a permalink of log time +/- 5 minutes in UTC', () => {
    const url = new URL(logPermalink({ id: 'L1', projectId: 'p1', time: '2026-10-21T10:42:13.123Z' }, 'https://app.example'));
    expect(url.origin).toBe('https://app.example');
    expect(url.pathname).toBe(LOGS_PATH);
    expect(url.searchParams.get('from')).toBe('2026-10-21T10:37:13.123Z');
    expect(url.searchParams.get('to')).toBe('2026-10-21T10:47:13.123Z');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('logId')).toBe('L1');
    expect(url.searchParams.has('logProject')).toBe(false);
    expect(LOG_LINK_WINDOW_MS).toBe(300000);
  });

  it('writes an absolute instant for an offset log time', () => {
    const url = new URL(logPermalink({ id: 'L1', projectId: 'p1', time: '2026-03-29T03:00:00+02:00' }, 'https://app.example'));
    expect(url.searchParams.get('from')).toBe('2026-03-29T00:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-03-29T01:05:00.000Z');
  });
});

describe('alertPrefillUrl', () => {
  it('builds the alert pre-fill url', () => {
    const q = 'level:(error OR critical) service:api timeout';
    const url = at(alertPrefillUrl({ q, scopeProjectIds: ['p1'] }));
    expect(url.pathname).toBe('/dashboard/alerts');
    expect(url.searchParams.get('create')).toBe('1');
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('query')).toBe(q);
    expect(url.searchParams.get('levels')).toBe('error,critical');
    expect(url.searchParams.get('service')).toBe('api');
    expect(url.searchParams.get('name')).toBe('Logs matching level:(error OR critical) service:api timeout');
  });

  it('pre-fills all levels minus excluded ones and omits projectId for several projects', () => {
    const url = at(alertPrefillUrl({ q: '-level:debug', scopeProjectIds: ['p1', 'p2'] }));
    expect(url.searchParams.get('levels')).toBe('info,warn,error,critical');
    expect(url.searchParams.has('projectId')).toBe(false);
    expect(url.searchParams.has('service')).toBe(false);
  });

  it('omits the query, name and service when they do not apply', () => {
    const empty = at(alertPrefillUrl({ q: '', scopeProjectIds: [] }));
    expect(empty.searchParams.get('create')).toBe('1');
    expect(empty.searchParams.get('levels')).toBe('debug,info,warn,error,critical');
    for (const key of ['query', 'name', 'projectId', 'service']) expect(empty.searchParams.has(key), key).toBe(false);
    const two = at(alertPrefillUrl({ q: 'service:(a OR b)', scopeProjectIds: ['p1'] }));
    expect(two.searchParams.has('service')).toBe(false);
  });

  it('cuts long alert names to 80 characters', () => {
    const name = at(alertPrefillUrl({ q: 'x'.repeat(200), scopeProjectIds: ['p1'] })).searchParams.get('name') ?? '';
    expect(name).toHaveLength(80);
    expect(name.endsWith('...')).toBe(true);
    expect(name.startsWith('Logs matching xxx')).toBe(true);
  });
});

describe('saved search state', () => {
  it('maps saved state both ways', () => {
    const url = at(savedSearchUrl({ id: 's1', state: { q: 'x', projectIds: ['p1'], range: '7d', view: 'terminal' } }));
    expect(url.pathname).toBe(LOGS_PATH);
    expect(url.searchParams.get('saved')).toBe('s1');
    expect(url.searchParams.get('q')).toBe('x');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('range')).toBe('7d');
    expect(url.searchParams.get('view')).toBe('terminal');

    expect(toSavedState(state({ range: { kind: 'preset', preset: '7d' }, view: 'terminal' }), ['user.id'])).toEqual({
      q: 'timeout',
      projectIds: ['p1', 'p2'],
      range: '7d',
      view: 'terminal',
      columns: ['user.id'],
    });
    expect(
      toSavedState(state({ range: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' } }), []),
    ).toEqual({
      q: 'timeout',
      projectIds: ['p1', 'p2'],
      from: '2026-10-21T10:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
      view: 'table',
    });
  });

  it('opens a saved custom window and leaves the range alone when the state has none', () => {
    const custom = at(
      savedSearchUrl({
        id: 's2',
        state: { q: '', projectIds: [], from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' },
      }),
    );
    expect(custom.searchParams.get('from')).toBe('2026-10-21T10:00:00.000Z');
    expect(custom.searchParams.has('q')).toBe(false);
    const bare = at(savedSearchUrl({ id: 's3', state: { q: 'a', projectIds: [] } }));
    expect(bare.searchParams.has('range')).toBe(false);
    expect(bare.searchParams.has('from')).toBe(false);
    expect(bare.searchParams.get('saved')).toBe('s3');
  });
});
