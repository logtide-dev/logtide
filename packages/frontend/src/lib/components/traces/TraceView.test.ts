import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'o1', name: 'Org' }) };
});

vi.mock('$lib/api/traces', () => ({
  tracesAPI: {
    getTrace: vi.fn(),
    getTraceSpans: vi.fn(),
    getErrorGroupsByTrace: vi.fn(),
    getSpanLogs: vi.fn(),
  },
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { tracesAPI } from '$lib/api/traces';
import TraceView from './TraceView.svelte';

const api = vi.mocked(tracesAPI, true) as any;

function makeTrace(id: string, op = 'GET /x') {
  return {
    trace_id: id,
    service_name: 'api',
    root_service_name: 'api',
    root_operation_name: op,
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1000,
    span_count: 1,
    error: false,
  };
}

function makeSpan(id: string, traceId: string, op: string) {
  return {
    span_id: id,
    trace_id: traceId,
    parent_span_id: null,
    service_name: 'api',
    operation_name: op,
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1000,
    kind: 'SERVER',
    status_code: 'OK',
    status_message: null,
    attributes: { 'http.method': 'GET' },
    events: null,
    links: null,
    resource_attributes: null,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockTrace(id: string, op: string) {
  api.getTrace.mockResolvedValueOnce(makeTrace(id, op));
  api.getTraceSpans.mockResolvedValueOnce([makeSpan(`s-${id}`, id, op)]);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrace.mockReset();
  api.getTraceSpans.mockReset();
  api.getErrorGroupsByTrace.mockReset();
  api.getErrorGroupsByTrace.mockResolvedValue([]);
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

describe('TraceView', () => {
  it('reloads trace and spans when traceId changes', async () => {
    mockTrace('trace-one', 'first-op');
    const { rerender } = render(TraceView, { traceId: 'trace-one', projectId: 'p1' });
    expect(await screen.findAllByText('first-op')).not.toHaveLength(0);

    mockTrace('trace-two', 'second-op');
    await rerender({ traceId: 'trace-two', projectId: 'p1' });
    expect((await screen.findAllByText('second-op')).length).toBeGreaterThan(0);
    expect(api.getTrace).toHaveBeenCalledTimes(2);
    expect(api.getTrace).toHaveBeenLastCalledWith('trace-two', 'p1');
  });

  it('ignores a slow response of the previous trace', async () => {
    const slowTrace = deferred<any>();
    const slowSpans = deferred<any>();
    api.getTrace.mockReturnValueOnce(slowTrace.promise);
    api.getTraceSpans.mockReturnValueOnce(slowSpans.promise);
    const { rerender } = render(TraceView, { traceId: 'old', projectId: 'p1' });

    mockTrace('new', 'new-op');
    await rerender({ traceId: 'new', projectId: 'p1' });
    expect((await screen.findAllByText('new-op')).length).toBeGreaterThan(0);

    slowTrace.resolve(makeTrace('old', 'old-op'));
    slowSpans.resolve([makeSpan('s-old', 'old', 'old-op')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('old-op')).toBeNull();
  });

  it('shows the span panel beside the waterfall after selecting a span', async () => {
    mockTrace('t1', 'checkout');
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    await screen.findAllByText('checkout');
    expect(screen.queryByLabelText('Span details')).toBeNull();
    await fireEvent.click(document.querySelector('[data-span-row]') as HTMLElement);
    expect(await screen.findByLabelText('Span details')).toBeInTheDocument();
    expect(document.querySelector('[data-span-row]')).not.toBeNull();
  });

  it('View logs links to /dashboard/logs with q=trace, project and the padded window', async () => {
    mockTrace('t1', 'checkout');
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    const link = await screen.findByRole('link', { name: /View logs/ });
    const url = new URL(link.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('trace:t1');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-22T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-22T10:05:01.000Z');
  });

  it('Back to traces uses the remembered list state', async () => {
    sessionStorage.setItem('logtide_traces_list_state', '?project=p1&service=api');
    const mod = await import('$lib/utils/trace-filters');
    mod.rememberTraceListState('?project=p1&service=api');
    mockTrace('t1', 'checkout');
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    await screen.findAllByText('checkout');
    const crumb = screen.getByRole('link', { name: 'Traces' });
    expect(crumb.getAttribute('href')).toBe('/dashboard/traces?project=p1&service=api');
  });

  it('shows Trace not found for a 404', async () => {
    api.getTrace.mockRejectedValueOnce(new Error('Failed to fetch trace: Not Found'));
    api.getTraceSpans.mockRejectedValueOnce(new Error('Failed to fetch trace spans: Not Found'));
    render(TraceView, { traceId: 'missing', projectId: 'p1' });
    expect(await screen.findByText('Trace not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to traces' })).toBeInTheDocument();
  });

  it('an error-group lookup failure does not break the page', async () => {
    mockTrace('t1', 'checkout');
    api.getErrorGroupsByTrace.mockReset();
    api.getErrorGroupsByTrace.mockRejectedValue(new Error('boom'));
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    expect((await screen.findAllByText('checkout')).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getErrorGroupsByTrace).toHaveBeenCalledWith('t1', 'p1', 'o1'));
    expect(screen.queryByText('Trace not found')).toBeNull();
  });
});
