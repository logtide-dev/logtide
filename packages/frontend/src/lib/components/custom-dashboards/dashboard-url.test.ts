import { describe, it, expect } from 'vitest';
import { PANEL_TIME_RANGES, TIME_RANGE_PRESETS } from '@logtide/shared';
import { readDashboardUrlState, writeDashboardUrlState } from './dashboard-url';

const ID = '3f2b8c1e-5d4a-4b7e-9a10-0c1d2e3f4a5b';

describe('dashboard-url', () => {
  it('reads id and range', () => {
    const s = readDashboardUrlState(new URL(`http://x/dashboard?id=${ID}&range=6h`));
    expect(s).toEqual({ id: ID, range: '6h' });
  });

  it('rejects non-uuid id', () => {
    expect(readDashboardUrlState(new URL('http://x/dashboard?id=abc')).id).toBeNull();
    expect(readDashboardUrlState(new URL('http://x/dashboard?id=../../etc')).id).toBeNull();
  });

  it('rejects unknown range key', () => {
    expect(readDashboardUrlState(new URL('http://x/dashboard?range=99y')).range).toBeNull();
    expect(readDashboardUrlState(new URL('http://x/dashboard?range=')).range).toBeNull();
  });

  it('ignores from and to', () => {
    const s = readDashboardUrlState(
      new URL('http://x/dashboard?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')
    );
    expect(s).toEqual({ id: null, range: null });
  });

  it('write removes id when null and keeps unrelated params', () => {
    const url = new URL(`http://x/dashboard?id=${ID}&range=1h&foo=bar`);
    const out = writeDashboardUrlState(url, { id: null, range: '1h' });
    expect(out.searchParams.has('id')).toBe(false);
    expect(out.searchParams.get('foo')).toBe('bar');
    expect(out.searchParams.get('range')).toBe('1h');
    // input is not mutated
    expect(url.searchParams.get('id')).toBe(ID);
  });

  it('write sets range', () => {
    const out = writeDashboardUrlState(new URL('http://x/dashboard'), { id: ID, range: '7d' });
    expect(out.searchParams.get('range')).toBe('7d');
    expect(out.searchParams.get('id')).toBe(ID);
    const cleared = writeDashboardUrlState(out, { id: ID, range: null });
    expect(cleared.searchParams.has('range')).toBe(false);
  });

  it('PANEL_TIME_RANGES equals TIME_RANGE_PRESETS from shared', () => {
    expect([...PANEL_TIME_RANGES]).toEqual([...TIME_RANGE_PRESETS]);
  });
});
