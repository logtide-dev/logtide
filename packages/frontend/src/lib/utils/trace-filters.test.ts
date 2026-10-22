import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseTraceFilters,
  writeTraceFilters,
  toListQuery,
  rememberTraceListState,
  readTraceListState,
} from './trace-filters';

const url = (qs: string) => new URL(`http://localhost/dashboard/traces${qs}`);

describe('trace filters url state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parseTraceFilters applies defaults', () => {
    expect(parseTraceFilters(url(''))).toEqual({
      sortBy: 'start_time',
      sortOrder: 'desc',
      page: 1,
      view: 'list',
    });
  });

  it('parseTraceFilters reads every param', () => {
    const f = parseTraceFilters(
      url('?service=api&operation=GET%20%2Fa&status=errors&minDuration=10&maxDuration=500&attr=a%3Ab&sortBy=duration&sortOrder=asc&page=3&view=map')
    );
    expect(f).toEqual({
      service: 'api',
      operation: 'GET /a',
      status: 'errors',
      minDuration: 10,
      maxDuration: 500,
      attr: 'a:b',
      sortBy: 'duration',
      sortOrder: 'asc',
      page: 3,
      view: 'map',
    });
  });

  it('parseTraceFilters drops invalid sortBy, negative durations and page 0', () => {
    const f = parseTraceFilters(
      url('?sortBy=foo&sortOrder=up&minDuration=-5&maxDuration=abc&page=0&status=weird&view=grid')
    );
    expect(f.sortBy).toBe('start_time');
    expect(f.sortOrder).toBe('desc');
    expect(f.minDuration).toBeUndefined();
    expect(f.maxDuration).toBeUndefined();
    expect(f.page).toBe(1);
    expect(f.status).toBeUndefined();
    expect(f.view).toBe('list');
    expect(parseTraceFilters(url('?page=2.5')).page).toBe(1);
  });

  it('parseTraceFilters keeps a legacy single service param', () => {
    expect(parseTraceFilters(url('?service=checkout')).service).toBe('checkout');
  });

  it('writeTraceFilters omits defaults', () => {
    const out = writeTraceFilters(url('?sortBy=duration&page=2&view=map'), {
      sortBy: 'start_time',
      sortOrder: 'desc',
      page: 1,
      view: 'list',
      service: undefined,
    });
    expect(out.search).toBe('');
  });

  it('writeTraceFilters writes non default values', () => {
    const out = writeTraceFilters(url(''), {
      status: 'ok',
      sortBy: 'duration',
      sortOrder: 'asc',
      page: 4,
      view: 'map',
      minDuration: 0,
    });
    const p = out.searchParams;
    expect(p.get('status')).toBe('ok');
    expect(p.get('sortBy')).toBe('duration');
    expect(p.get('sortOrder')).toBe('asc');
    expect(p.get('page')).toBe('4');
    expect(p.get('view')).toBe('map');
    expect(p.get('minDuration')).toBe('0');
  });

  it('service, operation and attr with spaces, quotes, colons and unicode round trip', () => {
    const input = {
      service: 'Checkout API',
      operation: 'POST /orders "v2": 100% done',
      attr: 'http.route:"/a b/ü" -user.name:"o\'brien"',
    };
    const written = writeTraceFilters(url(''), input);
    const parsed = parseTraceFilters(new URL(written.href));
    expect(parsed.service).toBe(input.service);
    expect(parsed.operation).toBe(input.operation);
    expect(parsed.attr).toBe(input.attr);
  });

  it('writeTraceFilters leaves project and range params untouched', () => {
    const base = url('?project=p1&range=7d&from=a&to=b&service=x');
    const out = writeTraceFilters(base, { service: undefined, page: 2 });
    expect(out.searchParams.get('project')).toBe('p1');
    expect(out.searchParams.get('range')).toBe('7d');
    expect(out.searchParams.get('from')).toBe('a');
    expect(out.searchParams.get('to')).toBe('b');
    expect(out.searchParams.has('service')).toBe(false);
  });

  it('toListQuery maps status errors to error=true and ok to false', () => {
    const range = { from: new Date('2026-10-22T10:00:00.000Z'), to: new Date('2026-10-22T11:00:00.000Z') };
    const base = parseTraceFilters(url(''));

    const errors = toListQuery({ ...base, status: 'errors' }, range, 'p1', 25);
    expect(errors.error).toBe(true);
    const ok = toListQuery({ ...base, status: 'ok' }, range, 'p1', 25);
    expect(ok.error).toBe(false);
    const all = toListQuery(base, range, 'p1', 25);
    expect(all.error).toBeUndefined();
  });

  it('toListQuery maps filters, range and paging', () => {
    const range = { from: new Date('2026-10-22T10:00:00.000Z'), to: new Date('2026-10-22T11:00:00.000Z') };
    const f = parseTraceFilters(
      url('?service=api&operation=op&minDuration=5&maxDuration=9&attr=a%3Ab&sortBy=duration&sortOrder=asc&page=3')
    );
    expect(toListQuery(f, range, 'p1', 25)).toEqual({
      projectId: 'p1',
      from: '2026-10-22T10:00:00.000Z',
      to: '2026-10-22T11:00:00.000Z',
      limit: 25,
      offset: 50,
      service: 'api',
      operation: 'op',
      minDurationMs: 5,
      maxDurationMs: 9,
      attr: 'a:b',
      sortBy: 'duration',
      sortOrder: 'asc',
    });
  });

  it('remembers and reads the list state', () => {
    rememberTraceListState('?project=p1&service=api');
    expect(readTraceListState()).toBe('?project=p1&service=api');
  });

  it('readTraceListState returns null when sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readTraceListState()).toBeNull();
    expect(() => rememberTraceListState('?a=b')).not.toThrow();
  });
});
