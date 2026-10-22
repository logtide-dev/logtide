import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import type { ErrorGroup } from '@logtide/shared';
import { DEFAULT_ERRORS_LIST_STATE, type ErrorsListState } from './errors-url-state';

const { setOption } = vi.hoisted(() => ({ setOption: vi.fn() }));
vi.mock('echarts', () => ({
  init: vi.fn(() => ({ setOption, dispose: vi.fn(), resize: vi.fn() })),
}));

import ErrorsTable from './ErrorsTable.svelte';

function group(over: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    id: 'g1',
    organizationId: 'org1',
    projectId: 'p1',
    projectName: 'Checkout',
    fingerprint: 'abc',
    exceptionType: 'TypeError',
    exceptionMessage: 'x is undefined',
    language: 'nodejs',
    occurrenceCount: 42,
    firstSeen: '2026-10-01T10:00:00.000Z',
    lastSeen: '2026-10-20T10:00:00.000Z',
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    affectedServices: ['api'],
    sampleLogId: null,
    assignedTo: null,
    assignedToName: null,
    regressedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...over,
  } as ErrorGroup;
}

function setup(over: Record<string, unknown> = {}, state: Partial<ErrorsListState> = {}) {
  const handlers = {
    onRetry: vi.fn(),
    onWidenRange: vi.fn(),
    onShowAllStatuses: vi.fn(),
    onClearFilters: vi.fn(),
    onOpen: vi.fn(),
    onSort: vi.fn(),
  };
  const props = {
    groups: [group()],
    trends: { g1: [0, 1, 2] },
    loading: false,
    error: null as string | null,
    selected: [] as string[],
    sort: { key: 'last_seen', dir: 'desc' as const },
    state: { ...DEFAULT_ERRORS_LIST_STATE, ...state },
    rangeLabel: 'Last 24 hours',
    scopeSearch: '?range=24h',
    ...handlers,
    ...over,
  };
  render(ErrorsTable, props);
  return { handlers, props };
}

beforeEach(() => setOption.mockClear());

describe('ErrorsTable', () => {
  it('renders type, message, project, status, sparkline, events and assignee for each row', () => {
    setup({
      groups: [group({ assignedTo: 'u1', assignedToName: 'Ada Lovelace', assignedToEmail: 'ada@x.io' })],
    });
    expect(screen.getByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('x is undefined')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /events over time/i })).toBeInTheDocument();
    expect(setOption).toHaveBeenCalled();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows the Regressed badge for a regressed open group', () => {
    setup({ groups: [group({ regressedAt: '2026-10-19T10:00:00.000Z' })] });
    expect(screen.getByText('Regressed')).toBeInTheDocument();
  });

  it('unassigned groups show Unassigned', () => {
    setup();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('selecting rows updates the bound selection and select-all selects the page', async () => {
    const groups = [group(), group({ id: 'g2', exceptionType: 'RangeError' })];
    setup({ groups, trends: {} });
    const boxes = screen.getAllByRole('checkbox');
    // header + two rows
    expect(boxes).toHaveLength(3);
    await fireEvent.click(boxes[1]);
    expect(boxes[1]).toHaveAttribute('aria-checked', 'true');
    await fireEvent.click(boxes[0]);
    expect(boxes[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking a sortable header calls the sort handler with that key', async () => {
    const { handlers } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /Events/ }));
    expect(handlers.onSort).toHaveBeenCalledWith('events');
    await fireEvent.click(screen.getByRole('button', { name: /First seen/ }));
    expect(handlers.onSort).toHaveBeenCalledWith('first_seen');
  });

  it('clicking the active sort header does nothing', async () => {
    const { handlers } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /Last seen/ }));
    expect(handlers.onSort).not.toHaveBeenCalled();
  });

  it('error state shows the message and Retry calls onRetry', async () => {
    const { handlers } = setup({ error: 'boom', groups: [] });
    expect(screen.getByText('boom')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
  });

  it('no results state offers 24h, 7d, 30d and Show all statuses and each calls the right handler', async () => {
    const { handlers } = setup({ groups: [], trends: {}, rangeLabel: 'Last 15 minutes' });
    expect(screen.getByText('No errors match in Last 15 minutes')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));
    expect(handlers.onWidenRange).toHaveBeenLastCalledWith('24h');
    await fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(handlers.onWidenRange).toHaveBeenLastCalledWith('7d');
    await fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(handlers.onWidenRange).toHaveBeenLastCalledWith('30d');
    await fireEvent.click(screen.getByRole('button', { name: 'Show all statuses' }));
    expect(handlers.onShowAllStatuses).toHaveBeenCalledTimes(1);
  });

  it('no results with a search filter offers Clear filters', async () => {
    const { handlers } = setup({ groups: [], trends: {} }, { search: 'boom' });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(handlers.onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('no results with default filters and status All shows the no-data state', () => {
    setup({ groups: [], trends: {} }, { status: 'all' });
    expect(screen.getByText('No errors yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all statuses' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect/ })).toBeInTheDocument();
  });

  it('events count uses en-US grouping for 12345', () => {
    setup({ groups: [group({ occurrenceCount: 12345 })] });
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('row link uses the detail href with scope params', async () => {
    const { handlers } = setup();
    const link = screen.getByRole('link', { name: /TypeError/ });
    expect(link).toHaveAttribute('href', '/dashboard/errors/g1?range=24h');
    await fireEvent.click(link);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(within(screen.getAllByRole('row')[1]).getByRole('link')).toBe(link);
  });
});
