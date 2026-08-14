import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { createLogsWebSocket } = vi.hoisted(() => ({
  createLogsWebSocket: vi.fn(),
}));

vi.mock('$lib/api/logs', () => ({
  logsAPI: { createLogsWebSocket },
}));

import LogTablePanel from './LogTablePanel.svelte';
import { goto } from '$app/navigation';
import { displayPreferences } from '$lib/stores/display-preferences';
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

// -- live mode ---------------------------------------------------------------

class FakeWebSocket {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  emitLogs(logs: unknown[]) {
    this.onmessage?.({ data: JSON.stringify({ type: 'logs', logs }) });
  }
}

let wsSeq = 0;
function wsLog(overrides: Record<string, unknown> = {}) {
  wsSeq += 1;
  return {
    id: `log-${wsSeq}`,
    time: '2026-08-10T12:00:00.000Z',
    projectId: 'proj-1',
    service: 'caddy',
    level: 'info',
    message: 'GET /',
    metadata: { http_host: 'a.example.com', geo: { city: 'Rome' } },
    ...overrides,
  };
}

describe('LogTablePanel (live)', () => {
  it('resolves metadata columns from streamed logs', async () => {
    const fake = new FakeWebSocket();
    createLogsWebSocket.mockResolvedValue(fake);

    render(LogTablePanel, {
      props: {
        config: config({ mode: 'live', projectId: 'proj-1' }),
        data: null,
        loading: false,
        error: null,
      },
    });

    await vi.waitFor(() => expect(fake.onmessage).not.toBeNull());
    fake.emitLogs([wsLog({ id: 'live-1' })]);

    expect(await screen.findByText('a.example.com')).toBeInTheDocument();
    expect(screen.getByText('Rome')).toBeInTheDocument();
  });

  it('filters levels client-side', async () => {
    const fake = new FakeWebSocket();
    createLogsWebSocket.mockResolvedValue(fake);

    render(LogTablePanel, {
      props: {
        config: config({ mode: 'live', projectId: 'proj-1', levels: ['error'] }),
        data: null,
        loading: false,
        error: null,
      },
    });

    await vi.waitFor(() => expect(fake.onmessage).not.toBeNull());
    fake.emitLogs([
      wsLog({ id: 'live-info', message: 'kept out', level: 'info' }),
      wsLog({ id: 'live-err', message: 'kept in', level: 'error' }),
    ]);

    expect(await screen.findByText('kept in')).toBeInTheDocument();
    expect(screen.queryByText('kept out')).toBeNull();
  });

  it('caps the buffer at maxRows, newest first', async () => {
    const fake = new FakeWebSocket();
    createLogsWebSocket.mockResolvedValue(fake);

    const { container } = render(LogTablePanel, {
      props: {
        config: config({ mode: 'live', projectId: 'proj-1', maxRows: 10 }),
        data: null,
        loading: false,
        error: null,
      },
    });

    await vi.waitFor(() => expect(fake.onmessage).not.toBeNull());
    const logs = Array.from({ length: 15 }, (_, i) =>
      wsLog({ id: `live-cap-${i}`, message: `msg ${i}` })
    );
    fake.emitLogs(logs);

    // Newest (last emitted) first, buffer capped at 10
    expect(await screen.findByText('msg 14')).toBeInTheDocument();
    expect(screen.queryByText('msg 0')).toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(10);
    const firstRow = container.querySelector('tbody tr') as HTMLElement;
    expect(firstRow.textContent).toContain('msg 14');
  });

  it('closes the socket on unmount', async () => {
    const fake = new FakeWebSocket();
    createLogsWebSocket.mockResolvedValue(fake);

    const { unmount } = render(LogTablePanel, {
      props: {
        config: config({ mode: 'live', projectId: 'proj-1' }),
        data: null,
        loading: false,
        error: null,
      },
    });

    await vi.waitFor(() => expect(fake.onmessage).not.toBeNull());
    unmount();
    expect(fake.closed).toBe(true);
  });

  it('discards pushes while paused and keeps the socket open', async () => {
    const sockets: FakeWebSocket[] = [];
    createLogsWebSocket.mockImplementation(async () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    });
    const live = async () => {
      await vi.waitFor(() => expect(sockets.at(-1)?.onmessage).not.toBeNull());
      return sockets.at(-1)!;
    };

    const liveConfig = config({ mode: 'live', projectId: 'proj-1' });
    const base = { config: liveConfig, data: null, loading: false, error: null };
    const { container, rerender } = render(LogTablePanel, {
      props: { ...base, paused: false },
    });

    (await live()).emitLogs([wsLog({ id: 'live-before', message: 'before pause' })]);
    expect(await screen.findByText('before pause')).toBeInTheDocument();

    await rerender({ ...base, paused: true });
    const paused = await live();
    paused.emitLogs([wsLog({ id: 'live-paused', message: 'while paused' })]);
    await tick();

    // Dropped, and the rows captured before the pause stay frozen on screen.
    expect(screen.queryByText('while paused')).toBeNull();
    expect(screen.getByText('before pause')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    // The stream is still attached: pausing must not close the socket.
    expect(paused.closed).toBe(false);

    await rerender({ ...base, paused: false });
    (await live()).emitLogs([wsLog({ id: 'live-after', message: 'after resume' })]);

    expect(await screen.findByText('after resume')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('does not open a socket in snapshot mode', async () => {
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [] }, loading: false, error: null },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(createLogsWebSocket).not.toHaveBeenCalled();
  });
});

// -- display preferences (#297) ----------------------------------------------

describe('LogTablePanel time column honors display preferences', () => {
  afterEach(() => {
    displayPreferences.set({ hour12: false, timeZone: null });
  });

  it('renders a 24 hour clock in the selected timezone', () => {
    displayPreferences.set({ hour12: false, timeZone: 'UTC' });
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });
    expect(screen.getByText('12:00:00')).toBeInTheDocument();
  });

  it('switches to a 12 hour clock when the preference changes', async () => {
    displayPreferences.set({ hour12: false, timeZone: 'UTC' });
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });

    displayPreferences.set({ hour12: true, timeZone: 'UTC' });
    await tick();

    expect(screen.getByText('12:00:00 PM')).toBeInTheDocument();
  });

  it('applies an explicit timezone offset', () => {
    displayPreferences.set({ hour12: false, timeZone: 'America/Los_Angeles' });
    render(LogTablePanel, {
      props: { config: config(), data: { logs: [row] }, loading: false, error: null },
    });
    expect(screen.getByText('05:00:00')).toBeInTheDocument();
  });
});
