import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/logs', () => ({ logsAPI: { createLogsWebSocket: vi.fn() } }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = vi.fn().mockResolvedValue({ projects: [] });
  },
}));

import AddPanelDialog from './AddPanelDialog.svelte';
import PanelConfigDialog from './PanelConfigDialog.svelte';
import type { LogTableConfig, PanelInstance } from '@logtide/shared';

// Regression: both dialogs render a list that grows with the number of panel
// types (add panel) or config fields (panel config). The dialog is fixed and
// vertically centered, so an unbounded body pushes the footer off-screen and
// the primary action becomes unreachable on laptop-height viewports.
// The body must be its own bounded scroll container so the footer stays put.
function scrollBody(container: HTMLElement): HTMLElement | null {
  return document.querySelector('[data-dialog-scroll-body]');
}

const logTablePanel: PanelInstance = {
  id: 'p1',
  layout: { x: 0, y: 0, w: 12, h: 4 },
  config: {
    type: 'log_table',
    title: 'WAN hits',
    source: 'logs',
    projectId: null,
    mode: 'snapshot',
    timeRange: '1h',
    levels: [],
    service: null,
    maxRows: 25,
    columns: ['http_host'],
    builtinColumns: ['time', 'level', 'service', 'message'],
    wrapCells: false,
  } as LogTableConfig,
};

describe('dashboard dialogs bound their body height', () => {
  it('AddPanelDialog scrolls its panel-type list instead of growing', () => {
    const { container } = render(AddPanelDialog, {
      props: { open: true, onAdd: vi.fn(), onOpenChange: vi.fn() },
    });

    const body = scrollBody(container);
    expect(body).not.toBeNull();
    expect(body!.className).toMatch(/overflow-y-auto/);
    expect(body!.className).toMatch(/max-h-\[/);
  });

  it('PanelConfigDialog scrolls its form instead of growing', () => {
    const { container } = render(PanelConfigDialog, {
      props: {
        open: true,
        panel: logTablePanel,
        onSave: vi.fn(),
        onOpenChange: vi.fn(),
      },
    });

    const body = scrollBody(container);
    expect(body).not.toBeNull();
    expect(body!.className).toMatch(/overflow-y-auto/);
    expect(body!.className).toMatch(/max-h-\[/);
  });
});
