import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import type { PanelInstance } from '@logtide/shared';
import DashboardContainer from './DashboardContainer.svelte';

function panel(id: string, title: string, y: number): PanelInstance {
  return {
    id,
    layout: { x: 0, y, w: 3, h: 2 },
    config: {
      type: 'single_stat',
      title,
      source: 'logs',
      metric: 'total_logs',
      projectId: null,
      compareWithPrevious: false,
    },
  } as PanelInstance;
}

describe('DashboardContainer', () => {
  it('grid style does not use dense auto-flow', () => {
    const { container } = render(DashboardContainer, {
      props: { panels: [panel('a', 'Alpha', 0)], panelData: {}, editMode: false },
    });
    const grid = container.querySelector('div.grid') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute('style')).not.toMatch(/dense/);
  });

  it('renders panels in the given order, whatever their stored y', () => {
    const { container } = render(DashboardContainer, {
      props: {
        // Stored y values are deliberately out of order: array order wins.
        panels: [panel('a', 'Alpha', 9), panel('b', 'Bravo', 0), panel('c', 'Charlie', 4)],
        panelData: {},
        editMode: false,
      },
    });
    const titles = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(titles).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('passes the dashboard time range override to the panel drill-down links', () => {
    const linked = {
      id: 't',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      config: {
        type: 'single_stat',
        title: 'Total logs',
        source: 'logs',
        metric: 'total_logs',
        projectId: null,
        compareWithPrevious: false,
      },
    } as PanelInstance;
    const { getByLabelText } = render(DashboardContainer, {
      props: { panels: [linked], panelData: {}, editMode: false, timeRangeOverride: '7d' },
    });
    const link = getByLabelText('Open in Logs') as HTMLAnchorElement;
    expect(new URL(link.href, 'http://localhost').searchParams.get('range')).toBe('7d');
  });
});
