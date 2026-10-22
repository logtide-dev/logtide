import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  getProjects: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
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
vi.mock('$lib/api/alerts', async (orig) => {
  const actual = await orig<typeof import('$lib/api/alerts')>();
  return { ...actual, alertsAPI: { updateAlertRule: h.update, previewAlertRule: vi.fn() } };
});

import EditAlertDialog from './EditAlertDialog.svelte';
import type { AlertRule } from '$lib/api/alerts';

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    organizationId: 'org-1',
    projectId: 'p1',
    name: 'Timeouts',
    enabled: true,
    service: 'api',
    level: ['error'],
    threshold: 20,
    timeWindow: 10,
    alertType: 'threshold',
    baselineType: null,
    deviationMultiplier: null,
    minBaselineValue: null,
    cooldownMinutes: null,
    sustainedMinutes: null,
    emailRecipients: [],
    webhookUrl: null,
    channelIds: ['c1'],
    metadataFilters: [],
    query: 'timeout',
    renotifyMinutes: 30,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function mount(alert: AlertRule) {
  const onSuccess = vi.fn();
  render(EditAlertDialog, { props: { open: true, organizationId: 'org-1', alert, onSuccess } });
  return { onSuccess };
}

beforeEach(() => {
  h.update.mockReset().mockResolvedValue({ alertRule: {} });
  h.getProjects.mockReset().mockResolvedValue({ projects: [{ id: 'p1', name: 'Web' }] });
  h.success.mockReset();
  h.error.mockReset();
});
afterEach(() => cleanup());

describe('EditAlertDialog', () => {
  it('loads the rule including query and renotify', async () => {
    mount(rule());
    expect(await screen.findByDisplayValue('Timeouts')).toBeTruthy();
    expect((screen.getByLabelText('Query') as HTMLInputElement).value).toBe('timeout');
    expect((screen.getByLabelText('Renotify') as HTMLSelectElement).value).toBe('30');
    expect(screen.getByDisplayValue('20')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('scope-readonly').textContent).toBe('Web'));
  });

  it('submits updateAlertRule without projectId and toasts', async () => {
    const { onSuccess } = mount(rule());
    await screen.findByDisplayValue('Timeouts');
    await fireEvent.input(screen.getByLabelText('Alert name'), { target: { value: 'Timeouts v2' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const [orgId, id, body] = h.update.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(id).toBe('r1');
    expect(body.name).toBe('Timeouts v2');
    expect(body.query).toBe('timeout');
    expect(body.renotifyMinutes).toBe(30);
    expect('projectId' in body).toBe(false);
    await waitFor(() => expect(h.success).toHaveBeenCalledWith('Alert rule updated'));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('switching threshold to rate of change clears query and renotify in the payload', async () => {
    mount(rule());
    await screen.findByDisplayValue('Timeouts');
    await fireEvent.click(screen.getByRole('button', { name: /Rate of change/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const body = h.update.mock.calls[0][2];
    expect(body.alertType).toBe('rate_of_change');
    expect(body.query).toBeNull();
    expect(body.renotifyMinutes).toBeNull();
    expect(body.deviationMultiplier).toBe(3);
  });
});
