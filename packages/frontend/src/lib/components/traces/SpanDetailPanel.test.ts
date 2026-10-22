import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/traces', () => ({
  tracesAPI: { getSpanLogs: vi.fn() },
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tracesAPI } from '$lib/api/traces';
import SpanDetailPanel from './SpanDetailPanel.svelte';

const getSpanLogs = vi.mocked(tracesAPI.getSpanLogs);

function span(over: Record<string, unknown> = {}): any {
  return {
    span_id: 's1',
    trace_id: 't1',
    parent_span_id: null,
    service_name: 'api',
    operation_name: 'GET /a',
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1000,
    kind: 'SERVER',
    status_code: 'ERROR',
    status_message: null,
    attributes: { 'http.method': 'GET' },
    resource_attributes: { 'service.version': '1.2' },
    events: [
      {
        name: 'exception',
        time: '2026-10-22T10:00:00.500Z',
        attributes: { 'exception.type': 'TypeError', 'exception.message': 'bad' },
      },
    ],
    links: null,
    ...over,
  };
}

const trace: any = {
  trace_id: 't1',
  start_time: '2026-10-22T10:00:00.000Z',
  end_time: '2026-10-22T10:00:02.000Z',
};

const group = {
  errorGroupId: 'g1',
  status: 'open' as const,
  exceptionType: 'TypeError',
  exceptionMessage: 'bad',
  projectId: 'p1',
  logId: 'l1',
  spanId: null,
  occurredAt: '2026-10-22T10:00:00.500Z',
};

function props(over: Record<string, unknown> = {}) {
  return {
    span: span(),
    trace,
    projectId: 'p1',
    errorGroups: [],
    onClose: vi.fn(),
    onFilterTraces: vi.fn(),
    ...over,
  } as any;
}

async function openTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  await fireEvent.mouseDown(tab);
  await fireEvent.click(tab);
}

beforeEach(() => {
  getSpanLogs.mockReset();
  getSpanLogs.mockResolvedValue([]);
});

describe('SpanDetailPanel', () => {
  it('renders attributes through KeyValueTable and forwards onFilter', async () => {
    const p = props();
    render(SpanDetailPanel, p);
    await openTab('Attributes');
    await fireEvent.click(await screen.findByRole('button', { name: 'Filter by http.method' }));
    expect(p.onFilterTraces).toHaveBeenCalledWith('http.method', 'GET', false);
    expect(screen.getByRole('button', { name: 'Exclude service.version' })).toBeInTheDocument();
  });

  it('shows Open error group when the span exception type matches', () => {
    render(SpanDetailPanel, props({ errorGroups: [group] }));
    const link = screen.getByRole('link', { name: 'Open error group' });
    expect(link.getAttribute('href')).toBe('/dashboard/errors/g1?project=p1');
  });

  it('hides the error group link when none matches', () => {
    render(SpanDetailPanel, props({ span: span({ status_code: 'OK', events: [] }), errorGroups: [group, { ...group, errorGroupId: 'g2' }] }));
    expect(screen.queryByRole('link', { name: 'Open error group' })).toBeNull();
  });

  it('Escape and the close button call onClose', async () => {
    const p = props();
    render(SpanDetailPanel, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Close span panel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it('span logs link uses span: and the trace window', () => {
    render(SpanDetailPanel, props());
    const href = screen.getByRole('link', { name: 'View span logs' }).getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('span:s1');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-22T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-22T10:05:02.000Z');
  });

  it('does not fetch span logs until the Logs tab is opened', async () => {
    render(SpanDetailPanel, props());
    expect(getSpanLogs).not.toHaveBeenCalled();
    await openTab('Logs');
    await waitFor(() => expect(getSpanLogs).toHaveBeenCalledTimes(1));
  });

  it('shows exception events in the Events tab', async () => {
    render(SpanDetailPanel, props());
    await openTab('Events');
    expect(await screen.findByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });
});
