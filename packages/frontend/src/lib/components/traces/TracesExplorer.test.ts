import { describe, it, expect, vi, beforeEach } from 'vitest';

const echartsHandlers: Record<string, (p: unknown) => void> = {};

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    dispatchAction: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: (name: string, fn: (p: unknown) => void) => {
      echartsHandlers[name] = fn;
    },
    off: vi.fn(),
  }),
}));

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$app/state', async () => {
  const mod = await import('./test-page-state.svelte');
  return { page: mod.page };
});

vi.mock('$app/navigation', async () => {
  const mod = await import('./test-page-state.svelte');
  return {
    goto: vi.fn(async (url: string | URL) => {
      mod.page.url = new URL(String(url), 'http://localhost');
    }),
  };
});

vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'o1', name: 'Org' }) };
});

vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    async getProjects() {
      return { projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] };
    }
    async getProjectDataAvailability() {
      return { logs: [], traces: ['p1', 'p2'], metrics: [] };
    }
  },
}));

vi.mock('$lib/api/traces', () => ({
  tracesAPI: {
    getTraces: vi.fn(),
    getStats: vi.fn(),
    getOperations: vi.fn(),
    getLatencyHistogram: vi.fn(),
    getServices: vi.fn(),
    getServiceMap: vi.fn(),
    getTrace: vi.fn(),
    createTracesEventSource: vi.fn(),
  },
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { tracesAPI } from '$lib/api/traces';
import { scopeStore } from '$lib/stores/scope';
import { setPageUrl } from './test-page-state.svelte';
import TracesExplorer from './TracesExplorer.svelte';

const api = vi.mocked(tracesAPI, true) as any;

function trace(id: string, op = `GET /${id}`) {
  return {
    trace_id: id,
    service_name: 'api',
    root_service_name: 'api',
    root_operation_name: op,
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 120,
    span_count: 3,
    error: false,
  };
}

const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000];
const histogram = { bounds, counts: bounds.map(() => 2).concat([0]) };
const stats = {
  total_traces: 10,
  total_spans: 99,
  avg_duration_ms: 5,
  max_duration_ms: 90,
  p95_duration_ms: 80,
  error_count: 1,
  error_rate: 0.1,
};
const operations = [
  {
    service: 'api',
    operation: 'slow',
    count: 10,
    errorCount: 0,
    errorRate: 0,
    avgMs: 1,
    p50Ms: 1,
    p95Ms: 900,
    p99Ms: 950,
    throughputPerMin: 1,
  },
];

function lastGotoUrl(): URL {
  const calls = vi.mocked(goto).mock.calls;
  return new URL(String(calls[calls.length - 1][0]), 'http://localhost');
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  scopeStore.reset();
  vi.mocked(goto).mockClear();
  for (const fn of Object.values(api) as any[]) fn.mockReset();
  api.getTraces.mockResolvedValue({ traces: [trace('t1')], total: 1 });
  api.getStats.mockResolvedValue(stats);
  api.getOperations.mockResolvedValue(operations);
  api.getLatencyHistogram.mockResolvedValue(histogram);
  api.getServices.mockResolvedValue(['api', 'web']);
  api.getServiceMap.mockResolvedValue({ nodes: [], edges: [] });
  setPageUrl('?project=p1&range=24h');
});

describe('TracesExplorer', () => {
  it('loads traces, stats, operations and histogram for the scoped project', async () => {
    render(TracesExplorer);
    await waitFor(() => expect(screen.getByRole('link', { name: 'GET /t1' })).toBeInTheDocument());
    expect(api.getTraces).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', limit: 25 }));
    expect(api.getStats).toHaveBeenCalledWith('p1', expect.any(String), expect.any(String), expect.anything());
    expect(api.getOperations).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
    expect(api.getLatencyHistogram).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
    expect(screen.getByRole('button', { name: 'slow' })).toBeInTheDocument();
  });

  it('the p95 card is shown and there is no Avg duration card', async () => {
    render(TracesExplorer);
    await waitFor(() => expect(screen.getByText('p95 latency')).toBeInTheDocument());
    expect(screen.getByText('80ms')).toBeInTheDocument();
    expect(screen.queryByText(/Avg duration/i)).toBeNull();
    expect(screen.getByText('Total traces')).toBeInTheDocument();
  });

  it('a slow response for an old service does not overwrite the newer one', async () => {
    const first = deferred<{ traces: any[]; total: number }>();
    const second = deferred<{ traces: any[]; total: number }>();
    api.getTraces.mockReset();
    api.getTraces.mockImplementation((q: any) => {
      if (q.service === 'a') return first.promise;
      if (q.service === 'b') return second.promise;
      return Promise.resolve({ traces: [], total: 0 });
    });
    render(TracesExplorer);
    setPageUrl('?project=p1&range=24h&service=a');
    await waitFor(() => expect(api.getTraces).toHaveBeenCalledWith(expect.objectContaining({ service: 'a' })));
    setPageUrl('?project=p1&range=24h&service=b');
    await waitFor(() => expect(api.getTraces).toHaveBeenCalledWith(expect.objectContaining({ service: 'b' })));
    second.resolve({ traces: [trace('tb', 'GET /b')], total: 1 });
    await waitFor(() => expect(screen.getByRole('link', { name: 'GET /b' })).toBeInTheDocument());
    first.resolve({ traces: [trace('ta', 'GET /a')], total: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: 'GET /a' })).toBeNull();
    expect(screen.getByRole('link', { name: 'GET /b' })).toBeInTheDocument();
  });

  it('selecting an operation adds operation to the URL and reloads the list with operation set', async () => {
    render(TracesExplorer);
    const button = await screen.findByRole('button', { name: 'slow' });
    await fireEvent.click(button);
    expect(lastGotoUrl().searchParams.get('operation')).toBe('slow');
    await waitFor(() =>
      expect(api.getTraces).toHaveBeenCalledWith(expect.objectContaining({ operation: 'slow' })),
    );
  });

  it('brushing the histogram sets minDuration and maxDuration', async () => {
    render(TracesExplorer);
    await waitFor(() => expect(echartsHandlers.brushSelected).toBeTypeOf('function'));
    echartsHandlers.brushSelected({ batch: [{ areas: [{ coordRange: [7, 8] }] }] });
    const url = lastGotoUrl();
    expect(url.searchParams.get('minDuration')).toBe('100');
    expect(url.searchParams.get('maxDuration')).toBe('500');
  });

  it('?traceId=abc resolves the project and navigates to the trace detail', async () => {
    setPageUrl('?traceId=abc');
    api.getTrace.mockImplementation(async (_id: string, pid: string) => {
      if (pid === 'p2') return trace('abc');
      throw new Error('404');
    });
    render(TracesExplorer);
    await waitFor(() =>
      expect(goto).toHaveBeenCalledWith('/dashboard/traces/abc?project=p2', { replaceState: true }),
    );
  });

  it('?traceId=abc shows the not-found state when no project has the trace', async () => {
    setPageUrl('?traceId=abc');
    api.getTrace.mockRejectedValue(new Error('404'));
    render(TracesExplorer);
    expect(await screen.findByText('No trace with id abc in your projects')).toBeInTheDocument();
  });

  it('a stats failure still shows the list', async () => {
    api.getStats.mockRejectedValue(new Error('stats down'));
    render(TracesExplorer);
    expect(await screen.findByRole('link', { name: 'GET /t1' })).toBeInTheDocument();
    expect(await screen.findByText(/Could not load stats/)).toBeInTheDocument();
  });

  it('an invalid attr in the URL shows the inline error and does not request the list with it', async () => {
    setPageUrl('?project=p1&range=24h&attr=timeout');
    render(TracesExplorer);
    expect(await screen.findByText(/Free text is not supported/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getTraces).not.toHaveBeenCalled();
  });
});
