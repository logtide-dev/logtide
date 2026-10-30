import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), dispatchAction: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn() }),
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
      return { projects: [{ id: 'p1', name: 'One' }] };
    }
    async getProjectDataAvailability() {
      return { logs: [], traces: ['p1'], metrics: [] };
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
    getTraceSpans: vi.fn(),
    getErrorGroupsByTrace: vi.fn(),
    getSpanLogs: vi.fn(),
    createTracesEventSource: vi.fn(),
  },
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { tracesAPI } from '$lib/api/traces';
import { scopeStore } from '$lib/stores/scope';
import { setPageUrl } from './test-page-state.svelte';
import TracesExplorer from './TracesExplorer.svelte';
import TraceListTable from './TraceListTable.svelte';
import OperationsTable from './OperationsTable.svelte';
import TraceView from './TraceView.svelte';

const api = vi.mocked(tracesAPI, true) as any;
const realMatchMedia = window.matchMedia;

function phone(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function trace(id: string, over: Record<string, unknown> = {}) {
  return {
    trace_id: id,
    service_name: 'api',
    root_service_name: 'api',
    root_operation_name: `GET /${id}`,
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1234,
    span_count: 3,
    error: false,
    ...over,
  };
}

const stats = {
  total_traces: 10,
  total_spans: 99,
  avg_duration_ms: 5,
  max_duration_ms: 90,
  p95_duration_ms: 80,
  error_count: 1,
  error_rate: 0.1,
};
const op = {
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
};

beforeEach(() => {
  phone(true);
  scopeStore.reset();
  for (const fn of Object.values(api) as any[]) fn.mockReset();
  api.getTraces.mockResolvedValue({ traces: [trace('t1')], total: 1 });
  api.getStats.mockResolvedValue(stats);
  api.getOperations.mockResolvedValue([op]);
  api.getLatencyHistogram.mockResolvedValue({ bounds: [1, 2], counts: [1, 1, 0] });
  api.getServices.mockResolvedValue(['api', 'web']);
  api.getErrorGroupsByTrace.mockResolvedValue([]);
  setPageUrl('?project=p1&range=24h');
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function listProps(over: Record<string, unknown> = {}) {
  return {
    traces: [trace('t1'), trace('t2', { error: true })],
    projectId: 'p1',
    loading: false,
    total: 2,
    page: 1,
    pageSize: 25,
    sortBy: 'start_time',
    sortOrder: 'desc',
    filtersActive: false,
    onSort: vi.fn(),
    onPageChange: vi.fn(),
    onClearFilters: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  } as any;
}

describe('traces list on a phone', () => {
  it('stacks each trace as a link row instead of a table', () => {
    const onOpen = vi.fn();
    const { container } = render(TraceListTable, { props: listProps({ onOpen }) });
    expect(container.querySelector('table')).toBeNull();
    const rows = container.querySelectorAll('[data-trace-link]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', expect.stringContaining('t1'));
    expect(rows[0]).toHaveTextContent('GET /t1');
    expect(rows[0]).toHaveTextContent('1.23s');
    expect(rows[0]).toHaveTextContent('3 spans');
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('sorts through a labelled select', async () => {
    const onSort = vi.fn();
    render(TraceListTable, { props: listProps({ onSort }) });
    const select = screen.getByLabelText('Sort by');
    await fireEvent.change(select, { target: { value: 'duration:desc' } });
    expect(onSort).toHaveBeenCalledWith('duration', 'desc');
  });

  it('keeps the table on desktop', () => {
    phone(false);
    const { container } = render(TraceListTable, { props: listProps() });
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.queryByLabelText('Sort by')).toBeNull();
  });
});

describe('operations on a phone', () => {
  it('shows stacked rows with labelled values and selects on tap', async () => {
    const onSelect = vi.fn();
    const { container } = render(OperationsTable, {
      props: { rows: [op], loading: false, showService: true, onSelect },
    });
    expect(container.querySelector('table')).toBeNull();
    const row = screen.getByRole('button', { name: /slow/ });
    expect(row).toHaveTextContent('Error rate');
    expect(row).toHaveTextContent('p95');
    await fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('slow');
  });
});

describe('TracesExplorer on a phone', () => {
  it('does not fetch the latency histogram or draw it', async () => {
    render(TracesExplorer);
    await waitFor(() => expect(screen.getByText('p95 latency')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getLatencyHistogram).not.toHaveBeenCalled();
  });

  it('labels the view switch and export, and groups the four stats in one summary', async () => {
    render(TracesExplorer);
    await waitFor(() => expect(screen.getByTestId('traces-stats')).toBeInTheDocument());
    const toolbar = screen.getByTestId('traces-toolbar');
    expect(toolbar).toHaveTextContent('List');
    expect(toolbar).toHaveTextContent('Map');
    expect(toolbar).toHaveTextContent('Export');
    expect(toolbar).toHaveTextContent('Live tail');
    expect(screen.getByTestId('scope-zone')).toHaveClass('hidden');
    expect(screen.getByTestId('traces-stats')).toHaveTextContent('Error rate');
  });

  it('folds the filter fields behind a Filters button', async () => {
    render(TracesExplorer);
    const button = await screen.findByRole('button', { name: /Filters/ });
    expect(screen.queryByLabelText('Attribute filter')).toBeNull();
    await fireEvent.click(button);
    expect(screen.getByLabelText('Attribute filter')).toBeInTheDocument();
  });

  it('fetches the histogram on desktop', async () => {
    phone(false);
    render(TracesExplorer);
    await waitFor(() => expect(api.getLatencyHistogram).toHaveBeenCalled());
  });
});

describe('TraceView on a phone', () => {
  function span(id: string, op: string) {
    return {
      span_id: id,
      trace_id: 't1',
      parent_span_id: null,
      service_name: 'api',
      operation_name: op,
      start_time: '2026-10-22T10:00:00.000Z',
      end_time: '2026-10-22T10:00:01.000Z',
      duration_ms: 1000,
      kind: 'SERVER',
      status_code: 'OK',
      status_message: null,
      attributes: {},
      events: null,
      links: null,
      resource_attributes: null,
    };
  }

  it('opens the span details as a full screen sheet', async () => {
    api.getTrace.mockResolvedValue(trace('t1'));
    api.getTraceSpans.mockResolvedValue([span('s1', 'checkout')]);
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    expect(await screen.findByTestId('waterfall-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('trace-summary')).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole('button', { name: /api: checkout/ }));
    expect(await screen.findByTestId('span-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('span-sheet').querySelector('aside')).not.toBeNull();
  });

  it('keeps the inline panel on desktop', async () => {
    phone(false);
    api.getTrace.mockResolvedValue(trace('t1'));
    api.getTraceSpans.mockResolvedValue([span('s1', 'checkout')]);
    render(TraceView, { traceId: 't1', projectId: 'p1' });
    await fireEvent.click(await screen.findByRole('button', { name: /api: checkout/ }));
    expect(await screen.findByLabelText('Span details')).toBeInTheDocument();
    expect(screen.queryByTestId('span-sheet')).toBeNull();
  });
});
