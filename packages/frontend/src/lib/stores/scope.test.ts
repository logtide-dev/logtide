import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

async function fresh() {
  vi.resetModules();
  return await import('./scope.js');
}

const p = (preset: any) => ({ kind: 'preset' as const, preset });

describe('scopeStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults when storage is empty', async () => {
    const { scopeStore } = await fresh();
    expect(scopeStore.get()).toEqual({ projectIds: [], range: p('24h') });
  });

  it('persists and reloads', async () => {
    const a = await fresh();
    a.scopeStore.setProjects(['p1']);
    a.scopeStore.setRange(p('6h'));
    const b = await fresh();
    expect(b.scopeStore.get()).toEqual({ projectIds: ['p1'], range: p('6h') });
  });

  it('corrupt JSON, wrong shapes and non-string ids fall back to defaults', async () => {
    for (const raw of ['{', '{"projectIds":"x"}', '{"projectIds":[1],"range":{}}']) {
      localStorage.setItem('logtide_scope', raw);
      const { scopeStore } = await fresh();
      expect(scopeStore.get()).toEqual({ projectIds: [], range: p('24h') });
    }
  });

  it('survives blocked localStorage on write', async () => {
    const { scopeStore } = await fresh();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const seen: any[] = [];
    const unsub = scopeStore.subscribe((s) => seen.push(s));
    expect(() => scopeStore.setProjects(['x'])).not.toThrow();
    expect(scopeStore.get().projectIds).toEqual(['x']);
    expect(seen[seen.length - 1].projectIds).toEqual(['x']);
    unsub();
  });

  it('survives getItem throwing at load', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { scopeStore } = await fresh();
    expect(scopeStore.get()).toEqual({ projectIds: [], range: p('24h') });
  });

  it('migrates legacy keys once and leaves them in place', async () => {
    localStorage.setItem('logtide_current_project', 'p9');
    localStorage.setItem(
      'logtide_time_range',
      JSON.stringify({ type: 'last_hour', from: '', to: '' })
    );
    const { scopeStore } = await fresh();
    expect(scopeStore.get()).toEqual({ projectIds: ['p9'], range: p('1h') });
    expect(localStorage.getItem('logtide_current_project')).toBe('p9');
    expect(localStorage.getItem('logtide_time_range')).not.toBeNull();
  });

  it('ignores garbage legacy values', async () => {
    localStorage.setItem('logtide_current_project', '   ');
    localStorage.setItem('logtide_time_range', '{nope');
    const { scopeStore } = await fresh();
    expect(scopeStore.get()).toEqual({ projectIds: [], range: p('24h') });
    localStorage.setItem('logtide_time_range', JSON.stringify({ type: 'wat', from: '', to: '' }));
    const again = await fresh();
    expect(again.scopeStore.get().range).toEqual(p('24h'));
  });

  it('prefers logtide_scope over legacy keys', async () => {
    localStorage.setItem('logtide_current_project', 'old');
    localStorage.setItem('logtide_scope', JSON.stringify({ projectIds: ['new'], range: p('7d') }));
    const { scopeStore } = await fresh();
    expect(scopeStore.get()).toEqual({ projectIds: ['new'], range: p('7d') });
  });

  it('no-op set does not notify', async () => {
    const { scopeStore } = await fresh();
    const fn = vi.fn();
    const unsub = scopeStore.subscribe(fn);
    scopeStore.set({ projectIds: [], range: p('24h') });
    scopeStore.setProjects([]);
    scopeStore.setRange(p('24h'));
    expect(fn).toHaveBeenCalledTimes(1);
    scopeStore.setRange(p('1h'));
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('applyUrl merges url parts and keeps the rest', async () => {
    const { scopeStore } = await fresh();
    scopeStore.set({ projectIds: ['a'], range: p('1h') });
    scopeStore.applyUrl(new URL('http://x/dashboard/logs?range=7d'));
    expect(scopeStore.get()).toEqual({ projectIds: ['a'], range: p('7d') });
    scopeStore.applyUrl(new URL('http://x/dashboard/logs?project=b,c'));
    expect(scopeStore.get()).toEqual({ projectIds: ['b', 'c'], range: p('7d') });
  });

  it('reset restores defaults and clears the key', async () => {
    const { scopeStore } = await fresh();
    scopeStore.set({ projectIds: ['a'], range: p('1h') });
    expect(localStorage.getItem('logtide_scope')).not.toBeNull();
    scopeStore.reset();
    expect(scopeStore.get()).toEqual({ projectIds: [], range: p('24h') });
    expect(localStorage.getItem('logtide_scope')).toBeNull();
  });
});

describe('scopeStore effective vs persisted', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reconcile shows the fallback but persists only the commit', async () => {
    const { scopeStore } = await fresh();
    scopeStore.reconcile({ projectIds: [], range: p('1h') }, { projectIds: ['p1'], range: p('24h') });
    expect(scopeStore.get()).toEqual({ projectIds: ['p1'], range: p('24h') });
    expect(scopeStore.getPersisted()).toEqual({ projectIds: [], range: p('1h') });
    expect(JSON.parse(localStorage.getItem('logtide_scope')!)).toEqual({
      projectIds: [],
      range: p('1h'),
    });
    const b = await fresh();
    expect(b.scopeStore.get()).toEqual({ projectIds: [], range: p('1h') });
  });

  it('clearEffective returns to the persisted scope and notifies', async () => {
    const { scopeStore } = await fresh();
    scopeStore.reconcile({ projectIds: [], range: p('1h') }, { projectIds: ['p1'], range: p('1h') });
    const seen: string[][] = [];
    const unsub = scopeStore.subscribe((s) => seen.push(s.projectIds));
    scopeStore.clearEffective();
    expect(scopeStore.get().projectIds).toEqual([]);
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });

  it('a user choice persists its part and leaves the other fallback alone', async () => {
    const { scopeStore } = await fresh();
    scopeStore.reconcile({ projectIds: [], range: p('1h') }, { projectIds: [], range: p('24h') });
    scopeStore.setProjects(['p2']);
    expect(scopeStore.getPersisted()).toEqual({ projectIds: ['p2'], range: p('1h') });
    expect(scopeStore.get()).toEqual({ projectIds: ['p2'], range: p('24h') });
    scopeStore.setRange(p('7d'));
    expect(scopeStore.getPersisted().range).toEqual(p('7d'));
  });
});
