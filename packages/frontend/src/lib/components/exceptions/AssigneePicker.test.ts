import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AssigneePicker from './AssigneePicker.svelte';

const members = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
];

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Assign error' });
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

describe('AssigneePicker', () => {
  it('trigger has aria-label Assign error', () => {
    render(AssigneePicker, { members, value: null, onChange: vi.fn() });
    expect(screen.getByRole('button', { name: 'Assign error' })).toBeInTheDocument();
  });

  it('shows the current assignee on the trigger', () => {
    render(AssigneePicker, { members, value: 'u2', onChange: vi.fn() });
    expect(screen.getByRole('button', { name: 'Assign error' })).toHaveTextContent('Grace Hopper');
  });

  it('shows Unassigned when nobody is assigned', () => {
    render(AssigneePicker, { members, value: null, onChange: vi.fn() });
    expect(screen.getByRole('button', { name: 'Assign error' })).toHaveTextContent('Unassigned');
  });

  it('lists members and Unassigned', async () => {
    render(AssigneePicker, { members, value: null, onChange: vi.fn() });
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /Unassigned/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Grace Hopper/ })).toBeInTheDocument();
  });

  it('selecting a member calls onChange with the id', async () => {
    const onChange = vi.fn();
    render(AssigneePicker, { members, value: null, onChange });
    await openMenu();
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Grace Hopper/ }));
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('selecting Unassigned calls onChange(null)', async () => {
    const onChange = vi.fn();
    render(AssigneePicker, { members, value: 'u1', onChange });
    await openMenu();
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Unassigned/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marks the current member', async () => {
    render(AssigneePicker, { members, value: 'u1', onChange: vi.fn() });
    await openMenu();
    const item = await screen.findByRole('menuitem', { name: /Ada Lovelace/ });
    expect(item.querySelector('[aria-label="Current assignee"]')).not.toBeNull();
  });
});
