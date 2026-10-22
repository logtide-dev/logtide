import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';

const m = vi.hoisted(() => ({
  getProjects: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  listKeys: vi.fn(),
  createKey: vi.fn(),
  deleteKey: vi.fn(),
  listReceivers: vi.fn(),
  createReceiver: vi.fn(),
  updateReceiver: vi.fn(),
  deleteReceiver: vi.fn(),
  firstSignal: vi.fn(),
  goto: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: { params: { id: 'p1' }, url: new URL('http://localhost/dashboard/projects/p1/settings') },
}));
vi.mock('$app/navigation', () => ({ goto: m.goto }));
vi.mock('$lib/stores/organization', () => ({
  currentOrganization: readable({ id: 'o1', name: 'Acme', slug: 'acme' }),
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: m.toastSuccess, error: m.toastError, info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: vi.fn() } }));
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: m.getProjects,
    updateProject: m.updateProject,
    deleteProject: m.deleteProject,
  },
}));
vi.mock('$lib/api/api-keys', () => ({
  apiKeysAPI: { list: m.listKeys, create: m.createKey, delete: m.deleteKey },
}));
vi.mock('$lib/api/receivers', () => ({
  receiversAPI: {
    list: m.listReceivers,
    create: m.createReceiver,
    update: m.updateReceiver,
    delete: m.deleteReceiver,
  },
}));
vi.mock('$lib/api/first-signal', () => ({ firstSignalAPI: { get: m.firstSignal } }));

import SettingsPage from './+page.svelte';
import { PROJECT_TRASH_TOAST } from '$lib/utils/project-trash';

const project = {
  id: 'p1',
  name: 'Checkout',
  description: 'Payments',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

const keys = [
  {
    id: 'k1',
    projectId: 'p1',
    name: 'Server key',
    keyPrefix: 'lp_ab12cd',
    type: 'write',
    allowedOrigins: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    lastUsed: null,
    revoked: false,
  },
  {
    id: 'k2',
    projectId: 'p1',
    name: 'Old key',
    keyPrefix: null,
    type: 'full',
    allowedOrigins: ['https://a.example.com'],
    createdAt: '2026-01-01T10:00:00.000Z',
    lastUsed: '2026-10-03T10:00:00.000Z',
    revoked: false,
  },
];

const receivers = [
  {
    id: 'r1',
    projectId: 'p1',
    name: 'CI hook',
    adapterType: 'github',
    fieldMapping: null,
    enabled: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    lastReceivedAt: null,
  },
];

async function renderLoaded() {
  render(SettingsPage);
  await screen.findByRole('heading', { name: 'Project settings' });
  await screen.findByText('Server key');
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getProjects.mockResolvedValue({ projects: [project] });
  m.listKeys.mockResolvedValue({ apiKeys: keys });
  m.listReceivers.mockResolvedValue({ receivers });
  m.firstSignal.mockResolvedValue({
    logs: true,
    traces: false,
    metrics: false,
    errors: false,
    firstAt: '2026-10-03T09:00:00.000Z',
    lastEventAt: '2026-10-03T10:00:00.000Z',
  });
  m.deleteKey.mockResolvedValue(undefined);
  m.deleteProject.mockResolvedValue(undefined);
  m.deleteReceiver.mockResolvedValue(undefined);
});

describe('project settings page', () => {
  it('renders the five sections with anchors other pages can link to', async () => {
    await renderLoaded();
    for (const id of ['general', 'connect', 'api-keys', 'inbound-webhooks', 'danger-zone']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#general', '#connect', '#api-keys', '#inbound-webhooks', '#danger-zone']);
    expect(screen.getByText('Applies to: Project')).toBeInTheDocument();
  });

  it('shows the key prefix and a muted note for keys created before 1.6', async () => {
    await renderLoaded();
    expect(screen.getByText('lp_ab12cd...')).toBeInTheDocument();
    expect(screen.getByText('Created before 1.6')).toBeInTheDocument();
  });

  it('shows the endpoints block, the snippets and the last event line', async () => {
    await renderLoaded();
    expect(screen.getByText('Ingest URL')).toBeInTheDocument();
    expect(screen.getByText('DSN template')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Last event/)).toBeInTheDocument());
    expect(m.firstSignal).toHaveBeenCalledWith('p1');
  });

  it('deletes an API key through the confirm dialog', async () => {
    await renderLoaded();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete API key Server key' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete API key' })).toBeInTheDocument();
    expect(dialog.textContent).toContain('stop sending data');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete API key' }));
    await waitFor(() => expect(m.deleteKey).toHaveBeenCalledWith('p1', 'k1'));
    expect(m.toastSuccess).toHaveBeenCalledWith('API key deleted');
  });

  it('calls the section Receivers with a Create receiver button', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Receivers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create receiver' })).toBeInTheDocument();
    expect(screen.getByText('CI hook')).toBeInTheDocument();
  });

  it('deletes a receiver through the confirm dialog', async () => {
    await renderLoaded();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete receiver CI hook' }));
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete receiver' }));
    await waitFor(() => expect(m.deleteReceiver).toHaveBeenCalledWith('p1', 'r1'));
    expect(m.toastSuccess).toHaveBeenCalledWith('Receiver deleted');
  });

  it('moves the project to the trash only after typing its name', async () => {
    await renderLoaded();
    await fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(
      'Checkout stops accepting data and moves to the trash. You can restore it within 30 days.'
    );
    const confirm = within(dialog).getByRole('button', { name: 'Move to trash' });
    expect(confirm).toBeDisabled();
    await fireEvent.input(within(dialog).getByRole('textbox'), { target: { value: 'Checkout' } });
    expect(confirm).not.toBeDisabled();
    await fireEvent.click(confirm);
    await waitFor(() => expect(m.deleteProject).toHaveBeenCalledWith('o1', 'p1'));
    expect(m.toastSuccess).toHaveBeenCalledWith(PROJECT_TRASH_TOAST);
    expect(m.goto).toHaveBeenCalledWith('/dashboard/projects');
  });

  it('saves general changes with the short toast', async () => {
    m.updateProject.mockResolvedValue({});
    await renderLoaded();
    await fireEvent.input(screen.getByLabelText('Project name'), { target: { value: 'Checkout v2' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(m.updateProject).toHaveBeenCalledWith('o1', 'p1', {
        name: 'Checkout v2',
        description: 'Payments',
      })
    );
    expect(m.toastSuccess).toHaveBeenCalledWith('Project updated');
  });

  it('never says successfully in toasts', async () => {
    await renderLoaded();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete API key Server key' }));
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete API key' }));
    await waitFor(() => expect(m.toastSuccess).toHaveBeenCalled());
    for (const call of m.toastSuccess.mock.calls) {
      expect(String(call[0])).not.toMatch(/successfully|!$/i);
    }
  });
});
