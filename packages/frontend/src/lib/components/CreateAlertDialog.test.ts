import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  getProjects: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: vi.fn().mockResolvedValue({ destinations: [], fallback: false }) },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { organizationStore: writable({ currentOrganization: { id: 'org-1' } }) };
});
vi.mock('$lib/stores/notification-channels', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ channels: [], loading: false, error: null });
  return { notificationChannelsStore: { subscribe: store.subscribe, load: vi.fn() } };
});
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, error: h.error, warning: vi.fn(), info: vi.fn() },
}));
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: h.complete } }));
vi.mock('$lib/api/alerts', async (orig) => {
  const actual = await orig<typeof import('$lib/api/alerts')>();
  return { ...actual, alertsAPI: { createAlertRule: h.create, previewAlertRule: vi.fn() } };
});

import CreateAlertDialog from './CreateAlertDialog.svelte';

function mount(props: Record<string, unknown> = {}) {
  const onSuccess = vi.fn();
  render(CreateAlertDialog, {
    props: { open: true, organizationId: 'org-1', onSuccess, ...props },
  });
  return { onSuccess };
}

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ alertRule: {} });
  h.getProjects
    .mockReset()
    .mockResolvedValue({ projects: [{ id: 'p1', name: 'Web' }, { id: 'p2', name: 'API' }] });
  h.success.mockReset();
  h.error.mockReset();
  h.complete.mockReset();
});
afterEach(() => cleanup());

describe('CreateAlertDialog', () => {
  it('has no Import Sigma Rule tab', async () => {
    mount();
    await screen.findByText('Create alert rule');
    expect(screen.queryByText('Import Sigma Rule')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows the link to /dashboard/security/rules', async () => {
    mount();
    const link = await screen.findByRole('link', { name: /Security > Rules/ });
    expect(link.getAttribute('href')).toBe('/dashboard/security/rules');
  });

  it('submits createAlertRule with projectId, query and renotifyMinutes and toasts', async () => {
    const { onSuccess } = mount({
      initialValues: { name: 'Timeouts', channelIds: ['c1'], projectId: 'p1', query: 'timeout', service: 'api' },
    });
    await screen.findByDisplayValue('Timeouts');
    await fireEvent.change(screen.getByLabelText('Renotify'), { target: { value: '60' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      projectId: 'p1',
      query: 'timeout',
      renotifyMinutes: 60,
      service: 'api',
      name: 'Timeouts',
    });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith('Alert rule created'));
    expect(h.complete).toHaveBeenCalledWith('create-alert');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('prefill from initialValues populates the form', async () => {
    mount({
      initialValues: {
        name: 'From error',
        service: 'billing',
        levels: ['warn'],
        query: 'refused',
        projectId: 'p2',
        channelIds: ['c1'],
      },
    });
    expect(await screen.findByDisplayValue('From error')).toBeTruthy();
    expect(screen.getByDisplayValue('billing')).toBeTruthy();
    expect(screen.getByDisplayValue('refused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'warn' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'error' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect((screen.getByLabelText('Scope') as HTMLSelectElement).value).toBe('p2'));
  });

  it('a project tab projectId locks the scope', async () => {
    mount({ projectId: 'p1', initialValues: { name: 'x', channelIds: ['c1'] } });
    await screen.findByDisplayValue('x');
    await waitFor(() => expect(screen.getByTestId('scope-readonly').textContent).toBe('Web'));
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(h.create.mock.calls[0][0].projectId).toBe('p1'));
  });

  it('closes on success', async () => {
    const onOpenChange = vi.fn();
    mount({ initialValues: { name: 'x', channelIds: ['c1'] }, onOpenChange });
    await screen.findByDisplayValue('x');
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('API failure keeps the dialog open and toasts the message', async () => {
    h.create.mockRejectedValue(new Error('Alert limit reached'));
    const { onSuccess } = mount({ initialValues: { name: 'x', channelIds: ['c1'] } });
    await screen.findByDisplayValue('x');
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Alert limit reached'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Create alert rule')).toBeTruthy();
  });
});
