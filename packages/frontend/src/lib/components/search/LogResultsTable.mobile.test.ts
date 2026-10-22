import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { parseLogQuery } from '@logtide/shared';
import LogResultsTable from './LogResultsTable.svelte';
import { makeLog, resetLogIds } from './test-fixtures';
import { BUILTIN_COLUMNS, type BuiltinColumn } from './builtin-columns';
import { displayPreferences } from '$lib/stores/display-preferences';

const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const realMatchMedia = window.matchMedia;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 380 });
});

afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

beforeEach(() => {
  resetLogIds();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    logs: [makeLog({ service: 'checkout', level: 'error', message: 'Payment failed for order 42' })],
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
    ...overrides,
  };
}

describe('LogResultsTable on a phone', () => {
  it('stacks each log: time, level, service and project, then the message', () => {
    const { container } = render(LogResultsTable, { props: props() });
    expect(container.querySelector('table')).toBeNull();
    const row = container.querySelector('[data-log-row]') as HTMLElement;
    expect(row).toHaveTextContent('Oct 21, 10:42:13');
    expect(within(row).getByTestId('severity-badge')).toHaveTextContent('Error');
    expect(row).toHaveTextContent('checkout');
    expect(row).toHaveTextContent('Shop');
    const message = within(row).getByText('Payment failed for order 42');
    expect(message.className).toContain('line-clamp-2');
    expect(message.className).toContain('font-mono');
  });

  it('opens the details when a row is tapped', async () => {
    const onSelect = vi.fn();
    const log = makeLog();
    const { container } = render(LogResultsTable, { props: props({ logs: [log], onSelect }) });
    await fireEvent.click(container.querySelector('[data-log-row]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(log);
  });

  it('marks the selected row and highlights query matches', () => {
    const log = makeLog({ message: 'timeout while calling api' });
    const parsed = parseLogQuery('timeout');
    const { container } = render(LogResultsTable, {
      props: props({ logs: [log], selectedId: log.id, highlightQuery: parsed.ok ? parsed.query : null }),
    });
    const row = container.querySelector('[data-log-row]') as HTMLElement;
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row.querySelector('mark')).toHaveTextContent('timeout');
  });

  it('windows long lists and offers Load more', async () => {
    const logs = Array.from({ length: 400 }, (_, i) => makeLog({ message: `row ${i}` }));
    const onLoadMore = vi.fn();
    const { container } = render(LogResultsTable, { props: props({ logs, hasMore: true, onLoadMore }) });
    expect(container.querySelectorAll('[data-log-row]').length).toBeLessThan(60);
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
