import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  class LogQueryError extends Error {
    position: number;
    constructor(message: string, position: number) {
      super(message);
      this.position = position;
    }
  }
  return { getLogs: vi.fn(), getHistogram: vi.fn(), getFacets: vi.fn(), LogQueryError };
});

vi.mock('$lib/api/logs', () => ({
  logsAPI: { getLogs: h.getLogs, getHistogram: h.getHistogram, getFacets: h.getFacets },
  LogQueryError: h.LogQueryError,
}));

// The histogram has its own tests; here it only has to mount.
vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), getZr: () => ({ on: vi.fn(), off: vi.fn() }), dispatchAction: vi.fn(), convertFromPixel: vi.fn(), containPixel: vi.fn() }),
}));

import SourceLogsTab from './SourceLogsTab.svelte';

const FROM = '2026-11-26T10:00:00.000Z';
const TO = '2026-11-26T11:00:00.000Z';

function log(id: string, extra: Record<string, unknown> = {}) {
  return { id, time: '2026-11-26T10:30:00.000Z', projectId: 'p1', service: 'checkout-api', level: 'info', message: `message ${id}`, ...extra };
}

function renderTab(kind: 'host' | 'service' = 'host', name = 'vps-app') {
  return render(SourceLogsTab, { props: { kind, name, projectIds: ['p1', 'p2'], from: FROM, to: TO } });
}

const lastQ = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.at(-1)?.[0]?.q as string;

beforeEach(() => {
  vi.resetAllMocks();
  h.getLogs.mockResolvedValue({ logs: [log('l1'), log('l2', { level: 'error', service: 'orders-service', traceId: 't1' })], nextCursor: undefined });
  h.getHistogram.mockResolvedValue({ buckets: [], bucketSeconds: 60, total: 2, from: FROM, to: TO });
  h.getFacets.mockResolvedValue({
    facets: [
      { field: 'level', values: [{ value: 'info', count: 40 }, { value: 'error', count: 3 }], otherCount: 0 },
      { field: 'service', values: [{ value: 'checkout-api', count: 30 }, { value: 'orders-service', count: 13 }], otherCount: 0 },
    ],
    sampleSize: null,
  });
});

describe('SourceLogsTab', () => {
  it('reads the logs of the host across its projects and the page window', async () => {
    renderTab();
    expect(await screen.findByText('message l1')).toBeTruthy();
    expect(h.getLogs.mock.calls[0][0]).toMatchObject({ projectId: ['p1', 'p2'], q: 'host:vps-app', from: FROM, to: TO });
    expect(h.getHistogram.mock.calls[0][0]).toMatchObject({ projectId: ['p1', 'p2'], q: 'host:vps-app', from: FROM, to: TO });
    expect(h.getFacets.mock.calls[0][0]).toMatchObject({ fields: ['level', 'service'] });
  });

  it('shows service, level and a trace marker on each row, linking to the log in the explorer', async () => {
    renderTab();
    const rows = await screen.findAllByTestId('source-log-row');
    expect(within(rows[1]).getByText('orders-service')).toBeTruthy();
    expect(within(rows[1]).getByText('error')).toBeTruthy();
    expect(within(rows[1]).getByLabelText('Has a trace')).toBeTruthy();
    const url = new URL(rows[0].getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('host:vps-app');
    expect(url.searchParams.get('logId')).toBe('l1');
  });

  it('filters by level and service with counts', async () => {
    renderTab();
    await screen.findByText('message l1');
    const levels = screen.getByRole('group', { name: 'Level' });
    const errorChip = within(levels).getByRole('button', { name: /Error\s*3/ });
    await fireEvent.click(errorChip);
    await waitFor(() => expect(lastQ(h.getLogs)).toBe('host:vps-app level:error'));
    expect(errorChip.getAttribute('aria-pressed')).toBe('true');

    const services = screen.getByRole('group', { name: 'Service' });
    await fireEvent.click(within(services).getByRole('button', { name: /orders-service\s*13/ }));
    await waitFor(() => expect(lastQ(h.getLogs)).toBe('host:vps-app level:error service:orders-service'));
    // Chip counts keep describing the whole source.
    expect(lastQ(h.getFacets)).toBe('host:vps-app');

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(lastQ(h.getLogs)).toBe('host:vps-app'));
  });

  it('has no service filter on a service page', async () => {
    renderTab('service', 'checkout-api');
    await screen.findByText('message l1');
    expect(screen.queryByRole('group', { name: 'Service' })).toBeNull();
    expect(h.getLogs.mock.calls[0][0].q).toBe('service:checkout-api');
    expect(h.getFacets.mock.calls[0][0].fields).toEqual(['level']);
  });

  it('searches the text on Enter', async () => {
    renderTab();
    await screen.findByText('message l1');
    const input = screen.getByLabelText('Search logs');
    await fireEvent.input(input, { target: { value: 'timeout' } });
    await fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(lastQ(h.getLogs)).toBe('host:vps-app timeout'));
  });

  it('loads more with the cursor', async () => {
    h.getLogs.mockResolvedValueOnce({ logs: [log('l1')], nextCursor: 'c1' }).mockResolvedValueOnce({ logs: [log('l3')] });
    renderTab();
    await screen.findByText('message l1');
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('message l3')).toBeTruthy();
    expect(h.getLogs.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: 'c1', q: 'host:vps-app' });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('explains an empty host and an invalid search', async () => {
    h.getLogs.mockResolvedValue({ logs: [] });
    renderTab();
    expect(await screen.findByText('No logs for this host')).toBeTruthy();

    h.getLogs.mockRejectedValue(new h.LogQueryError('Unexpected ")"', 3));
    const input = screen.getByLabelText('Search logs');
    await fireEvent.input(input, { target: { value: 'a)' } });
    await fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText(/The search is not valid/)).toBeTruthy();
  });

  it('Open in Logs carries the query and the window', async () => {
    renderTab();
    await screen.findByText('message l1');
    const url = new URL(screen.getByRole('link', { name: 'Open in Logs' }).getAttribute('href') ?? '', 'http://x');
    expect(url.searchParams.get('q')).toBe('host:vps-app');
  });
});
