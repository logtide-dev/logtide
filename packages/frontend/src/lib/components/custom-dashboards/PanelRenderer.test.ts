import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { PanelInstance } from '@logtide/shared';

import PanelRenderer from './PanelRenderer.svelte';

const panel = {
  id: 'panel-a',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  config: {
    type: 'single_stat',
    title: 'Total Logs',
    source: 'logs',
    metric: 'total_logs',
    projectId: null,
    compareWithPrevious: false,
  },
} as PanelInstance;

function props(overrides: Record<string, unknown> = {}) {
  return {
    panel,
    data: null,
    loading: false,
    error: null,
    editMode: false,
    onRefresh: vi.fn(),
    paused: false,
    onTogglePause: vi.fn(),
    ...overrides,
  };
}

describe('PanelRenderer pause toggle', () => {
  it('renders the pause toggle and fires the callback', async () => {
    const onTogglePause = vi.fn();
    render(PanelRenderer, { props: props({ onTogglePause }) });

    await fireEvent.click(screen.getByTitle('Pause auto-refresh'));

    expect(onTogglePause).toHaveBeenCalledOnce();
  });

  it('shows the resume control and a paused indicator when paused', () => {
    render(PanelRenderer, { props: props({ paused: true }) });

    expect(screen.getByTitle('Resume auto-refresh')).toBeInTheDocument();
    expect(screen.queryByTitle('Pause auto-refresh')).toBeNull();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('hides the pause toggle in edit mode', () => {
    render(PanelRenderer, { props: props({ editMode: true }) });

    expect(screen.queryByTitle('Pause auto-refresh')).toBeNull();
    expect(screen.queryByTitle('Resume auto-refresh')).toBeNull();
  });

  it('omits the pause toggle when no handler is wired', () => {
    render(PanelRenderer, { props: props({ onTogglePause: undefined }) });

    expect(screen.queryByTitle('Pause auto-refresh')).toBeNull();
  });

  it('keeps the refresh button available while paused', async () => {
    const onRefresh = vi.fn();
    render(PanelRenderer, { props: props({ paused: true, onRefresh }) });

    await fireEvent.click(screen.getByTitle('Refresh'));

    expect(onRefresh).toHaveBeenCalledWith('panel-a');
  });
});

const linkedPanel = {
  id: 'panel-link',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  config: {
    type: 'single_stat',
    title: 'Error rate',
    source: 'logs',
    metric: 'error_rate',
    projectId: 'proj-1',
    compareWithPrevious: false,
  },
} as PanelInstance;

const systemStatusPanel = {
  id: 'panel-ss',
  layout: { x: 0, y: 0, w: 12, h: 2 },
  config: { type: 'system_status', title: 'System status', source: 'monitors', projectId: null },
} as unknown as PanelInstance;

describe('PanelRenderer drill-down link', () => {
  it('renders an Open in Logs link for a logs panel', () => {
    render(PanelRenderer, { props: props({ panel: linkedPanel }) });

    const link = screen.getByRole('link', { name: 'Open in Logs' }) as HTMLAnchorElement;
    const url = new URL(link.href, 'http://localhost');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('project')).toBe('proj-1');
    expect(url.searchParams.get('q')).toBe('level:(error OR critical)');
    expect(link.getAttribute('title')).toBe('Open in Logs');
  });

  it('uses the dashboard time range override in the link', () => {
    render(PanelRenderer, { props: props({ panel: linkedPanel, timeRangeOverride: '7d' }) });

    const link = screen.getByRole('link', { name: 'Open in Logs' }) as HTMLAnchorElement;
    expect(new URL(link.href, 'http://localhost').searchParams.get('range')).toBe('7d');
  });

  it('no link for system_status', () => {
    render(PanelRenderer, { props: props({ panel: systemStatusPanel }) });

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('no link in edit mode', () => {
    render(PanelRenderer, { props: props({ panel: linkedPanel, editMode: true }) });

    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('PanelRenderer icon buttons', () => {
  it('every icon button has an aria-label', () => {
    for (const editMode of [false, true]) {
      const { container, unmount } = render(PanelRenderer, {
        props: props({ panel: linkedPanel, editMode, onEdit: vi.fn(), onRemove: vi.fn() }),
      });
      const iconOnly = Array.from(container.querySelectorAll('button, a')).filter(
        (el) => (el.textContent ?? '').trim() === ''
      );
      expect(iconOnly.length).toBeGreaterThan(0);
      for (const el of iconOnly) {
        expect(el.getAttribute('aria-label'), el.outerHTML).toBeTruthy();
      }
      unmount();
    }
  });
});
