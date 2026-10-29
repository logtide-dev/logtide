// Logs explorer page (routes/dashboard/logs/+page.svelte).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const zr: Record<string, (e: { offsetX: number; offsetY: number }) => void> = {};
  const chart = {
    setOption: () => {},
    on: () => {},
    dispose: () => {},
    resize: () => {},
    getZr: () => ({
      on: (event: string, fn: (e: { offsetX: number; offsetY: number }) => void) => {
        zr[event] = fn;
      },
      off: () => {},
    }),
    // One pixel is one second after 10:00:00 UTC (histogram buckets start there).
    convertFromPixel: (_finder: unknown, x: number) => Date.UTC(2026, 9, 21, 10, 0, 0) + x * 1000,
    containPixel: () => true,
  };
  return {
    zr,
    chart,
    goto: vi.fn(),
    navCallbacks: [] as Array<(nav: { to: { url: URL } | null }) => void>,
    getLogs: vi.fn(),
    getLogById: vi.fn(),
    getHistogram: vi.fn(),
    getFacets: vi.fn(),
    getFields: vi.fn(),
    getLogContext: vi.fn(),
    createLogsWebSocket: vi.fn(),
    getProjects: vi.fn(),
    getProjectDataAvailability: vi.fn(),
    getLogIdentifiers: vi.fn(),
    getLogIdentifiersBatch: vi.fn(),
    getCorrelatedLogs: vi.fn(),
    saved: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    copyToClipboard: vi.fn(),
    completeItem: vi.fn(),
  };
});

vi.mock('$app/navigation', () => ({
  goto: h.goto,
  afterNavigate: (cb: (nav: { to: { url: URL } | null }) => void) => {
    h.navCallbacks.push(cb);
  },
  beforeNavigate: () => {},
  invalidate: async () => {},
  invalidateAll: async () => {},
}));

vi.mock('$lib/api/logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/logs')>();
  return {
    ...actual,
    logsAPI: {
      getLogs: h.getLogs,
      getLogById: h.getLogById,
      getHistogram: h.getHistogram,
      getFacets: h.getFacets,
      getFields: h.getFields,
      getLogContext: h.getLogContext,
      createLogsWebSocket: h.createLogsWebSocket,
    },
  };
});

vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
    getProjectDataAvailability = h.getProjectDataAvailability;
  },
}));

vi.mock('$lib/api/correlation', () => ({
  correlationAPI: {
    getLogIdentifiers: h.getLogIdentifiers,
    getLogIdentifiersBatch: h.getLogIdentifiersBatch,
    getCorrelatedLogs: h.getCorrelatedLogs,
  },
}));

vi.mock('$lib/api/saved-searches', () => ({ savedSearchesAPI: h.saved }));
vi.mock('$lib/api/exceptions', () => ({ getExceptionByLogId: vi.fn().mockResolvedValue(null) }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: h.copyToClipboard }));
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: h.completeItem } }));
vi.mock('echarts', () => ({ init: () => h.chart }));

vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('$lib/components/search/test-stubs/ScopeBarStub.svelte')).default,
}));
vi.mock('$lib/components/app/KeyValueTable.svelte', async () => ({
  default: (await import('$lib/components/search/test-stubs/KeyValueTableStub.svelte')).default,
}));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import Page from './+page.svelte';
import { page } from '$app/state';
import { LogQueryError, type LogEntry } from '$lib/api/logs';
import { scopeStore } from '$lib/stores/scope';
import { organizationStore } from '$lib/stores/organization';
import { authStore } from '$lib/stores/auth';
import { shortcutsStore } from '$lib/stores/shortcuts';
import { displayPreferences } from '$lib/stores/display-preferences';
import { toastStore } from '$lib/stores/toast';
import { makeLog, resetLogIds, deferred, FakeWebSocket } from '$lib/components/search/test-fixtures';

const NOW = new Date('2026-10-21T10:42:13.000Z');

const ORG = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'u1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const PROJECTS = [
  { id: 'p1', name: 'Shop', organizationId: 'org-1' },
  { id: 'p2', name: 'Billing', organizationId: 'org-1' },
];

type Params = Record<string, unknown>;

function response(logs: LogEntry[], extra: Partial<{ total: number; hasMore: boolean; nextCursor: string }> = {}) {
  return { logs, total: extra.total ?? logs.length, hasMore: extra.hasMore ?? false, limit: 50, offset: 0, ...extra };
}

function logsList(n: number, prefix = 'row', projectId = 'p1'): LogEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeLog({
      projectId,
      message: `${prefix}-${i}`,
      time: new Date(NOW.getTime() - (i + 1) * 1000).toISOString(),
    }),
  );
}

function logsCall(index = -1): Params {
  return h.getLogs.mock.calls.at(index)?.[0] as Params;
}

function lastGotoUrl(): URL {
  const call = h.goto.mock.calls.at(-1);
  if (!call) throw new Error('goto was never called');
  return new URL(String(call[0]), 'http://localhost');
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
}

async function renderPage(path = '/dashboard/logs') {
  (page as { url: URL }).url = new URL(`http://localhost${path}`);
  const utils = render(Page);
  await waitFor(() => expect(h.getProjects).toHaveBeenCalled());
  await settle();
  return utils;
}

function queryInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Log query' }) as HTMLInputElement;
}

async function submitQuery(text: string) {
  const input = queryInput();
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.keyDown(input, { key: 'Escape' });
  await fireEvent.keyDown(input, { key: 'Enter' });
  await settle();
}

function shortcut(id: string) {
  const found = get(shortcutsStore.active).find((s) => s.id === id);
  if (!found) throw new Error(`shortcut ${id} not registered`);
  return found;
}

function rowMessages(): string[] {
  return Array.from(document.querySelectorAll('[data-log-row]')).map(
    (row) => row.querySelectorAll('td')[row.querySelectorAll('td').length - 1]?.textContent?.trim() ?? '',
  );
}

const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

beforeEach(() => {
  vi.useRealTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  sessionStorage.clear();
  resetLogIds();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 360 });
  for (const k of Object.keys(h.zr)) delete h.zr[k];
  h.navCallbacks.length = 0;
  h.goto.mockReset();
  h.getLogs.mockReset().mockResolvedValue(response([]));
  h.getLogById.mockReset().mockResolvedValue(null);
  h.getHistogram.mockReset().mockResolvedValue({ buckets: [], bucketSeconds: 60, total: 0, from: '', to: '' });
  h.getFacets.mockReset().mockResolvedValue([]);
  h.getFields.mockReset().mockResolvedValue([]);
  h.getLogContext.mockReset().mockResolvedValue({ before: [], current: null, after: [], applied: { service: null, hostname: null } });
  h.createLogsWebSocket.mockReset();
  h.getProjects.mockReset().mockResolvedValue({ projects: PROJECTS });
  h.getProjectDataAvailability.mockReset().mockResolvedValue({ logs: ['p1', 'p2'], traces: [], metrics: [] });
  h.getLogIdentifiers.mockReset().mockResolvedValue([]);
  h.getLogIdentifiersBatch.mockReset().mockResolvedValue({});
  h.getCorrelatedLogs.mockReset();
  h.saved.list.mockReset().mockResolvedValue([]);
  h.copyToClipboard.mockReset().mockResolvedValue(true);
  h.completeItem.mockReset();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  scopeStore.set({ projectIds: [], range: { kind: 'preset', preset: '1h' } });
  authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'Ada' }, 'token-1');
  organizationStore.setCurrentOrganization(ORG);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe('logs page: scope, url, window, states, shortcuts', () => {
  it('translates legacy params and rewrites the url', async () => {
    await renderPage('/dashboard/logs?service=api&level=error,critical&projectId=p1');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    expect(logsCall()).toMatchObject({ q: 'service:api level:(error OR critical)', projectId: ['p1'] });
    const url = lastGotoUrl();
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('service:api level:(error OR critical)');
    expect(url.searchParams.get('project')).toBe('p1');
    for (const legacy of ['service', 'level', 'projectId']) expect(url.searchParams.has(legacy)).toBe(false);
  });

  it('runs with a frozen window of 50 rows', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    expect(logsCall()).toEqual({
      projectId: ['p1', 'p2'],
      from: '2026-10-21T09:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
      limit: 50,
    });
  });

  it('load more uses the cursor and the same window', async () => {
    h.getLogs.mockResolvedValueOnce(response(logsList(50), { total: 120, hasMore: true, nextCursor: 'c1' }));
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-log-row]').length).toBeGreaterThan(0));
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    h.getLogs.mockResolvedValueOnce(response(logsList(10, 'more'), { total: 120, hasMore: false }));
    const scroller = screen.getByTestId('log-results-scroll');
    scroller.scrollTop = 50 * 36 - 360;
    await fireEvent.scroll(scroller);
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toEqual({
      projectId: ['p1', 'p2'],
      from: '2026-10-21T09:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
      limit: 50,
      cursor: 'c1',
    });
  });

  it('drops a stale load-more response after a new query', async () => {
    h.getLogs.mockResolvedValueOnce(response(logsList(50, 'old'), { total: 120, hasMore: true, nextCursor: 'c1' }));
    await renderPage();
    await waitFor(() => expect(rowMessages()[0]).toBe('old-0'));
    const more = deferred<ReturnType<typeof response>>();
    h.getLogs.mockReturnValueOnce(more.promise);
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    h.getLogs.mockResolvedValueOnce(response(logsList(3, 'fresh')));
    await submitQuery('timeout');
    await waitFor(() => expect(rowMessages()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']));
    more.resolve(response(logsList(5, 'stale')));
    await settle();
    expect(rowMessages()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
    expect(logsCall()).toMatchObject({ q: 'timeout' });
  });

  it('does not fetch when the query does not parse', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await submitQuery('level:(');
    expect(h.getLogs).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('position');
  });

  it('shows the server position error from a 400', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    h.getLogs.mockRejectedValueOnce(new LogQueryError('Unknown key', 3));
    await submitQuery('foo:bar');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unknown key'));
  });

  it('shows the error state with Retry', async () => {
    h.getLogs.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(await screen.findByText('Could not load logs')).toBeInTheDocument();
    h.getLogs.mockResolvedValueOnce(response(logsList(2)));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Could not load logs')).toBeNull());
  });

  it('shows the no-results state with range buttons and Clear', async () => {
    await renderPage('/dashboard/logs?q=timeout&range=1h');
    expect(await screen.findByText('No logs match in the last hour')).toBeInTheDocument();
    expect(screen.getByText('Try a wider time range or a simpler query.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Search last 24h' }));
    await settle();
    expect(scopeStore.get().range).toEqual({ kind: 'preset', preset: '24h' });
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ q: 'timeout', from: '2026-10-20T10:42:13.000Z' });

    await fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(3));
    expect(logsCall().q).toBeUndefined();
    expect(queryInput().value).toBe('');
  });

  it('shows onboarding only when the scoped projects never received logs', async () => {
    h.getProjectDataAvailability.mockResolvedValue({ logs: [], traces: [], metrics: [] });
    const first = await renderPage();
    expect(await screen.findByText(/no logs yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No logs match/)).toBeNull();
    first.unmount();

    h.getProjectDataAvailability.mockResolvedValue({ logs: ['p1'], traces: [], metrics: [] });
    await renderPage();
    expect(await screen.findByText('No logs match in the last hour')).toBeInTheDocument();
    expect(screen.queryByText(/no logs yet/i)).toBeNull();
  });

  it('shows Results as of and Refresh re-runs with a new window', async () => {
    h.getLogs.mockResolvedValue(response(logsList(3)));
    h.getHistogram.mockResolvedValue({ buckets: [], bucketSeconds: 60, total: 3, from: '', to: '' });
    await renderPage();
    expect(await screen.findByText('Results as of 10:42:13')).toBeInTheDocument();
    expect(screen.getAllByText('3 logs').length).toBeGreaterThan(0);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh results' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ from: '2026-10-21T09:43:13.000Z', to: '2026-10-21T10:43:13.000Z' });
    expect(await screen.findByText('Results as of 10:43:13')).toBeInTheDocument();
  });

  it('j, k and Enter move the selection and open details', async () => {
    h.getLogs.mockResolvedValue(response(logsList(3)));
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-log-row]').length).toBe(3));
    const selected = () =>
      Array.from(document.querySelectorAll('[data-log-row]')).findIndex((r) => r.getAttribute('aria-selected') === 'true');

    shortcut('search:next-log').action();
    await tick();
    expect(selected()).toBe(0);
    shortcut('search:next-log').action();
    await tick();
    expect(selected()).toBe(1);
    shortcut('search:prev-log').action();
    await tick();
    expect(selected()).toBe(0);

    expect(shortcut('search:expand-log').label).toBe('Open or close log details');
    shortcut('search:expand-log').action();
    await tick();
    const details = screen.getByRole('complementary', { name: 'Log details' });
    expect(within(details).getByText('row-0')).toBeInTheDocument();
    shortcut('search:expand-log').action();
    await tick();
    expect(screen.queryByRole('complementary', { name: 'Log details' })).toBeNull();
  });

  it('applies a url change from another page', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    expect(h.navCallbacks.length).toBeGreaterThan(0);
    h.navCallbacks[0]({ to: { url: new URL('http://localhost/dashboard/logs?q=timeout') } });
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ q: 'timeout' });
    expect(queryInput().value).toBe('timeout');
  });

  it('uses the page header, the scope bar and the title', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Logs' })).toBeInTheDocument();
    expect(screen.getByText('Search, filter and tail logs across your projects')).toBeInTheDocument();
    const bar = screen.getByTestId('scope-bar');
    expect(bar.getAttribute('data-mode')).toBe('multi');
    expect(bar.getAttribute('data-projects')).toBe('p1,p2');
    expect(bar.getAttribute('data-time-disabled')).toBe('false');
    expect(document.title).toBe('Logs - LogTide');
  });

  it('re-runs when the scope changes', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    scopeStore.setProjects(['p2']);
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ projectId: ['p2'] });
    expect(lastGotoUrl().searchParams.get('project')).toBe('p2');
  });

  it('stops at 5,000 loaded rows with a notice', async () => {
    const page1 = response(logsList(50), { total: 9000, hasMore: true, nextCursor: 'c' });
    h.getLogs.mockResolvedValue(page1);
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-log-row]').length).toBeGreaterThan(0));
    for (let i = 0; i < 99; i++) {
      await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await settle();
    }
    expect(h.getLogs).toHaveBeenCalledTimes(100);
    expect(
      screen.getByText('Showing the newest 5,000 logs. Narrow the time range or the query to see older ones.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  }, 60_000);

  it('keeps the rows and toasts when load more fails', async () => {
    h.getLogs.mockResolvedValueOnce(response(logsList(50), { total: 120, hasMore: true, nextCursor: 'c1' }));
    const toast = vi.spyOn(toastStore, 'error').mockImplementation(() => {});
    await renderPage();
    await waitFor(() => expect(rowMessages()[0]).toBe('row-0'));
    h.getLogs.mockRejectedValueOnce(new Error('down'));
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await settle();
    expect(toast).toHaveBeenCalledWith('Could not load more logs');
    expect(rowMessages()[0]).toBe('row-0');
    expect(screen.queryByText('Could not load logs')).toBeNull();
  });
});

function savedSearch(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    organizationId: 'org-1',
    createdBy: 'u1',
    createdByName: 'Ada',
    name: 'Errors',
    visibility: 'private',
    state: { q: 'level:error', projectIds: ['p2'], range: '24h', view: 'terminal', columns: ['user.id'] },
    canEdit: true,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

async function openMoreActions() {
  await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  await settle();
}

async function openFirstRowDetails() {
  await waitFor(() => expect(document.querySelectorAll('[data-log-row]').length).toBeGreaterThan(0));
  await fireEvent.click(document.querySelector('[data-log-row]') as HTMLElement);
  await settle();
  return screen.getByRole('complementary', { name: 'Log details' });
}

describe('logs page: histogram, facets, details, links, saved and recent searches', () => {
  it('a histogram selection sets a custom range and re-runs', async () => {
    const base = Date.UTC(2026, 9, 21, 10, 0, 0);
    h.getHistogram.mockResolvedValue({
      buckets: Array.from({ length: 10 }, (_, i) => ({
        time: new Date(base + i * 60_000).toISOString(),
        total: 2,
        byLevel: { info: 2 },
      })),
      bucketSeconds: 60,
      total: 1234,
      from: '2026-10-21T09:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
    });
    h.getLogs.mockResolvedValue(response(logsList(3), { total: 3 }));
    await renderPage();
    await waitFor(() => expect(h.getHistogram).toHaveBeenCalledTimes(1));
    expect(h.getHistogram.mock.calls[0][0]).toMatchObject({
      projectId: ['p1', 'p2'],
      from: '2026-10-21T09:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
      bucketSeconds: 60,
    });
    // the header prefers the histogram total over the page total
    expect(await screen.findAllByText('1,234 logs')).not.toHaveLength(0);

    h.zr.mousedown?.({ offsetX: 30, offsetY: 20 });
    h.zr.mouseup?.({ offsetX: 31, offsetY: 20 });
    await settle();
    expect(scopeStore.get().range).toEqual({
      kind: 'custom',
      from: '2026-10-21T10:00:00.000Z',
      to: '2026-10-21T10:01:00.000Z',
    });
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T10:01:00.000Z' });
    expect(lastGotoUrl().searchParams.get('from')).toBe('2026-10-21T10:00:00.000Z');
  });

  it('a facet click adds the clause, re-runs and updates the url', async () => {
    h.getFacets.mockResolvedValue([
      { field: 'level', values: [{ value: 'error', count: 3 }], otherCount: 0 },
      { field: 'service', values: [{ value: 'api', count: 5 }], otherCount: 0 },
    ]);
    await renderPage();
    await waitFor(() => expect(h.getFacets).toHaveBeenCalledTimes(1));
    expect(h.getFacets.mock.calls[0][0]).toMatchObject({ fields: ['level', 'service', 'host'], limit: 10 });
    await fireEvent.click(await screen.findByRole('button', { name: 'service api (5 logs)' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ q: 'service:api' });
    expect(lastGotoUrl().searchParams.get('q')).toBe('service:api');
    expect(queryInput().value).toBe('service:api');
  });

  it('details Exclude adds a negated metadata clause', async () => {
    h.getLogs.mockResolvedValue(response([makeLog({ metadata: { user: { id: 42 } } })]));
    await renderPage();
    const details = await openFirstRowDetails();
    await fireEvent.click(within(details).getByRole('button', { name: 'stub exclude' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ q: '-user.id:42' });
  });

  it('refuses an unqueryable key with a toast', async () => {
    const toast = vi.spyOn(toastStore, 'error').mockImplementation(() => {});
    h.getFacets.mockResolvedValue([{ field: 'user name', values: [{ value: 'ada', count: 1 }], otherCount: 0 }]);
    await renderPage();
    await fireEvent.click(await screen.findByRole('button', { name: 'user name ada (1 log)' }));
    await settle();
    expect(toast).toHaveBeenCalledWith('This field cannot be used in a query');
    expect(h.getLogs).toHaveBeenCalledTimes(1);
  });

  it('details Add as column adds a custom column for the active project', async () => {
    h.getLogs.mockResolvedValue(response([makeLog({ metadata: { user: { id: 42 } } })]));
    await renderPage();
    const details = await openFirstRowDetails();
    await fireEvent.click(within(details).getByRole('button', { name: 'stub add column' }));
    await settle();
    expect(screen.getByRole('columnheader', { name: 'user.id' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('logtide:columns:p1') ?? '[]')).toEqual(['user.id']);
  });

  it('opening details writes logId and closing removes it', async () => {
    h.getLogs.mockResolvedValue(response([makeLog({ id: 'abc', projectId: 'p2' })]));
    await renderPage();
    const details = await openFirstRowDetails();
    expect(lastGotoUrl().searchParams.get('logId')).toBe('abc');
    expect(lastGotoUrl().searchParams.get('logProject')).toBe('p2');
    await fireEvent.click(within(details).getByRole('button', { name: 'Close log details' }));
    await settle();
    expect(lastGotoUrl().searchParams.has('logId')).toBe(false);
    expect(lastGotoUrl().searchParams.has('logProject')).toBe(false);
  });

  it('opens a logId link, loads until the log is present and selects it', async () => {
    const target = makeLog({ id: 'target', time: '2026-10-21T10:30:00.000Z', message: 'the one' });
    h.getLogById.mockResolvedValue({ log: target });
    h.getLogs
      .mockResolvedValueOnce(response(logsList(50, 'first'), { total: 60, hasMore: true, nextCursor: 'c1' }))
      .mockResolvedValueOnce(response([...logsList(5, 'second'), target], { total: 60, hasMore: false }));
    await renderPage('/dashboard/logs?logId=target&project=p1');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(h.getLogById).toHaveBeenCalledWith('target', 'p1');
    expect(logsCall(0)).toMatchObject({
      projectId: ['p1'],
      from: '2026-10-21T10:25:00.000Z',
      to: '2026-10-21T10:35:00.000Z',
    });
    expect(logsCall(1)).toMatchObject({ cursor: 'c1' });
    await waitFor(() => {
      const row = document.querySelector('[data-log-id="target"]');
      expect(row?.getAttribute('aria-selected')).toBe('true');
    });
    const details = screen.getByRole('complementary', { name: 'Log details' });
    expect(within(details).getByText('the one')).toBeInTheDocument();
  });

  it('opens the details panel with a notice when the log is outside the results', async () => {
    const info = vi.spyOn(toastStore, 'info').mockImplementation(() => {});
    const target = makeLog({ id: 'far', time: '2026-10-21T10:30:00.000Z', message: 'far away' });
    h.getLogById.mockResolvedValue({ log: target });
    h.getLogs.mockResolvedValue(response(logsList(3)));
    await renderPage('/dashboard/logs?logId=far&project=p1&range=1h');
    await waitFor(() => expect(info).toHaveBeenCalledWith('This log is outside the current results'));
    expect(logsCall(0)).toMatchObject({ from: '2026-10-21T09:42:13.000Z' });
    const details = screen.getByRole('complementary', { name: 'Log details' });
    expect(within(details).getByText('far away')).toBeInTheDocument();
  });

  it('says so when a logId link points to a missing log', async () => {
    const error = vi.spyOn(toastStore, 'error').mockImplementation(() => {});
    h.getLogById.mockResolvedValue(null);
    await renderPage('/dashboard/logs?logId=gone&project=p1');
    await waitFor(() => expect(error).toHaveBeenCalledWith('Log not found'));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    expect(lastGotoUrl().searchParams.has('logId')).toBe(false);
  });

  it('Create alert opens the alert builder with the pre-fill params', async () => {
    await renderPage('/dashboard/logs?q=level:error&project=p1&range=1h');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await openMoreActions();
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    const url = lastGotoUrl();
    expect(url.pathname).toBe('/dashboard/alerts');
    expect(url.searchParams.get('create')).toBe('1');
    expect(url.searchParams.get('query')).toBe('level:error');
    expect(url.searchParams.get('projectId')).toBe('p1');
  });

  it('Copy link copies the canonical url', async () => {
    const success = vi.spyOn(toastStore, 'success').mockImplementation(() => {});
    await renderPage('/dashboard/logs?q=timeout');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await openMoreActions();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settle();
    expect(h.copyToClipboard).toHaveBeenCalledTimes(1);
    const copied = new URL(String(h.copyToClipboard.mock.calls[0][0]));
    expect(copied.origin).toBe(location.origin);
    expect(copied.pathname).toBe('/dashboard/logs');
    expect(copied.searchParams.get('q')).toBe('timeout');
    expect(copied.searchParams.get('range')).toBe('1h');
    expect(success).toHaveBeenCalledWith('Link copied');
  });

  it('Export opens with the active query and scope and is disabled without rows', async () => {
    await renderPage('/dashboard/logs?q=timeout');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await openMoreActions();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('opening a saved search applies its state and writes saved', async () => {
    h.saved.list.mockResolvedValue([savedSearch()]);
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }));
    await fireEvent.click(await screen.findByRole('button', { name: /^Errors/ }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({
      q: 'level:error',
      projectId: ['p2'],
      from: '2026-10-20T10:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
    });
    const url = lastGotoUrl();
    expect(url.searchParams.get('saved')).toBe('s1');
    expect(url.searchParams.get('view')).toBe('terminal');
    expect(url.searchParams.get('project')).toBe('p2');
    expect(JSON.parse(localStorage.getItem('logtide:columns:p2') ?? '[]')).toEqual(['user.id']);
    expect(queryInput().value).toBe('level:error');
  });

  it('records a recent search on Enter', async () => {
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await submitQuery('timeout');
    const stored = JSON.parse(localStorage.getItem('logtide_recent_searches_v2') ?? '[]');
    expect(stored[0]).toMatchObject({ q: 'timeout', projectIds: [], range: '1h' });

    await fireEvent.input(queryInput(), { target: { value: '' } });
    await settle();
    const chip = screen.getByRole('button', { name: 'timeout' });
    expect(chip.getAttribute('title')).toBe('timeout');
    scopeStore.setRange({ kind: 'preset', preset: '24h' });
    await settle();
    await fireEvent.input(queryInput(), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'timeout' }));
    await waitFor(() => expect(logsCall()).toMatchObject({ q: 'timeout', from: '2026-10-21T09:42:13.000Z' }));
    expect(scopeStore.get().range).toEqual({ kind: 'preset', preset: '1h' });
  });

  it('loads discovered fields only when the scope changes', async () => {
    h.getFields.mockResolvedValue([{ key: 'user.id', occurrences: 9 }]);
    await renderPage();
    await waitFor(() => expect(h.getFacets).toHaveBeenCalledTimes(1));
    expect(h.getFields).toHaveBeenCalledTimes(1);
    expect(h.getFields.mock.calls[0][0]).toEqual({
      projectId: ['p1', 'p2'],
      from: '2026-10-21T09:42:13.000Z',
      to: '2026-10-21T10:42:13.000Z',
    });
    expect(h.getFacets.mock.calls[0][0]).toMatchObject({ fields: ['level', 'service', 'host', 'user.id'] });

    await submitQuery('timeout');
    await waitFor(() => expect(h.getFacets).toHaveBeenCalledTimes(2));
    expect(h.getFields).toHaveBeenCalledTimes(1);

    scopeStore.setRange({ kind: 'preset', preset: '24h' });
    await waitFor(() => expect(h.getFields).toHaveBeenCalledTimes(2));
  });

  it('a context row opens the explorer around that log', async () => {
    const reference = makeLog({ id: 'ref', projectId: 'p1' });
    const neighbour = makeLog({ id: 'ctx', projectId: 'p2', time: '2026-10-21T10:00:00.000Z', message: 'neighbour row' });
    h.getLogs.mockResolvedValue(response([reference]));
    h.getLogContext.mockResolvedValue({
      before: [neighbour],
      current: reference,
      after: [],
      applied: { service: null, hostname: null },
    });
    await renderPage('/dashboard/logs?q=timeout');
    const details = await openFirstRowDetails();
    await fireEvent.click(within(details).getByRole('button', { name: /View context/ }));
    await fireEvent.click(await screen.findByRole('button', { name: /neighbour row/ }));
    await waitFor(() =>
      expect(logsCall()).toMatchObject({
        projectId: ['p2'],
        from: '2026-10-21T09:55:00.000Z',
        to: '2026-10-21T10:05:00.000Z',
      }),
    );
    expect(logsCall().q).toBeUndefined();
    expect(scopeStore.get().projectIds).toEqual(['p2']);
  });
});

describe('logs page: live tail', () => {
  let sockets: FakeWebSocket[];

  beforeEach(() => {
    sockets = [];
    h.createLogsWebSocket.mockImplementation(async () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws.asWebSocket();
    });
  });

  function liveSwitch(): HTMLElement {
    return screen.getByRole('switch', { name: 'Live tail' });
  }

  function liveStatus(): string {
    return screen.getByTestId('live-tail-state').textContent ?? '';
  }

  async function turnLiveOn() {
    await fireEvent.click(liveSwitch());
    await settle();
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
  }

  it('live=true starts live tail with the query', async () => {
    await renderPage('/dashboard/logs?live=true&project=p1&q=level:error');
    await waitFor(() => expect(h.createLogsWebSocket).toHaveBeenCalledTimes(1));
    expect(h.createLogsWebSocket).toHaveBeenCalledWith({ projectId: 'p1', q: 'level:error' });
    expect(h.getLogs).not.toHaveBeenCalled();
    expect(h.completeItem).toHaveBeenCalledWith('try-live-tail');
    expect(lastGotoUrl().searchParams.get('live')).toBe('true');
    expect(liveSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('narrows several projects to the first one and says so', async () => {
    const info = vi.spyOn(toastStore, 'info').mockImplementation(() => {});
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await turnLiveOn();
    expect(info).toHaveBeenCalledWith('Live tail works with one project at a time. Showing Shop.');
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    expect(h.createLogsWebSocket).toHaveBeenCalledTimes(1);
    expect(h.createLogsWebSocket).toHaveBeenCalledWith({ projectId: 'p1', q: undefined });
    expect(lastGotoUrl().searchParams.get('project')).toBe('p1');
    expect(lastGotoUrl().searchParams.get('live')).toBe('true');
  });

  it('disables the time range while live', async () => {
    h.getLogs.mockResolvedValue(response(logsList(3)));
    await renderPage('/dashboard/logs?project=p1');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('scope-bar').getAttribute('data-time-disabled')).toBe('false');
    expect(screen.getByRole('region', { name: 'Log volume' })).toBeInTheDocument();
    await turnLiveOn();
    expect(screen.getByTestId('scope-bar').getAttribute('data-time-disabled')).toBe('true');
    // no histogram and no export while live
    expect(screen.queryByRole('region', { name: 'Log volume' })).toBeNull();
    await openMoreActions();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('streams matching logs to the top of the table', async () => {
    h.getLogs.mockResolvedValue(response(logsList(2, 'old')));
    await renderPage('/dashboard/logs?project=p1&q=level:info');
    await waitFor(() => expect(rowMessages()).toEqual(['old-0', 'old-1']));
    await turnLiveOn();
    expect(h.createLogsWebSocket).toHaveBeenCalledWith({ projectId: 'p1', q: 'level:info' });
    sockets[0].emit({ type: 'connected' });
    await settle();
    expect(liveStatus()).toContain('Live');
    sockets[0].emit({
      type: 'logs',
      logs: [
        makeLog({ message: 'streamed', level: 'info', time: '2026-10-21T10:42:14.000Z' }),
        makeLog({ message: 'filtered out', level: 'error', time: '2026-10-21T10:42:15.000Z' }),
      ],
    });
    await settle();
    expect(rowMessages()).toEqual(['streamed', 'old-0', 'old-1']);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('auto-pauses on scroll and the pill resumes', async () => {
    h.getLogs.mockResolvedValue(response(logsList(30, 'old')));
    await renderPage('/dashboard/logs?project=p1');
    await waitFor(() => expect(rowMessages()[0]).toBe('old-0'));
    await turnLiveOn();
    sockets[0].emit({ type: 'connected' });
    await settle();
    const scroller = screen.getByTestId('log-results-scroll');
    scroller.scrollTop = 200;
    await fireEvent.scroll(scroller);
    await settle();
    expect(screen.getByText('Paused while scrolled')).toBeInTheDocument();
    sockets[0].emit({
      type: 'logs',
      logs: [1, 2, 3].map((n) => makeLog({ message: `new-${n}`, time: `2026-10-21T10:43:0${n}.000Z` })),
    });
    await settle();
    expect(rowMessages()).not.toContain('new-3');
    await fireEvent.click(screen.getByRole('button', { name: '3 new logs' }));
    await settle();
    scroller.scrollTop = 0;
    await fireEvent.scroll(scroller);
    await settle();
    expect(rowMessages().slice(0, 4)).toEqual(['new-3', 'new-2', 'new-1', 'old-0']);
    expect(screen.queryByRole('button', { name: /new logs?$/ })).toBeNull();
    expect(screen.queryByText('Paused while scrolled')).toBeNull();
  });

  it('shows Reconnect after five lost connections', async () => {
    await renderPage('/dashboard/logs?live=true&project=p1');
    await waitFor(() => expect(sockets.length).toBe(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // the first connection and the five reconnect attempts all drop
    for (let i = 0; i < 6; i++) {
      expect(sockets.length).toBe(i + 1);
      sockets[i].drop(1006);
      await settle();
      if (i < 5) expect(liveStatus()).toContain('Reconnecting');
      await vi.advanceTimersByTimeAsync(16_000);
      await settle();
    }
    expect(sockets.length).toBe(6);
    expect(liveStatus()).toContain('Disconnected');
    await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await settle();
    expect(sockets.length).toBe(7);
    vi.useRealTimers();
  });

  it('turning live off re-runs the static query', async () => {
    h.getLogs.mockResolvedValue(response(logsList(2)));
    await renderPage('/dashboard/logs?project=p1');
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await turnLiveOn();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await fireEvent.click(liveSwitch());
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({
      projectId: ['p1'],
      from: '2026-10-21T09:43:13.000Z',
      to: '2026-10-21T10:43:13.000Z',
    });
    expect(sockets[0].closed).toBe(true);
    expect(lastGotoUrl().searchParams.has('live')).toBe(false);
  });

  it('a new query while live reconnects with it', async () => {
    await renderPage('/dashboard/logs?live=true&project=p1');
    await waitFor(() => expect(sockets.length).toBe(1));
    await submitQuery('level:warn');
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(h.createLogsWebSocket).toHaveBeenLastCalledWith({ projectId: 'p1', q: 'level:warn' });
    expect(sockets[0].closed).toBe(true);
    expect(h.getLogs).not.toHaveBeenCalled();
  });

  it('remembers the live tail buffer size', async () => {
    localStorage.setItem('logtide_livetail_limit', '200');
    await renderPage('/dashboard/logs?live=true&project=p1');
    await waitFor(() => expect(sockets.length).toBe(1));
    const select = screen.getByRole('combobox', { name: 'Rows kept in live tail' }) as HTMLSelectElement;
    expect(select.value).toBe('200');
    await fireEvent.change(select, { target: { value: '500' } });
    await settle();
    expect(localStorage.getItem('logtide_livetail_limit')).toBe('500');
  });

  it('shows why the live tail stopped', async () => {
    await renderPage('/dashboard/logs?live=true&project=p1');
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0].emit({ type: 'error', error: 'Unknown field', position: 0 });
    sockets[0].drop(1008, 'Invalid query');
    await settle();
    expect(liveStatus()).toContain('Disconnected');
    expect(screen.getByText('Live tail stopped: Unknown field')).toBeInTheDocument();
  });

  it('stops the socket when the page goes away', async () => {
    const { unmount } = await renderPage('/dashboard/logs?live=true&project=p1');
    await waitFor(() => expect(sockets.length).toBe(1));
    unmount();
    expect(sockets[0].closed).toBe(true);
  });
});

describe('logs page: phone layout', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  const FACETS = [
    { field: 'level', values: [{ value: 'error', count: 3 }], otherCount: 0 },
    { field: 'service', values: [{ value: 'api', count: 5 }, { value: 'web', count: 2 }], otherCount: 0 },
  ];

  it('keeps the facets out of the page and shows stacked rows', async () => {
    h.getFacets.mockResolvedValue(FACETS);
    h.getLogs.mockResolvedValue(response(logsList(3)));
    await renderPage();
    await waitFor(() => expect(document.querySelectorAll('[data-log-row]').length).toBe(3));
    expect(screen.queryByRole('complementary', { name: 'Facets' })).toBeNull();
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compact rows' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.queryByTestId('filters-count')).toBeNull();
  });

  it('opens the filters panel, applies a facet, keeps the panel open and counts the clause', async () => {
    h.getFacets.mockResolvedValue(FACETS);
    await renderPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    await fireEvent.click(await within(panel).findByRole('button', { name: 'service api (5 logs)' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(2));
    expect(logsCall()).toMatchObject({ q: 'service:api' });
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    await fireEvent.click(within(panel).getByRole('button', { name: 'level error (3 logs)' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    await fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeInTheDocument();
    expect(screen.getByTestId('filters-count')).toHaveTextContent('2');
  });

  it('uses the short search placeholder', async () => {
    await renderPage();
    expect(queryInput().placeholder).toBe('Search logs');
  });
});

describe('logs page on a phone', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('renders no histogram and requests none, the count stays in the results header', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width: 767'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    h.getLogs.mockResolvedValue(response(logsList(3), { total: 3 }));
    await renderPage();
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledTimes(1));
    await settle();
    expect(h.getHistogram).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Log volume')).toBeNull();
    expect(screen.getAllByText('3 logs').length).toBeGreaterThan(0);
  });
});
