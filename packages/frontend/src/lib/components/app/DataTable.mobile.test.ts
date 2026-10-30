import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Harness from './DataTable.harness.svelte';

const rows = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
];

const realMatchMedia = window.matchMedia;

function state() {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as {
    selected: string[];
    sort?: { key: string; dir: string };
  };
}

describe('DataTable on phones', () => {
  beforeEach(() => {
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

  it('renders one card per row instead of the table', () => {
    render(Harness, { rows, withMobileRow: true });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('mobile-row').map((el) => el.textContent)).toEqual(['Alpha (a)', 'Bravo (b)']);
  });

  it('keeps the table when no phone row is given', () => {
    render(Harness, { rows });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('selects rows and all rows with labelled checkboxes', async () => {
    render(Harness, { rows, withMobileRow: true, selectable: true });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bravo' }));
    expect(state().selected).toEqual(['b']);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(state().selected).toEqual(['b', 'a']);
  });

  it('moves sorting to a select over the sortable columns', async () => {
    render(Harness, { rows, withMobileRow: true });
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Default',
      'Name, ascending',
      'Name, descending',
    ]);
    await fireEvent.change(select, { target: { value: 'name:desc' } });
    expect(state().sort).toEqual({ key: 'name', dir: 'desc' });
  });

  it('shows skeleton cards while loading', () => {
    render(Harness, { rows, withMobileRow: true, loading: true });
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
    expect(screen.queryByTestId('mobile-row')).not.toBeInTheDocument();
  });
});
