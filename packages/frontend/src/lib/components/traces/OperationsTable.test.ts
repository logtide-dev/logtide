import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import OperationsTable from './OperationsTable.svelte';
import type { OperationRow } from '$lib/api/traces';

function row(over: Partial<OperationRow>): OperationRow {
  return {
    service: 'api',
    operation: 'GET /a',
    count: 100,
    errorCount: 0,
    errorRate: 0,
    avgMs: 10,
    p50Ms: 8,
    p95Ms: 50,
    p99Ms: 90,
    throughputPerMin: 1.5,
    ...over,
  };
}

const rows = [
  row({ operation: 'fast', p95Ms: 20 }),
  row({ operation: 'slow', p95Ms: 900, count: 1234, errorCount: 100, errorRate: 0.081 }),
  row({ operation: 'mid', p95Ms: 300 }),
];

const base = { rows, loading: false, showService: true, onSelect: () => {} };

describe('OperationsTable', () => {
  it('renders one row per operation sorted by p95 desc', () => {
    render(OperationsTable, base);
    const buttons = screen.getAllByRole('button', { name: /^(fast|slow|mid)$/ });
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['slow', 'mid', 'fast']);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('8.1%')).toBeInTheDocument();
  });

  it('clicking an operation calls onSelect with its name, clicking it again calls onSelect(null)', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(OperationsTable, { ...base, onSelect });
    await fireEvent.click(screen.getByRole('button', { name: 'mid' }));
    expect(onSelect).toHaveBeenLastCalledWith('mid');
    await rerender({ ...base, onSelect, selectedOperation: 'mid' });
    const btn = screen.getByRole('button', { name: 'mid' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(btn);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('hides the service column when showService is false', () => {
    const { unmount } = render(OperationsTable, base);
    expect(screen.getByRole('columnheader', { name: /Service/ })).toBeInTheDocument();
    unmount();
    render(OperationsTable, { ...base, showService: false });
    expect(screen.queryByRole('columnheader', { name: /Service/ })).toBeNull();
  });

  it('shows the empty state with no rows', () => {
    render(OperationsTable, { ...base, rows: [] });
    expect(screen.getByText('No operations in this range')).toBeInTheDocument();
  });

  it('shows the error state and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(OperationsTable, { ...base, error: 'boom', onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders 0.0% error rate for count 0 without NaN', () => {
    render(OperationsTable, {
      ...base,
      rows: [row({ operation: 'idle', count: 0, errorCount: 0, errorRate: NaN, throughputPerMin: NaN })],
    });
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});
