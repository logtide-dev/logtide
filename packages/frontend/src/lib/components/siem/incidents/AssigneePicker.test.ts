import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import AssigneePicker from './AssigneePicker.svelte';

const members = [
  { id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } },
  { id: 'm2', user: { id: 'u2', name: 'Bob Stone', email: 'bob@example.com' } },
] as never;

async function openMenu() {
  const trigger = screen.getByRole('button');
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
}

describe('AssigneePicker', () => {
  it('shows the member name for a known assignee', () => {
    render(AssigneePicker, { props: { members, value: 'u1', onChange: vi.fn() } });
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('shows Unassigned when there is no assignee', () => {
    render(AssigneePicker, { props: { members, value: null, onChange: vi.fn() } });
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('shows Unknown user when the assignee is not a member', () => {
    render(AssigneePicker, { props: { members, value: 'gone', onChange: vi.fn() } });
    expect(screen.getByText('Unknown user')).toBeTruthy();
  });

  it('trigger has an accessible name', () => {
    render(AssigneePicker, { props: { members, value: 'u2', onChange: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Assignee: Bob Stone' })).toBeTruthy();
  });

  it('calls onChange(null) when choosing Unassigned', async () => {
    const onChange = vi.fn();
    render(AssigneePicker, { props: { members, value: 'u1', onChange } });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Unassigned' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onChange with the member id', async () => {
    const onChange = vi.fn();
    render(AssigneePicker, { props: { members, value: null, onChange } });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Bob Stone/ }));
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('hides Unassigned when allowUnassign is false', async () => {
    render(AssigneePicker, { props: { members, value: 'u1', onChange: vi.fn(), allowUnassign: false } });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Unassigned' })).toBeNull();
  });
});
