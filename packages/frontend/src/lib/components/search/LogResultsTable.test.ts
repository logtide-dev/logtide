import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import LogResultsTable from './LogResultsTable.svelte';
import { makeLog, resetLogIds } from './test-fixtures';
import type { LogEntry } from '$lib/api/logs';

const details = createRawSnippet((log: () => LogEntry, index: () => number) => ({
  render: () => `<div data-testid="details">Details ${index()} ${log().message}</div>`,
}));

function props(overrides: Record<string, unknown> = {}) {
  return {
    logs: [makeLog()],
    projects: [{ id: 'p1', name: 'Shop' }],
    customColumns: [] as string[],
    rowDensity: 'comfortable' as const,
    selectedIndex: -1,
    expandedRows: new Set<number>(),
    searchQuery: '',
    searchMode: 'fulltext' as const,
    onToggleRow: vi.fn(),
    onOpenContext: vi.fn(),
    onFilterService: vi.fn(),
    onFilterHost: vi.fn(),
    onFilterLevel: vi.fn(),
    details,
    ...overrides,
  };
}

describe('LogResultsTable', () => {
  beforeEach(() => resetLogIds());

  it('renders built-in and custom column headers', () => {
    render(LogResultsTable, props({ customColumns: ['user.id'] }));
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['Time', 'Project', 'Service', 'Level', 'Message', 'user.id', 'Actions']);
  });

  it('filters by service when the badge is clicked', async () => {
    const p = props();
    render(LogResultsTable, p);
    await fireEvent.click(screen.getByTitle('Click to filter by this service'));
    expect(p.onFilterService).toHaveBeenCalledWith('api');
  });

  it('renders the details snippet under an expanded row', () => {
    render(LogResultsTable, props({ logs: [makeLog({ message: 'boom' })], expandedRows: new Set([0]) }));
    expect(screen.getByTestId('details').textContent).toBe('Details 0 boom');
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('does not render the details snippet for collapsed rows', () => {
    render(LogResultsTable, props());
    expect(screen.queryByTestId('details')).toBeNull();
  });

  it('shows a dash for a missing custom column value', () => {
    const { container } = render(
      LogResultsTable,
      props({ logs: [makeLog({ metadata: { other: 1 } })], customColumns: ['user.id'] }),
    );
    const cells = container.querySelectorAll('tbody tr[data-log-row] td');
    // Time, Project, Service, Level, Message, user.id, Actions
    expect(cells[5].textContent?.trim()).toBe('-');
  });
});
