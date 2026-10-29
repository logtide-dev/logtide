import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerPaletteProvider,
  listPaletteProviders,
  loadPaletteGroups,
  clearPaletteCache,
} from './registry';
import type { PaletteContext, PaletteItem, PaletteProvider } from './types';

const item = (id: string): PaletteItem => ({ id, label: id });
const ctx = (org: string | null = 'org-a', signal = new AbortController().signal): PaletteContext => ({
  organizationId: org,
  projectId: null,
  signal,
});

let disposers: (() => void)[] = [];
function add(p: PaletteProvider) {
  disposers.push(registerPaletteProvider(p));
}

describe('palette registry', () => {
  beforeEach(() => {
    clearPaletteCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    disposers.forEach((d) => d());
    disposers = [];
  });

  it('orders providers by order', () => {
    add({ id: 'c', heading: 'C', order: 30, items: () => [] });
    add({ id: 'a', heading: 'A', order: 10, items: () => [] });
    add({ id: 'b', heading: 'B', order: 20, items: () => [] });
    expect(listPaletteProviders().map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a provider registered twice under one id', async () => {
    add({ id: 'x', heading: 'First', order: 10, items: () => [item('1')] });
    add({ id: 'x', heading: 'Second', order: 10, items: () => [item('2')] });
    expect(listPaletteProviders()).toHaveLength(1);
    const groups = await loadPaletteGroups(ctx());
    expect(groups[0].heading).toBe('Second');
    expect(groups[0].items[0].id).toBe('2');
  });

  it('returns a working unregister function that ignores a replaced registration', () => {
    const off = registerPaletteProvider({ id: 'x', heading: 'First', order: 10, items: () => [] });
    add({ id: 'x', heading: 'Second', order: 10, items: () => [] });
    off();
    expect(listPaletteProviders().map((p) => p.heading)).toEqual(['Second']);
  });

  it('returns healthy groups when one provider rejects', async () => {
    add({ id: 'ok', heading: 'Ok', order: 10, items: () => [item('a')] });
    add({
      id: 'bad',
      heading: 'Bad',
      order: 20,
      items: async () => {
        throw new Error('500');
      },
    });
    const groups = await loadPaletteGroups(ctx());
    expect(groups.find((g) => g.provider === 'ok')!.items).toHaveLength(1);
    const bad = groups.find((g) => g.provider === 'bad')!;
    expect(bad.failed).toBe(true);
    expect(bad.items).toEqual([]);
  });

  it('gives up on a provider after 4 seconds', async () => {
    vi.useFakeTimers();
    add({ id: 'ok', heading: 'Ok', order: 10, items: () => [item('a')] });
    add({ id: 'slow', heading: 'Slow', order: 20, items: () => new Promise<PaletteItem[]>(() => {}) });
    const pending = loadPaletteGroups(ctx());
    await vi.advanceTimersByTimeAsync(4001);
    const groups = await pending;
    expect(groups.find((g) => g.provider === 'ok')!.items).toHaveLength(1);
    expect(groups.find((g) => g.provider === 'slow')!.failed).toBe(true);
  });

  it('caches per provider and organization for ttlMs', async () => {
    const items = vi.fn(() => [item('a')]);
    add({ id: 'c', heading: 'C', order: 10, ttlMs: 60000, items });
    await loadPaletteGroups(ctx('org-a'));
    await loadPaletteGroups(ctx('org-a'));
    expect(items).toHaveBeenCalledTimes(1);
    await loadPaletteGroups(ctx('org-b'));
    expect(items).toHaveBeenCalledTimes(2);
  });

  it('does not cache when ttlMs is 0', async () => {
    const items = vi.fn(() => [item('a')]);
    add({ id: 'c', heading: 'C', order: 10, ttlMs: 0, items });
    await loadPaletteGroups(ctx());
    await loadPaletteGroups(ctx());
    expect(items).toHaveBeenCalledTimes(2);
  });

  it('expires the cache after ttlMs', async () => {
    vi.useFakeTimers();
    const items = vi.fn(() => [item('a')]);
    add({ id: 'c', heading: 'C', order: 10, ttlMs: 1000, items });
    await loadPaletteGroups(ctx());
    vi.setSystemTime(Date.now() + 1500);
    await loadPaletteGroups(ctx());
    expect(items).toHaveBeenCalledTimes(2);
  });

  it('never returns items of a previous organization', async () => {
    let resolveA!: (v: PaletteItem[]) => void;
    add({
      id: 'e',
      heading: 'E',
      order: 10,
      needsOrganization: true,
      items: (c) =>
        c.organizationId === 'org-a'
          ? new Promise<PaletteItem[]>((r) => (resolveA = r))
          : Promise.resolve([item('b-item')]),
    });

    const controllerA = new AbortController();
    const loadA = loadPaletteGroups(ctx('org-a', controllerA.signal));

    // The organization switches: the old load is aborted, the new one resolves first.
    controllerA.abort();
    const groupsB = await loadPaletteGroups(ctx('org-b'));
    expect(groupsB[0].items.map((i) => i.id)).toEqual(['b-item']);

    // The late org A answer arrives.
    resolveA([item('a-item')]);
    const groupsA = await loadA;
    expect(groupsA[0].items).toEqual([]);

    // It was not cached under org B, nor under org A.
    const again = await loadPaletteGroups(ctx('org-b'));
    expect(again[0].items.map((i) => i.id)).toEqual(['b-item']);
  });

  it('skips providers that need an organization when none is selected', async () => {
    const items = vi.fn(() => [item('a')]);
    add({ id: 'needs', heading: 'Needs', order: 10, needsOrganization: true, items });
    add({ id: 'free', heading: 'Free', order: 20, items: () => [item('b')] });
    const groups = await loadPaletteGroups(ctx(null));
    expect(items).not.toHaveBeenCalled();
    expect(groups.map((g) => g.provider)).toEqual(['free']);
  });

  it('caps each group at 50 items', async () => {
    add({
      id: 'many',
      heading: 'Many',
      order: 10,
      items: () => Array.from({ length: 80 }, (_, i) => item(`i${i}`)),
    });
    const groups = await loadPaletteGroups(ctx());
    expect(groups[0].items).toHaveLength(50);
  });
});
