import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { parseLogQuery, type LogLevel } from '@logtide/shared';
import LogResultsTable from './LogResultsTable.svelte';
import { makeLog, resetLogIds } from './test-fixtures';
import { centerScrollTop } from './virtual-window';
import { BUILTIN_COLUMNS, type BuiltinColumn } from './builtin-columns';
import { displayPreferences } from '$lib/stores/display-preferences';
import type { LogEntry } from '$lib/api/logs';

const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 360 });
});

afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

beforeEach(() => {
  resetLogIds();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

function manyLogs(n: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) => makeLog({ message: `row ${i}` }));
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    logs: [makeLog()],
    projects: [{ id: 'p1', name: 'Shop' }],
    columns: [...BUILTIN_COLUMNS] as BuiltinColumn[],
    customColumns: [] as string[],
    density: 'comfortable' as const,
    selectedId: null,
    highlightQuery: null,
    hasMore: false,
    loadingMore: false,
    onSelect: vi.fn(),
    onFilter: vi.fn(),
    onProjectFilter: vi.fn(),
    onLoadMore: vi.fn(),
    onScrollTopChange: vi.fn(),
    ...overrides,
  };
}

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-log-row]')];
}

function scroller(): HTMLElement {
  return screen.getByTestId('log-results-scroll');
}

async function scrollTo(top: number) {
  const el = scroller();
  el.scrollTop = top;
  await fireEvent.scroll(el);
  await tick();
}

describe('LogResultsTable', () => {
  it('renders a window of rows for 1,000 logs', () => {
    const { container } = render(LogResultsTable, props({ logs: manyLogs(1000) }));
    const rendered = rows(container);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(30);
    expect(rendered[0].textContent).toContain('row 0');
  });

  it('moves the window when scrolled', async () => {
    const { container } = render(LogResultsTable, props({ logs: manyLogs(1000) }));
    await scrollTo(3600);
    const rendered = rows(container);
    expect(rendered.length).toBeLessThanOrEqual(30);
    expect(rendered[0].textContent).toContain('row 90');
    const spacer = container.querySelector<HTMLElement>('tbody tr[aria-hidden="true"]');
    expect(spacer?.style.height).toBe('3240px');
  });

  it('shows the display zone in the time header', () => {
    render(LogResultsTable, props());
    expect(screen.getAllByRole('columnheader')[0].textContent?.trim()).toBe('Time (UTC)');
  });

  it('follows a change of the display zone', async () => {
    render(LogResultsTable, props());
    displayPreferences.set({ hour12: false, timeZone: 'Asia/Tokyo' });
    await tick();
    expect(screen.getAllByRole('columnheader')[0].textContent?.trim()).toBe('Time (UTC+9)');
    expect(screen.getByText(/19:42:13\.123/)).toBeTruthy();
  });

  it('shows milliseconds in the time cell', () => {
    const { container } = render(LogResultsTable, props());
    expect(rows(container)[0].textContent).toContain('10:42:13.123');
  });

  it('renders built-in and custom column headers', () => {
    render(LogResultsTable, props({ customColumns: ['user.id'] }));
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['Time (UTC)', 'Project', 'Service', 'Host', 'Level', 'Message', 'user.id']);
  });

  it('selects a row on click and on Enter', async () => {
    const log = makeLog({ id: 'L9' });
    const p = props({ logs: [log] });
    const { container } = render(LogResultsTable, p);
    const row = rows(container)[0];
    await fireEvent.click(row);
    expect(p.onSelect).toHaveBeenCalledWith(log);
    await fireEvent.keyDown(row, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledTimes(2);
    expect(row.getAttribute('tabindex')).toBe('0');
  });

  it('marks the selected row', () => {
    const { container } = render(
      LogResultsTable,
      props({ logs: [makeLog({ id: 'A' }), makeLog({ id: 'B' })], selectedId: 'B' }),
    );
    expect(rows(container).map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('filters by service, host and level without selecting the row', async () => {
    const p = props({ logs: [makeLog({ service: 'api', hostname: 'web-1', level: 'error' })] });
    render(LogResultsTable, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by service api' }));
    expect(p.onFilter).toHaveBeenCalledWith('service', 'api');
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by host web-1' }));
    expect(p.onFilter).toHaveBeenCalledWith('host', 'web-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by level error' }));
    expect(p.onFilter).toHaveBeenCalledWith('level', 'error');
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Filter by level error' }), { key: 'Enter' });
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it('uses the severity badge for the level', () => {
    render(LogResultsTable, props({ logs: [makeLog({ level: 'warn' })] }));
    const button = screen.getByRole('button', { name: 'Filter by level warn' });
    expect(within(button).getByTestId('severity-badge')).toBeTruthy();
  });

  it('filters the scope from the project badge', async () => {
    const p = props();
    const { container } = render(LogResultsTable, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by project Shop' }));
    expect(p.onProjectFilter).toHaveBeenCalledWith('p1');
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('a[href^="/dashboard/projects"]')).toBeNull();
  });

  it('asks for more rows near the bottom and from the Load more button', async () => {
    const p = props({ logs: manyLogs(100), hasMore: true });
    render(LogResultsTable, p);
    await scrollTo(0);
    expect(p.onLoadMore).not.toHaveBeenCalled();
    await scrollTo(100 * 36 - 360 - 100);
    expect(p.onLoadMore).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(p.onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('does not ask for more while loadingMore', async () => {
    const p = props({ logs: manyLogs(100), hasMore: true, loadingMore: true });
    render(LogResultsTable, p);
    await scrollTo(100 * 36 - 360);
    expect(p.onLoadMore).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('does not ask for more without hasMore', async () => {
    const p = props({ logs: manyLogs(100), hasMore: false });
    render(LogResultsTable, p);
    await scrollTo(100 * 36 - 360);
    expect(p.onLoadMore).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('reports whether the list is scrolled to the top', async () => {
    const p = props({ logs: manyLogs(100) });
    render(LogResultsTable, p);
    await scrollTo(200);
    expect(p.onScrollTopChange).toHaveBeenLastCalledWith(false);
    await scrollTo(400);
    expect(p.onScrollTopChange).toHaveBeenCalledTimes(1);
    await scrollTo(4);
    expect(p.onScrollTopChange).toHaveBeenLastCalledWith(true);
    expect(p.onScrollTopChange).toHaveBeenCalledTimes(2);
  });

  it('centers the row given in centerOnId', async () => {
    const logs = manyLogs(1000);
    const { container } = render(LogResultsTable, props({ logs, centerOnId: logs[499].id }));
    await tick();
    expect(scroller().scrollTop).toBe(centerScrollTop(499, 36, 360));
    expect(rows(container).some((r) => r.textContent?.includes('row 499'))).toBe(true);
  });

  it('centers once the id arrives in a later page', async () => {
    const logs = manyLogs(300);
    const target = makeLog({ id: 'late', message: 'late row' });
    const { rerender } = render(LogResultsTable, props({ logs, centerOnId: 'late' }));
    await tick();
    expect(scroller().scrollTop).toBe(0);
    await rerender(props({ logs: [...logs, target], centerOnId: 'late' }));
    await tick();
    expect(scroller().scrollTop).toBe(centerScrollTop(300, 36, 360));
  });

  it('exposes scrollToTop and reveal', async () => {
    const logs = manyLogs(1000);
    const { component } = render(LogResultsTable, props({ logs }));
    const api = component as unknown as { scrollToTop(): void; reveal(id: string): void };
    api.reveal(logs[200].id!);
    await tick();
    expect(scroller().scrollTop).toBe(201 * 36 - 360);
    api.scrollToTop();
    await tick();
    expect(scroller().scrollTop).toBe(0);
  });

  it('highlights query words in the message', () => {
    const res = parseLogQuery('timeout -db');
    if (res.ok === false) throw new Error(res.error.message);
    const { container } = render(
      LogResultsTable,
      props({ logs: [makeLog({ message: 'db timeout after 30s' })], highlightQuery: res.query }),
    );
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['timeout']);
  });

  it('follows the column layout', () => {
    render(LogResultsTable, props({ columns: ['level', 'message'] }));
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['Level', 'Message']);
  });

  it('uses the compact row height', () => {
    const { container } = render(LogResultsTable, props({ density: 'compact' }));
    expect(rows(container)[0].className).toContain('h-7');
  });

  it('shows a dash for a missing custom column value', () => {
    const { container } = render(
      LogResultsTable,
      props({ logs: [makeLog({ metadata: { other: 1 } })], customColumns: ['user.id'] }),
    );
    const cells = rows(container)[0].querySelectorAll('td');
    expect(cells[6].textContent?.trim()).toBe('-');
  });

  it('renders a fixed-height row for odd logs', () => {
    const { container } = render(
      LogResultsTable,
      props({
        logs: [makeLog({ metadata: null, hostname: undefined, message: 'a\nb'.repeat(25000), level: 'trace' as LogLevel })],
        customColumns: ['user.id'],
      }),
    );
    const rendered = rows(container);
    expect(rendered).toHaveLength(1);
    const cells = rendered[0].querySelectorAll('td');
    expect(cells[3].textContent?.trim()).toBe('-');
    expect(rendered[0].className).toContain('h-9');
    expect(cells[5].className).toContain('truncate');
  });

  it('shows a dash for a numeric metadata hostname', () => {
    const { container } = render(LogResultsTable, props({ logs: [makeLog({ metadata: { hostname: 42 } })] }));
    expect(rows(container)[0].querySelectorAll('td')[3].textContent?.trim()).toBe('-');
  });
});
