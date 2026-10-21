import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => gotoMock(...args) }));

import { shortcutsStore } from './shortcuts';
import { flatNavItems } from '$lib/nav/nav-items';

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

const EXPECTED: Record<string, string> = {
  'g d': '/dashboard',
  'g l': '/dashboard/logs',
  'g t': '/dashboard/traces',
  'g m': '/dashboard/metrics',
  'g e': '/dashboard/errors',
  'g s': '/dashboard/sessions',
  'g w': '/dashboard/web-vitals',
  'g i': '/dashboard/incidents',
  'g a': '/dashboard/alerts',
  'g u': '/dashboard/uptime',
  'g r': '/dashboard/security',
  'g p': '/dashboard/projects',
};

describe('shortcutsStore', () => {
  beforeEach(() => {
    gotoMock.mockReset();
    shortcutsStore.install();
  });

  afterEach(() => {
    shortcutsStore.closeCommandPalette();
    shortcutsStore.setScope(null);
    shortcutsStore.unregisterScope('search');
    shortcutsStore.unregisterScope('traces');
    shortcutsStore.uninstall();
    document.body.innerHTML = '';
  });

  it('registers a g shortcut for every nav item that declares one', () => {
    const navCombos = get(shortcutsStore.shortcuts)
      .filter((s) => s.category === 'navigation')
      .map((s) => s.combo);
    for (const combo of Object.keys(EXPECTED)) {
      expect(navCombos).toContain(combo);
    }
    const declared = flatNavItems()
      .filter((i) => i.shortcut)
      .map((i) => i.shortcut);
    expect([...navCombos].sort()).toEqual([...declared].sort());
  });

  it('does not register shortcuts the palette would not show', () => {
    const palette = new Set(flatNavItems().map((i) => i.shortcut).filter(Boolean));
    const navGlobals = get(shortcutsStore.shortcuts).filter(
      (s) => s.scope === 'global' && s.category === 'navigation' && s.combo.startsWith('g ')
    );
    for (const s of navGlobals) {
      expect(palette.has(s.combo) || s.combo === 'g x').toBe(true);
    }
  });

  it('navigates on a g sequence', () => {
    press('g');
    press('l');
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/logs');
  });

  it('navigates every spec sequence to its page', () => {
    for (const [combo, href] of Object.entries(EXPECTED)) {
      gotoMock.mockReset();
      const [a, b] = combo.split(' ');
      press(a);
      press(b);
      expect(gotoMock).toHaveBeenCalledWith(href);
    }
  });

  it('ignores g sequences while typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('g', input);
    press('l', input);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('ignores g sequences while the command palette is open', () => {
    shortcutsStore.openCommandPalette();
    press('g');
    press('l');
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('uninstall removes global shortcuts', () => {
    expect(get(shortcutsStore.shortcuts).some((s) => s.id.startsWith('global:'))).toBe(true);
    shortcutsStore.uninstall();
    expect(get(shortcutsStore.shortcuts).some((s) => s.id.startsWith('global:'))).toBe(false);
  });

  it('keeps page single keys independent of g', () => {
    const rAction = vi.fn();
    const jAction = vi.fn();
    shortcutsStore.setScope('search');
    shortcutsStore.register([
      { id: 'search:r', combo: 'r', label: 'Refresh', scope: 'search', category: 'search', action: rAction },
      { id: 'search:j', combo: 'j', label: 'Next', scope: 'search', category: 'search', action: jAction },
    ]);

    press('g');
    press('l');
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/logs');
    expect(rAction).not.toHaveBeenCalled();

    // g r is the security shortcut even while a page owns a bare r
    gotoMock.mockReset();
    press('g');
    press('r');
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/security');
    expect(rAction).not.toHaveBeenCalled();

    press('r');
    expect(rAction).toHaveBeenCalledTimes(1);
    press('j');
    expect(jAction).toHaveBeenCalledTimes(1);
  });

  it('mod+/ goes to /dashboard/logs when no search input exists', () => {
    press('/', document.body, { ctrlKey: true });
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/logs');
  });

  it('mod+/ focuses the search input when present', () => {
    const input = document.createElement('input');
    input.id = 'search';
    document.body.appendChild(input);
    press('/', document.body, { ctrlKey: true });
    expect(document.activeElement).toBe(input);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('grouped only holds the shortcuts active right now', () => {
    shortcutsStore.register({
      id: 'traces:x',
      combo: 'x',
      label: 'Traces only',
      scope: 'traces',
      category: 'actions',
      action: () => {},
    });
    let ids = Object.values(get(shortcutsStore.grouped))
      .flat()
      .map((s) => s.id);
    expect(ids).not.toContain('traces:x');
    shortcutsStore.setScope('traces');
    ids = Object.values(get(shortcutsStore.grouped))
      .flat()
      .map((s) => s.id);
    expect(ids).toContain('traces:x');
  });
});
