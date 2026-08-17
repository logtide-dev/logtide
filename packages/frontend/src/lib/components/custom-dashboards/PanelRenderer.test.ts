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
