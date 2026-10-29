import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import type { CustomDashboard } from '@logtide/shared';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  getDefault: vi.fn(),
  getById: vi.fn(),
  fetchPanelData: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  duplicate: vi.fn(),
  listTemplates: vi.fn(),
  createFromTemplate: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/custom-dashboards', () => ({ customDashboardsAPI: api }));
vi.mock('$lib/stores/toast', () => ({ toastStore: toast }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = vi.fn().mockResolvedValue({ projects: [] });
  },
}));
vi.mock('$lib/api/logs', () => ({ logsAPI: { createLogsWebSocket: vi.fn() } }));

import DashboardsView from '$lib/components/custom-dashboards/DashboardsView.svelte';
import { organizationStore } from '$lib/stores/organization';
import { customDashboardsStore } from '$lib/stores/custom-dashboards';

// jsdom lacks these; bits-ui menus and selects call them.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const ID_DEFAULT = '11111111-1111-4111-8111-111111111111';
const ID_OTHER = '22222222-2222-4222-8222-222222222222';
const ID_MISSING = '00000000-0000-0000-0000-000000000000';

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

const org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const home = dash(ID_DEFAULT, 'Home', true);
const other = dash(ID_OTHER, 'Backend');

function urlOf(search = ''): URL {
  return new URL(`http://localhost/dashboard${search}`);
}

function mountView(search = '') {
  return render(DashboardsView, { props: { url: urlOf(search), navigate: navigateSpy } });
}

async function openMenu() {
  const trigger = screen.getByRole('button', { name: /Home|Backend|Select dashboard/ });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

async function clickMenuItem(name: RegExp | string) {
  const item = await screen.findByRole('menuitem', { name });
  await fireEvent.click(item);
}

function lastNavigatedSearch(): string | null {
  const call = navigateSpy.mock.calls.at(-1);
  return call ? (call[0] as URL).search : null;
}

async function pickOption(triggerName: string, optionName: string) {
  const trigger = screen.getByRole('button', { name: triggerName });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: optionName });
  await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
}

beforeEach(() => {
  customDashboardsStore.reset();
  Object.values(api).forEach((m) => m.mockReset());
  Object.values(toast).forEach((m) => m.mockReset());
  navigateSpy.mockReset();
  api.list.mockResolvedValue([home, other]);
  api.getDefault.mockResolvedValue(home);
  api.getById.mockRejectedValue(new Error('Dashboard not found'));
  api.fetchPanelData.mockResolvedValue({ panels: {} });
  api.listTemplates.mockResolvedValue([]);
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

afterEach(() => cleanup());

describe('dashboards page', () => {
  it('unknown id in the url falls back to the default and cleans the url', async () => {
    mountView(`?id=${ID_MISSING}`);
    await screen.findByRole('button', { name: /Home/ });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(lastNavigatedSearch()).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a dashboard that is visible in the list is selected from the url', async () => {
    mountView(`?id=${ID_OTHER}`);
    await screen.findByRole('button', { name: /Backend/ });
    expect(api.getById).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('invalid range in the url is ignored', async () => {
    mountView('?range=banana');
    await screen.findByRole('button', { name: /Home/ });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(lastNavigatedSearch()).toBe('');
    for (const call of api.fetchPanelData.mock.calls) {
      expect(call[3]).toBeUndefined();
    }
  });

  it('choosing a dashboard writes ?id=', async () => {
    mountView();
    await screen.findByRole('button', { name: /Home/ });
    await openMenu();
    await clickMenuItem(/Backend/);
    await waitFor(() => expect(lastNavigatedSearch()).toBe(`?id=${ID_OTHER}`));
  });

  it('choosing the default removes ?id=', async () => {
    mountView(`?id=${ID_OTHER}`);
    await screen.findByRole('button', { name: /Backend/ });
    await openMenu();
    await clickMenuItem(/^Home/);
    await waitFor(() => expect(lastNavigatedSearch()).toBe(''));
  });

  it('choosing a time range writes ?range= and Panel defaults removes it', async () => {
    const view = mountView();
    await screen.findByRole('button', { name: /Home/ });
    await pickOption('Dashboard time range', 'Last 7 days');
    await waitFor(() => expect(lastNavigatedSearch()).toBe('?range=7d'));
    // The router applies the URL; the page then sees the new one.
    await view.rerender({ url: urlOf('?range=7d'), navigate: navigateSpy });

    await pickOption('Dashboard time range', 'Panel defaults');
    await waitFor(() => expect(lastNavigatedSearch()).toBe(''));
  });

  it('back navigation re-selects the dashboard from the url', async () => {
    const view = mountView();
    await screen.findByRole('button', { name: /Home/ });
    await view.rerender({ url: urlOf(`?id=${ID_OTHER}`), navigate: navigateSpy });
    await screen.findByRole('button', { name: /Backend/ });
    await view.rerender({ url: urlOf(), navigate: navigateSpy });
    await screen.findByRole('button', { name: /Home/ });
  });

  it('delete opens ConfirmDialog and never calls window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    mountView(`?id=${ID_OTHER}`);
    await screen.findByRole('button', { name: /Backend/ });
    await openMenu();
    await clickMenuItem('Delete dashboard');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      '"Backend" and its panels will be deleted. This cannot be undone.'
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  async function confirmDeleteFlow() {
    await screen.findByRole('button', { name: /Backend/ });
    await openMenu();
    await clickMenuItem('Delete dashboard');
    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete dashboard'
    )!;
    await fireEvent.click(confirmButton);
  }

  it('confirming delete calls deleteDashboard and drops id from the url', async () => {
    api.delete.mockResolvedValue(undefined);
    const view = mountView(`?id=${ID_OTHER}`);
    await confirmDeleteFlow();
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(ID_OTHER, 'org-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dashboard deleted'));
    await waitFor(() => expect(lastNavigatedSearch()).toBe(''));
    await view.rerender({ url: urlOf(), navigate: navigateSpy });
    await screen.findByRole('button', { name: /Home/ });
  });

  it('delete failure shows an error toast and no success toast', async () => {
    api.delete.mockRejectedValue(new Error('Server exploded'));
    mountView(`?id=${ID_OTHER}`);
    await confirmDeleteFlow();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server exploded'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('empty dashboard shows Create from template', async () => {
    mountView();
    await screen.findByText('No panels yet');
    expect(screen.getByRole('button', { name: /Create from template/ })).toBeInTheDocument();
  });

  it('error state offers Retry', async () => {
    api.getDefault.mockRejectedValueOnce(new Error('boom'));
    mountView();
    await screen.findByText('Could not load the dashboard');
    api.getDefault.mockResolvedValue(home);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: /Home/ });
  });

  it('rename saves through the store and toasts', async () => {
    api.update.mockResolvedValue({ ...home, name: 'Ops' });
    mountView();
    await screen.findByRole('button', { name: /Home/ });
    await openMenu();
    await clickMenuItem('Rename');
    const input = await screen.findByLabelText('Name');
    await fireEvent.input(input, { target: { value: 'Ops' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dashboard renamed'));
    expect(api.update).toHaveBeenCalledWith(ID_DEFAULT, 'org-1', { name: 'Ops', description: null });
  });

  it('duplicate toasts and opens the copy', async () => {
    const copy = dash('33333333-3333-4333-8333-333333333333', 'Home (copy)');
    api.duplicate.mockResolvedValue(copy);
    mountView();
    await screen.findByRole('button', { name: /Home/ });
    await openMenu();
    await clickMenuItem('Duplicate');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dashboard duplicated'));
    await waitFor(() => expect(lastNavigatedSearch()).toBe(`?id=${copy.id}`));
  });
});
