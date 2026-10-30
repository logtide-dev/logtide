import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DataTable from './DataTable.svelte';
import Harness from './DataTable.harness.svelte';

const rows = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

function state() {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as {
    selected: string[];
    sort?: { key: string; dir: string };
  };
}

describe('DataTable', () => {
  it('renders headers and a cell per row and column', () => {
    render(Harness, { rows });
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Identifier' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('cycles the sort asc, desc, asc and sets aria-sort', async () => {
    render(Harness, { rows });
    const th = screen.getByRole('columnheader', { name: /Name/ });
    expect(th.getAttribute('aria-sort')).toBe('none');
    const btn = within(th).getByRole('button', { name: 'Name' });
    await fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(state().sort).toEqual({ key: 'name', dir: 'asc' });
    await fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(state().sort).toEqual({ key: 'name', dir: 'desc' });
    await fireEvent.click(btn);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
  });

  it('never reorders the rows itself', async () => {
    render(Harness, { rows });
    await fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    const names = screen.getAllByRole('row').slice(1).map((r) => r.textContent?.trim());
    expect(names[0]).toContain('Alpha');
    expect(names[2]).toContain('Charlie');
  });

  it('gives a non sortable header no button and no aria-sort', () => {
    render(Harness, { rows });
    const th = screen.getByRole('columnheader', { name: 'Identifier' });
    expect(within(th).queryByRole('button')).toBeNull();
    expect(th.hasAttribute('aria-sort')).toBe(false);
  });

  it('shows 5 skeleton rows and no data while loading', () => {
    render(Harness, { rows, loading: true });
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('renders the default empty text', () => {
    render(Harness, { rows: [] });
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders a custom empty snippet', () => {
    render(DataTable, {
      columns: [],
      rows: [],
      rowKey: (r: { id: string }) => r.id,
      empty: createRawSnippet(() => ({ render: () => '<span>Nothing here yet</span>' })),
    });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('No results')).toBeNull();
  });

  it('selects all rendered rows from the header checkbox', async () => {
    render(Harness, { rows, selectable: true });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(state().selected).toEqual(['a', 'b', 'c']);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(3);
  });

  it('shows the header as mixed with a partial selection', async () => {
    render(Harness, { rows, selectable: true });
    await fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]);
    expect(state().selected).toEqual(['a']);
    const header = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(header.getAttribute('aria-checked')).toBe('mixed');
  });

  it('unchecking the header keeps selected ids that are not rendered', async () => {
    render(Harness, { rows, selectable: true, initialSelected: ['a', 'b', 'c', 'zzz'] });
    const header = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(header.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(header);
    expect(state().selected).toEqual(['zzz']);
  });

  it('keeps selection by id when rows are replaced', async () => {
    const { rerender } = render(Harness, { rows, selectable: true, initialSelected: ['b'] });
    await rerender({ rows: [rows[2], rows[1]], selectable: true, initialSelected: ['b'] });
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    expect(boxes[0].getAttribute('aria-checked')).toBe('false');
    expect(boxes[1].getAttribute('aria-checked')).toBe('true');
    expect(state().selected).toEqual(['b']);
  });
});
