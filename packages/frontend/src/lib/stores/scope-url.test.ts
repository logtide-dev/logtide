import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RANGE,
  readScopeFromUrl,
  writeScopeToUrl,
  resolveRange,
  legacyTimeRangeToRange,
  rangeToLegacyTimeRange,
  reconcileScope,
  sanitizeScope,
  rangesEqual,
  type Scope,
  type TimeRangeValue,
} from './scope-url.js';

const u = (qs: string) => new URL('http://x/dashboard/logs' + qs);
const preset = (p: any): TimeRangeValue => ({ kind: 'preset', preset: p });

describe('readScopeFromUrl', () => {
  it('reads project list and preset', () => {
    expect(readScopeFromUrl(u('?project=a,b&range=7d'))).toEqual({
      projectIds: ['a', 'b'],
      range: preset('7d'),
    });
  });

  it('reads legacy projectId and prefers project', () => {
    expect(readScopeFromUrl(u('?projectId=x')).projectIds).toEqual(['x']);
    expect(readScopeFromUrl(u('?projectId=x&project=y')).projectIds).toEqual(['y']);
  });

  it('trims, dedupes and ignores empty project entries', () => {
    expect(readScopeFromUrl(u('?project=a,,b, a ')).projectIds).toEqual(['a', 'b']);
    expect('projectIds' in readScopeFromUrl(u('?project='))).toBe(false);
  });

  it('custom range from ISO from and to', () => {
    const r = readScopeFromUrl(u('?from=2026-10-21T10:00:00.000Z&to=2026-10-21T11:00:00.000Z'));
    expect(r.range).toEqual({
      kind: 'custom',
      from: '2026-10-21T10:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
    });
    const off = readScopeFromUrl(u('?from=2026-10-21T10:00:00%2B02:00&to=2026-10-21T11:00:00Z'));
    expect((off.range as any).from).toBe('2026-10-21T08:00:00.000Z');
  });

  it('restores an unencoded plus offset', () => {
    const r = readScopeFromUrl(u('?from=2026-10-21T10:00:00+02:00&to=2026-10-21T11:00:00Z'));
    expect((r.range as any).from).toBe('2026-10-21T08:00:00.000Z');
  });

  it('ignores bad ranges', () => {
    expect(readScopeFromUrl(u('?range=bogus')).range).toBeUndefined();
    expect(readScopeFromUrl(u('?from=2026-10-21T10:00:00Z')).range).toBeUndefined();
    expect(
      readScopeFromUrl(u('?from=2026-10-21T12:00:00Z&to=2026-10-21T10:00:00Z')).range
    ).toBeUndefined();
    expect(readScopeFromUrl(u('?from=start-5min&to=end%2B5min')).range).toBeUndefined();
    expect(readScopeFromUrl(u('?from=2026&to=2027')).range).toBeUndefined();
  });

  it('range wins over from and to', () => {
    const r = readScopeFromUrl(
      u('?range=1h&from=2026-10-21T10:00:00Z&to=2026-10-21T11:00:00Z')
    );
    expect(r.range).toEqual(preset('1h'));
  });

  it('merges repeated project keys', () => {
    expect(readScopeFromUrl(u('?project=1&project=2')).projectIds).toEqual(['1', '2']);
  });
});

describe('writeScopeToUrl', () => {
  it('sets range and removes the other form', () => {
    const a = writeScopeToUrl(u('?from=a&to=b&q=1'), { range: preset('6h') });
    expect(a.searchParams.get('range')).toBe('6h');
    expect(a.searchParams.has('from')).toBe(false);
    expect(a.searchParams.has('to')).toBe(false);
    const b = writeScopeToUrl(u('?range=6h'), {
      range: { kind: 'custom', from: '2026-10-21T10:00:00.000Z', to: '2026-10-21T11:00:00.000Z' },
    });
    expect(b.searchParams.has('range')).toBe(false);
    expect(b.searchParams.get('from')).toBe('2026-10-21T10:00:00.000Z');
    expect(b.searchParams.get('to')).toBe('2026-10-21T11:00:00.000Z');
  });

  it('writes project joined by comma and empty deletes it', () => {
    expect(writeScopeToUrl(u(''), { projectIds: ['a', 'b'] }).searchParams.get('project')).toBe(
      'a,b'
    );
    expect(writeScopeToUrl(u('?project=a'), { projectIds: [] }).searchParams.has('project')).toBe(
      false
    );
  });

  it('preserves unrelated params and projectId', () => {
    const out = writeScopeToUrl(u('?q=x&level=error&service=s&logId=l&projectId=p'), {
      projectIds: ['a'],
      range: preset('1h'),
    });
    for (const k of ['q', 'level', 'service', 'logId', 'projectId']) {
      expect(out.searchParams.has(k)).toBe(true);
    }
    expect(out.searchParams.get('projectId')).toBe('p');
  });

  it('leaves keys not in the partial untouched and does not mutate input', () => {
    const input = u('?project=a&range=1h');
    const before = input.href;
    const out = writeScopeToUrl(input, { range: preset('7d') });
    expect(input.href).toBe(before);
    expect(out.searchParams.get('project')).toBe('a');
  });
});

describe('resolveRange', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('preset', () => {
    const r = resolveRange(preset('1h'), now);
    expect(r.from.toISOString()).toBe('2026-10-21T11:00:00.000Z');
    expect(r.to).toBe(now);
  });
  it('custom passes through', () => {
    const r = resolveRange(
      { kind: 'custom', from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T06:00:00.000Z' },
      now
    );
    expect(r.from.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });
  it('inverted custom falls back to 24h', () => {
    const r = resolveRange(
      { kind: 'custom', from: '2026-10-20T06:00:00.000Z', to: '2026-10-20T00:00:00.000Z' },
      now
    );
    expect(r.to).toBe(now);
    expect(r.to.getTime() - r.from.getTime()).toBe(86400000);
  });
});

describe('legacy mapping', () => {
  it('maps legacy types', () => {
    expect(legacyTimeRangeToRange({ type: 'last_hour', from: '', to: '' })).toEqual(preset('1h'));
    expect(legacyTimeRangeToRange({ type: 'last_24h', from: '', to: '' })).toEqual(preset('24h'));
    expect(legacyTimeRangeToRange({ type: 'last_7d', from: '', to: '' })).toEqual(preset('7d'));
  });
  it('maps custom local strings to ISO', () => {
    const r = legacyTimeRangeToRange({
      type: 'custom',
      from: '2026-07-01T00:00',
      to: '2026-07-02T00:00',
    });
    expect(r).toEqual({
      kind: 'custom',
      from: new Date('2026-07-01T00:00').toISOString(),
      to: new Date('2026-07-02T00:00').toISOString(),
    });
  });
  it('rejects unknown and inverted', () => {
    expect(legacyTimeRangeToRange({ type: 'nope', from: '', to: '' })).toBeNull();
    expect(
      legacyTimeRangeToRange({ type: 'custom', from: '2026-07-02T00:00', to: '2026-07-01T00:00' })
    ).toBeNull();
    expect(legacyTimeRangeToRange({ type: 'custom', from: '', to: '' })).toBeNull();
  });
  it('round trips', () => {
    for (const t of ['last_hour', 'last_24h', 'last_7d']) {
      const r = legacyTimeRangeToRange({ type: t, from: '', to: '' })!;
      expect(rangeToLegacyTimeRange(r)).toEqual({ type: t, from: '', to: '' });
    }
    expect(rangeToLegacyTimeRange(preset('6h'))).toEqual({ type: '6h', from: '', to: '' });
    expect(legacyTimeRangeToRange({ type: '6h', from: '', to: '' })).toEqual(preset('6h'));
    const c = legacyTimeRangeToRange({
      type: 'custom',
      from: '2026-07-01T03:15',
      to: '2026-07-02T04:30',
    })!;
    expect(rangeToLegacyTimeRange(c)).toEqual({
      type: 'custom',
      from: '2026-07-01T03:15',
      to: '2026-07-02T04:30',
    });
  });
});

describe('sanitizeScope', () => {
  it('accepts valid and rejects garbage', () => {
    expect(sanitizeScope({ projectIds: ['a'], range: preset('1h') })).toEqual({
      projectIds: ['a'],
      range: preset('1h'),
    });
    expect(sanitizeScope({ projectIds: 'x' })).toBeNull();
    expect(sanitizeScope({ projectIds: [1], range: {} })).toBeNull();
    expect(sanitizeScope(null)).toBeNull();
    expect(sanitizeScope({ projectIds: [], range: { kind: 'preset', preset: 'zz' } })).toBeNull();
  });
});

describe('reconcileScope', () => {
  const stored = (ids: string[], range: TimeRangeValue = DEFAULT_RANGE): Scope => ({
    projectIds: ids,
    range,
  });
  const projs = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('url wins over stored', () => {
    const r = reconcileScope({
      stored: stored(['p1'], preset('1h')),
      url: u('?project=p2&range=7d'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.effective).toEqual(stored(['p2'], preset('7d')));
    expect(r.commit).toEqual(r.effective);
    expect(r.url).toBeNull();
  });

  it('stored fills missing parts and url is non-null', () => {
    const r = reconcileScope({
      stored: stored(['p1'], preset('1h')),
      url: u('?q=a'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.effective).toEqual(stored(['p1'], preset('1h')));
    expect(r.url).not.toBeNull();
    expect(r.url!.searchParams.get('project')).toBe('p1');
    expect(r.url!.searchParams.get('range')).toBe('1h');
    expect(r.url!.searchParams.get('q')).toBe('a');
  });

  it('drops foreign ids when projects are loaded', () => {
    const r = reconcileScope({
      stored: stored(['zz', 'p1']),
      url: u(''),
      projects: projs,
      mode: 'multi',
    });
    expect(r.effective.projectIds).toEqual(['p1']);
  });

  it('full set normalises to empty in multi', () => {
    const r = reconcileScope({
      stored: stored(['p1', 'p2', 'p3']),
      url: u(''),
      projects: projs,
      mode: 'multi',
    });
    expect(r.effective.projectIds).toEqual([]);
    expect(r.url!.searchParams.get('project')).toBe('all');
  });

  it('single falls back to the first project', () => {
    for (const ids of [[], ['zz']]) {
      const r = reconcileScope({
        stored: stored(ids),
        url: u(''),
        projects: projs,
        mode: 'single',
      });
      expect(r.effective.projectIds).toEqual(['p1']);
      expect(r.url!.searchParams.get('project')).toBe('p1');
    }
  });

  it('single uses the first valid stored id when url has none valid', () => {
    const r = reconcileScope({
      stored: stored(['zz', 'p3']),
      url: u('?project=nope'),
      projects: projs,
      mode: 'single',
    });
    expect(r.effective.projectIds).toEqual(['p3']);
  });

  it('single keeps the stored multi array when its first id is valid', () => {
    const r = reconcileScope({
      stored: stored(['p1', 'p2']),
      url: u(''),
      projects: projs,
      mode: 'single',
    });
    expect(r.effective.projectIds).toEqual(['p1']);
    expect(r.commit.projectIds).toEqual(['p1', 'p2']);
  });

  it('unloaded projects keep ids in multi and truncate in single', () => {
    const multi = reconcileScope({
      stored: stored(['a', 'b']),
      url: u(''),
      projects: [],
      mode: 'multi',
    });
    expect(multi.effective.projectIds).toEqual(['a', 'b']);
    const single = reconcileScope({
      stored: stored(['a', 'b']),
      url: u(''),
      projects: [],
      mode: 'single',
    });
    expect(single.effective.projectIds).toEqual(['a']);
    expect(single.commit.projectIds).toEqual(['a', 'b']);
  });

  it('preset outside presets falls back', () => {
    const r = reconcileScope({
      stored: stored([], preset('6h')),
      url: u('?range=30d'),
      projects: projs,
      mode: 'multi',
      presets: ['1h', '6h'],
    });
    expect(r.effective.range).toEqual(preset('6h'));
    const r2 = reconcileScope({
      stored: stored([], preset('30d')),
      url: u('?range=14d'),
      projects: projs,
      mode: 'multi',
      presets: ['1h', '6h'],
    });
    expect(r2.effective.range).toEqual(preset('1h'));
    const r3 = reconcileScope({
      stored: stored([], preset('30d')),
      url: u(''),
      projects: projs,
      mode: 'multi',
      presets: ['1h', '24h'],
    });
    expect(r3.effective.range).toEqual(preset('24h'));
  });

  it('already canonical url gives null', () => {
    const r = reconcileScope({
      stored: stored(['p1', 'p2'], preset('1h')),
      url: u('?project=p1,p2&range=1h&q=z'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.url).toBeNull();
    expect(rangesEqual(r.effective.range, preset('1h'))).toBe(true);
  });
});

describe('scope links and fallbacks (UI-1, UI-2, UI-4)', () => {
  const sc = (ids: string[], range: TimeRangeValue = DEFAULT_RANGE): Scope => ({
    projectIds: ids,
    range,
  });
  const projs = [{ id: 'p1' }, { id: 'p2' }];

  it('project=all reads as an explicit empty selection', () => {
    expect(readScopeFromUrl(u('?project=all')).projectIds).toEqual([]);
    expect(readScopeFromUrl(u('?project=all,p1')).projectIds).toEqual(['p1']);
    expect('projectIds' in readScopeFromUrl(u(''))).toBe(false);
  });

  it('explicitAll writes project=all for an empty selection only on request', () => {
    expect(writeScopeToUrl(u(''), { projectIds: [] }).searchParams.has('project')).toBe(false);
    const url = writeScopeToUrl(u('?project=p1'), { projectIds: [] }, { explicitAll: true });
    expect(url.searchParams.get('project')).toBe('all');
    expect(readScopeFromUrl(url).projectIds).toEqual([]);
  });

  it('a pre-fill link does not read projectId as scope', () => {
    expect(readScopeFromUrl(u('?create=1&projectId=p9')).projectIds).toBeUndefined();
    expect(readScopeFromUrl(u('?new=1&projectId=p9')).projectIds).toBeUndefined();
    expect(readScopeFromUrl(u('?create=1&project=p2&projectId=p9')).projectIds).toEqual(['p2']);
  });

  it('a single-project page does not persist its first-project fallback', () => {
    const r = reconcileScope({ stored: sc([]), url: u(''), projects: projs, mode: 'single' });
    expect(r.effective.projectIds).toEqual(['p1']);
    expect(r.commit.projectIds).toEqual([]);
    const multi = reconcileScope({
      stored: sc(['x', 'p2']),
      url: u(''),
      projects: projs,
      mode: 'single',
    });
    expect(multi.effective.projectIds).toEqual(['p2']);
    expect(multi.commit.projectIds).toEqual(['x', 'p2']);
  });

  it('a page preset fallback is not persisted, a url range is', () => {
    const r = reconcileScope({
      stored: sc([], preset('1h')),
      url: u(''),
      projects: projs,
      mode: 'multi',
      presets: ['24h', '7d'],
    });
    expect(r.effective.range).toEqual(preset('24h'));
    expect(r.commit.range).toEqual(preset('1h'));
    const fromUrl = reconcileScope({
      stored: sc([], preset('1h')),
      url: u('?range=7d'),
      projects: projs,
      mode: 'multi',
      presets: ['24h', '7d'],
    });
    expect(fromUrl.commit.range).toEqual(preset('7d'));
  });

  it('project=all beats the remembered project in multi mode', () => {
    const r = reconcileScope({
      stored: sc(['p1']),
      url: u('?project=all'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.effective.projectIds).toEqual([]);
    expect(r.commit.projectIds).toEqual([]);
  });

  it('a link with only foreign ids does not overwrite the remembered project', () => {
    const r = reconcileScope({
      stored: sc(['p1']),
      url: u('?project=zz'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.commit.projectIds).toEqual(['p1']);
  });

  it('the canonical url carries the scope and drops legacy projectId', () => {
    const r = reconcileScope({
      stored: sc([], preset('1h')),
      url: u('?projectId=p1&range=1h'),
      projects: projs,
      mode: 'multi',
    });
    expect(r.url!.searchParams.get('project')).toBe('p1');
    expect(r.url!.searchParams.has('projectId')).toBe(false);
  });

  it('the canonical url keeps legacy projectId on log and create links', () => {
    const log = reconcileScope({
      stored: sc([]),
      url: u('?logId=l1&projectId=p1'),
      projects: projs,
      mode: 'multi',
    });
    expect(log.url!.searchParams.get('projectId')).toBe('p1');
  });

  it('write options leave out a part the bar does not show', () => {
    const r = reconcileScope({
      stored: sc(['p1'], preset('1h')),
      url: u(''),
      projects: projs,
      mode: 'multi',
      write: { range: false },
    });
    expect(r.url!.searchParams.get('project')).toBe('p1');
    expect(r.url!.searchParams.has('range')).toBe(false);
  });
});
