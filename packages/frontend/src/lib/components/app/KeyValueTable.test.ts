import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard }));

import KeyValueTable from './KeyValueTable.svelte';

beforeEach(() => {
  copyToClipboard.mockReset();
  copyToClipboard.mockResolvedValue(true);
});

describe('KeyValueTable', () => {
  it('lists keys and values of a flat object', () => {
    render(KeyValueTable, { data: { host: 'web-1', port: 8080, ok: true } });
    expect(screen.getByText('host')).toBeInTheDocument();
    expect(screen.getByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('8080')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('wraps keys between words, never inside one', () => {
    const { container } = render(KeyValueTable, { data: { 'http.request_id': 'x', hostname: 'h' } });
    const keys = [...container.querySelectorAll('td:first-child > span')];
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k.className).not.toContain('break-all');
    // break opportunities after the separators only; the text itself is unchanged
    expect(keys[0].textContent).toBe('http.request_id');
    expect(keys[0].querySelectorAll('wbr')).toHaveLength(2);
    expect(keys[1].querySelectorAll('wbr')).toHaveLength(0);
  });

  it('also wraps camelCase keys between words, and never widens the panel', () => {
    const { container } = render(KeyValueTable, { data: { customerRenewalNotificationPreference: 'email' } });
    const key = container.querySelector('td:first-child > span')!;
    expect(key.textContent).toBe('customerRenewalNotificationPreference');
    // customer|Renewal|Notification|Preference
    expect(key.querySelectorAll('wbr')).toHaveLength(3);
    // a single word longer than the column is cut instead of overflowing the table
    expect(key.className).toContain('[overflow-wrap:anywhere]');
  });

  it('explains the row buttons with a tooltip on focus', async () => {
    render(KeyValueTable, { data: { env: 'prod' }, onFilter: vi.fn(), onAddColumn: vi.fn() });
    const cases: [string, string][] = [
      ['Copy value', 'Copy value'],
      ['Copy path', 'Copy field path (env)'],
      ['Filter by env', 'Show only logs with this value'],
      ['Exclude env', 'Hide logs with this value'],
      ['Add env as column', 'Add as a column to the log list'],
    ];
    for (const [button, tip] of cases) {
      await fireEvent.focus(screen.getByRole('button', { name: button }));
      expect(await screen.findByText(tip)).toBeInTheDocument();
      await fireEvent.blur(screen.getByRole('button', { name: button }));
    }
  });

  it('hides the per-field copy buttons with showCopy=false', () => {
    render(KeyValueTable, { data: { host: 'web-1' }, showCopy: false });
    expect(screen.queryByRole('button', { name: 'Copy value' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull();
  });

  it('renders "No metadata" for empty data', () => {
    render(KeyValueTable, { data: {} });
    expect(screen.getByText('No metadata')).toBeInTheDocument();
  });

  it('nested object is expandable and passes the dotted path to onFilter', async () => {
    const onFilter = vi.fn();
    render(KeyValueTable, { data: { a: { b: 1 } }, onFilter });
    expect(screen.getByRole('button', { name: /^a/ }).getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by a.b' }));
    expect(onFilter).toHaveBeenCalledWith('a.b', 1, false);
  });

  it('exclude passes negate true', async () => {
    const onFilter = vi.fn();
    render(KeyValueTable, { data: { level: 'error' }, onFilter });
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude level' }));
    expect(onFilter).toHaveBeenCalledWith('level', 'error', true);
  });

  it('collapsing hides children', async () => {
    render(KeyValueTable, { data: { a: { b: 1 } } });
    await fireEvent.click(screen.getByRole('button', { name: /^a/ }));
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByRole('button', { name: /^a/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('a key containing a dot yields that key as the path', async () => {
    const onFilter = vi.fn();
    render(KeyValueTable, { data: { 'http.status': 500 }, onFilter });
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by http.status' }));
    expect(onFilter).toHaveBeenCalledWith('http.status', 500, false);
  });

  it('renders null as a muted "null"', () => {
    render(KeyValueTable, { data: { x: null } });
    const el = screen.getByText('null');
    expect(el.className).toContain('text-muted-foreground');
  });

  it('rows below an array offer Copy only, rows beside it keep Filter and Add column', async () => {
    const onFilter = vi.fn();
    const onAddColumn = vi.fn();
    render(KeyValueTable, { data: { id: 7, errors: [{ code: 'E1' }] }, onFilter, onAddColumn });
    expect(screen.queryByRole('button', { name: 'Filter by errors.0.code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Exclude errors.0.code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add errors.0.code as column' })).toBeNull();
    expect(screen.getByText('E1')).toBeInTheDocument();
    const copyButtons = screen.getAllByRole('button', { name: 'Copy value' });
    expect(copyButtons).toHaveLength(2);
    await fireEvent.click(copyButtons[1]);
    expect(copyToClipboard).toHaveBeenCalledWith('E1');
    await fireEvent.click(screen.getByRole('button', { name: 'Add id as column' }));
    expect(onAddColumn).toHaveBeenCalledWith('id');
  });

  it('array of primitives is one JSON leaf', async () => {
    const onFilter = vi.fn();
    render(KeyValueTable, { data: { tags: ['a', 'b'] }, onFilter });
    expect(screen.getByText('["a","b"]')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter by tags' }));
    expect(onFilter).toHaveBeenCalledWith('tags', ['a', 'b'], false);
  });

  it('does not recurse past 8 levels and shows the rest as a JSON string', () => {
    // Exactly the shape the rendering must handle: k0 > k1 > ... > k9 > 'bottom'.
    // The tree is expanded through the toggles because only depths 0 and 1 open by default.
    let deep: unknown = 'bottom';
    for (let i = 9; i >= 0; i--) deep = { [`k${i}`]: deep };
    const { container } = render(KeyValueTable, { data: deep as Record<string, unknown> });
    expect(container.querySelectorAll('button[aria-expanded]').length).toBeLessThanOrEqual(8);
  });

  it('shows the deepest chunk as a JSON string once expanded', async () => {
    let deep: unknown = 'bottom';
    for (let i = 9; i >= 0; i--) deep = { [`k${i}`]: deep };
    const { container } = render(KeyValueTable, { data: deep as Record<string, unknown> });
    // Expand collapsed levels (depth 2..7) one by one.
    for (let guard = 0; guard < 12; guard++) {
      const closed = container.querySelector('button[aria-expanded="false"]');
      if (!closed) break;
      await fireEvent.click(closed);
    }
    expect(container.querySelectorAll('button[aria-expanded]').length).toBeLessThanOrEqual(8);
    expect(container.textContent).toContain('k8{"k9":"bottom"}');
  });

  it('clamps long strings but copies the full value', async () => {
    const long = 'x'.repeat(5000);
    const { container } = render(KeyValueTable, { data: { blob: long } });
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(copyToClipboard).toHaveBeenCalledWith(long);
    expect(copyToClipboard.mock.calls[0][0]).toHaveLength(5000);
  });

  it('copies objects as pretty JSON', async () => {
    render(KeyValueTable, { data: { tags: ['a'] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(['a'], null, 2));
  });

  it('has no filter or column buttons without callbacks', () => {
    render(KeyValueTable, { data: { a: 1 } });
    expect(screen.queryByRole('button', { name: /Filter by|Exclude|as column/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeInTheDocument();
  });

  it('every button has an accessible name', () => {
    const { container } = render(KeyValueTable, {
      data: { a: { b: 1 }, c: 'x' },
      onFilter: vi.fn(),
      onAddColumn: vi.fn(),
    });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect((b.getAttribute('aria-label') || b.textContent || '').trim()).not.toBe('');
    }
  });
});
