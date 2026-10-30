import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/traces', () => ({
  tracesAPI: { getSpanLogs: vi.fn() },
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tracesAPI } from '$lib/api/traces';
import SpanLogsTab from './SpanLogsTab.svelte';

const getSpanLogs = vi.mocked(tracesAPI.getSpanLogs);

const span = { span_id: 's1', start_time: '2026-10-22T10:00:00.000Z', end_time: '2026-10-22T10:00:01.000Z' } as any;
const trace = {
  trace_id: 't1',
  start_time: '2026-10-22T10:00:00.000Z',
  end_time: '2026-10-22T10:00:02.000Z',
} as any;

beforeEach(() => {
  getSpanLogs.mockReset();
});

describe('SpanLogsTab', () => {
  it('fetches span logs with the padded trace window', async () => {
    getSpanLogs.mockResolvedValue([
      { time: '2026-10-22T10:00:00.500Z', level: 'error', service: 'api', message: 'bad <b>thing</b>' },
    ]);
    const { container } = render(SpanLogsTab, { projectId: 'p1', span, trace });
    await waitFor(() => expect(screen.getByText('bad <b>thing</b>')).toBeInTheDocument());
    expect(container.querySelector('b')).toBeNull();
    expect(getSpanLogs).toHaveBeenCalledWith({
      projectId: 'p1',
      spanId: 's1',
      from: '2026-10-22T09:55:00.000Z',
      to: '2026-10-22T10:05:02.000Z',
      limit: 50,
    });
  });

  it('shows the empty state with a link to the trace logs', async () => {
    getSpanLogs.mockResolvedValue([]);
    render(SpanLogsTab, { projectId: 'p1', span, trace });
    expect(await screen.findByText('No logs for this span in the trace window')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View trace logs' });
    expect(link.getAttribute('href')).toContain('q=trace%3At1');
  });

  it('shows an error with Retry', async () => {
    getSpanLogs.mockRejectedValueOnce(new Error('boom'));
    getSpanLogs.mockResolvedValueOnce([]);
    render(SpanLogsTab, { projectId: 'p1', span, trace });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(getSpanLogs).toHaveBeenCalledTimes(2));
  });
});
