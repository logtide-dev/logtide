import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { CustomDashboard } from '@logtide/shared';
import DashboardSwitcher from './DashboardSwitcher.svelte';

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

function dash(id: string, name: string, isDefault = false): CustomDashboard {
  return {
    id,
    organizationId: 'org-1',
    projectId: null,
    userId: null,
    name,
    description: null,
    isDefault,
    isPersonal: false,
    schemaVersion: 1,
    panels: [],
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as CustomDashboard;
}

const home = dash('d1', 'Home', true);
const other = dash('d2', 'Backend');

function mount(active: CustomDashboard | null) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onCreateFromTemplate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onDelete: vi.fn(),
    onSetDefault: vi.fn(),
  };
  render(DashboardSwitcher, { props: { dashboards: [home, other], active, ...handlers } });
  return handlers;
}

async function open() {
  const trigger = screen.getByRole('button');
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
}

describe('DashboardSwitcher', () => {
  it('shows Rename and Duplicate only with an active dashboard', async () => {
    mount(null);
    await open();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /New from template/ })).toBeInTheDocument();
  });

  it('wires Rename, Duplicate and New from template', async () => {
    const h = mount(other);
    await open();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(h.onRename).toHaveBeenCalled();
    await open();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(h.onDuplicate).toHaveBeenCalled();
    await open();
    await fireEvent.click(screen.getByRole('menuitem', { name: /New from template/ }));
    expect(h.onCreateFromTemplate).toHaveBeenCalled();
  });

  it('Delete is hidden for the default dashboard', async () => {
    mount(home);
    await open();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete dashboard' })).toBeNull();
  });

  it('Delete is offered for other dashboards', async () => {
    mount(other);
    await open();
    expect(screen.getByRole('menuitem', { name: 'Delete dashboard' })).toBeInTheDocument();
  });
});
