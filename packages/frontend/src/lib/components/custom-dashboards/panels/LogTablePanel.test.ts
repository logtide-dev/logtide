import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { createLogsWebSocket } = vi.hoisted(() => ({
  createLogsWebSocket: vi.fn(),
}));

vi.mock('$lib/api/logs', () => ({
  logsAPI: { createLogsWebSocket },
}));

import LogTablePanel from './LogTablePanel.svelte';
import { goto } from '$app/navigation';
import type { LogTableConfig } from '@logtide/shared';

function config(overrides: Partial<LogTableConfig> = {}): LogTableConfig {
  return {
    type: 'log_table',
    title: 'WAN hits',
    source: 'logs',
    projectId: null,
    mode: 'snapshot',
    timeRange: '1h',
    levels: [],
    service: null,
    maxRows: 25,
    columns: ['http_host', 'geo.city'],
    builtinColumns: ['time', 'level', 'service', 'message'],
    wrapCells: false,
    ...overrides,
  };
}

const row = {
  id: 'log-1',
  projectId: 'proj-1',
  time: '2026-08-10T12:00:00.000Z',
  level: 'error',
  service: 'caddy',
  message: 'GET /admin',
  cells: ['a.example.com', null] as (string | null)[],
};

beforeEach(() => {
  createLogsWebSocket.mockReset();
});

describe('LogTablePanel (snapshot)', () => {
  it('renders built-in and metadata column headers', () => {
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });
    for (const header of ['Time', 'Level', 'Service', 'Message', 'http_host', 'geo.city']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('renders cell values and a placeholder for null cells', () => {
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });
    expect(screen.getByText('a.example.com')).toBeInTheDocument();
    expect(screen.getByText('GET /admin')).toBeInTheDocument();
    // null cell placeholder
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('omits deselected built-in columns', () => {
    render(LogTablePanel, {
      props: {
        config: config({ builtinColumns: ['time', 'message'] }),
        data: { logs: [row] },
        loading: false,
        error: null,
      },
    });
    expect(screen.queryByText('Level')).toBeNull();
    expect(screen.queryByText('Service')).toBeNull();
  });

  it('shows an empty state without rows', () => {
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [] }, loading: false, error: null },
    });
    expect(screen.getByText('No logs in range')).toBeInTheDocument();
  });

  it('navigates to search context on row click', async () => {
    const { container } = render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });
    (container.querySelector('tbody tr') as HTMLElement).click();
    expect(goto).toHaveBeenCalledWith('/dashboard/search?logId=log-1&projectId=proj-1');
  });

  it('applies wrap classes when wrapCells is on', () => {
    const { container } = render(LogTablePanel, {
      props: { config: config({ wrapCells: true }), data: { logs: [row] }, loading: false, error: null },
    });
    expect(container.querySelector('td.whitespace-pre-wrap')).not.toBeNull();
    expect(container.querySelector('td.truncate')).toBeNull();
  });
});
