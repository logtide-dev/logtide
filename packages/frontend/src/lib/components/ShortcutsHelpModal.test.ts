import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import ShortcutsHelpModal from './ShortcutsHelpModal.svelte';
import { shortcutsStore } from '$lib/stores/shortcuts';
import { formatKey } from '$lib/utils/keyboard';

describe('ShortcutsHelpModal', () => {
  beforeEach(() => {
    shortcutsStore.install();
    shortcutsStore.setScope('search');
    shortcutsStore.register([
      { id: 'search:r', combo: 'r', label: 'Refresh results', scope: 'search', category: 'search', action: () => {} },
      { id: 'search:1', combo: '1', label: 'Last hour', scope: 'search', category: 'time', action: () => {} },
      { id: 'traces:q', combo: 'q', label: 'Traces only action', scope: 'traces', category: 'actions', action: () => {} },
    ]);
  });

  afterEach(() => {
    shortcutsStore.closeHelpModal();
    shortcutsStore.setScope(null);
    shortcutsStore.unregister(['search:r', 'search:1', 'traces:q']);
    shortcutsStore.uninstall();
  });

  it('lists exactly the active shortcuts and nothing from other scopes', async () => {
    render(ShortcutsHelpModal);
    shortcutsStore.openHelpModal();

    const dialog = await screen.findByRole('dialog');
    const active = get(shortcutsStore.active).filter((s) => s.combo !== 'escape');
    const rows = Array.from(dialog.querySelectorAll('div.justify-between kbd'));

    expect(rows.length).toBe(active.length);
    const texts = rows.map((r) => r.textContent?.trim());
    expect([...texts].sort()).toEqual(active.map((s) => formatKey(s.combo)).sort());
    expect(screen.queryByText('Traces only action')).toBeNull();
    expect(screen.getByText('Refresh results')).toBeInTheDocument();
  });

  it('uses sentence case category headings and title', async () => {
    render(ShortcutsHelpModal);
    shortcutsStore.openHelpModal();
    await screen.findByRole('dialog');
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Search and filters')).toBeInTheDocument();
    expect(screen.getByText('Time ranges')).toBeInTheDocument();
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });
});
