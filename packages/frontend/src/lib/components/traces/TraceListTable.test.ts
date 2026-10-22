import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TraceListTable from './TraceListTable.svelte';
import type { TraceRecord } from '$lib/api/traces';

function trace(id: string, over: Partial<TraceRecord> = {}): TraceRecord {
  return {
    trace_id: id,
    service_name: 'api',
    root_service_name: 'api',
    root_operation_name: `GET /${id}`,
    start_time: '2026-10-22T10:00:00.000Z',
    end_time: '2026-10-22T10:00:01.000Z',
    duration_ms: 1234,
    span_count: 1500,
    error: false,
    ...over,
  };
}

function props(over: Record<string, unknown> = {}) {
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

describe('TraceListTable', () => {
  it('renders rows with a link to the trace detail including project', async () => {
    const p = props();
    render(TraceListTable, p);
    const link = screen.getByRole('link', { name: 'GET /t1' });
    expect(link.getAttribute('href')).toBe('/dashboard/traces/t1?project=p1');
    expect(screen.getAllByText('1,500').length).toBe(2);
    expect(screen.getAllByText('1.23s').length).toBe(2);
    await fireEvent.click(link);
    expect(p.onOpen).toHaveBeenCalledWith('t1');
  });

  it('clicking the Duration header calls onSort("duration","desc") then asc', async () => {
    const p = props();
    const { rerender } = render(TraceListTable, p);
    await fireEvent.click(screen.getByRole('button', { name: /Duration/ }));
    expect(p.onSort).toHaveBeenLastCalledWith('duration', 'desc');
    await rerender({ ...p, sortBy: 'duration', sortOrder: 'desc' });
    await fireEvent.click(screen.getByRole('button', { name: /Duration/ }));
    expect(p.onSort).toHaveBeenLastCalledWith('duration', 'asc');
  });

  it('shows the filtered empty state with Clear filters', async () => {
    const p = props({ traces: [], total: 0, filtersActive: true });
    render(TraceListTable, p);
    expect(screen.getByText('No traces match these filters')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(p.onClearFilters).toHaveBeenCalled();
  });

  it('shows the unfiltered empty state', () => {
    render(TraceListTable, props({ traces: [], total: 0 }));
    expect(screen.getByText('No traces in this range')).toBeInTheDocument();
  });

  it('shows the error state with Retry', async () => {
    const p = props({ error: 'boom', onRetry: vi.fn() });
    render(TraceListTable, p);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('pagination calls onPageChange', async () => {
    const p = props({ total: 80 });
    render(TraceListTable, p);
    await fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(p.onPageChange).toHaveBeenCalledWith(2);
  });
});
