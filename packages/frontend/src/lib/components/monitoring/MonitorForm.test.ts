import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const store = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const api = vi.hoisted(() => ({ getMonitorChannels: vi.fn(), setMonitorChannels: vi.fn() }));
const logs = vi.hoisted(() => ({ getServices: vi.fn() }));

vi.mock('$lib/stores/monitoring', () => ({ monitoringStore: store }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/api/monitoring', () => api);
vi.mock('$lib/api/logs', () => ({ logsAPI: logs }));
vi.mock('$lib/components/notification-channels/WillNotify.svelte', async () => ({
  default: (await import('../../../test-stubs/WillNotifyStub.svelte')).default,
}));
vi.mock('$lib/components/notification-channels/ChannelSelector.svelte', async () => ({
  default: (await import('../../../test-stubs/ChannelSelectorStub.svelte')).default,
}));

import MonitorForm from './MonitorForm.svelte';
import type { Monitor } from '$lib/api/monitoring';

const PROJECTS = [
  { id: 'proj-1', name: 'Main' },
  { id: 'proj-2', name: 'Other' },
];

function existing(over: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'API',
    type: 'http',
    target: 'https://example.com',
    intervalSeconds: 120,
    timeoutSeconds: 10,
    gracePeriodSeconds: null,
    failureThreshold: 2,
    autoResolve: true,
    enabled: true,
    httpConfig: { method: 'GET' },
    severity: 'medium',
    displayName: null,
    groupName: null,
    displayOrder: 0,
    checkConfig: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function renderForm(over: Record<string, unknown> = {}) {
  const props = {
    open: true,
    mode: 'create' as const,
    monitor: null,
    orgId: 'org-1',
    projectId: 'proj-1',
    projects: PROJECTS,
    onSaved: vi.fn(),
    ...over,
  };
  return { ...render(MonitorForm, { props }), props };
}

async function chooseType(label: string) {
  await fireEvent.change(screen.getByLabelText('Type'), {
    target: { value: label },
  });
}

beforeEach(() => {
  store.create.mockReset().mockImplementation(async (input) => ({ ...existing(), id: 'new-1', ...input }));
  store.update.mockReset().mockImplementation(async (id, _org, patch) => ({ ...existing(), id, ...patch }));
  api.getMonitorChannels.mockReset().mockResolvedValue({ channels: [] });
  api.setMonitorChannels.mockReset().mockResolvedValue(null);
  logs.getServices.mockReset().mockResolvedValue([]);
});

describe('MonitorForm', () => {
  it('shows HTTP fields by default and SSL fields after choosing SSL certificate', async () => {
    renderForm();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Warn when fewer than/)).toBeNull();
    await chooseType('ssl');
    expect(screen.getByLabelText(/Warn when fewer than/)).toBeInTheDocument();
    expect(screen.queryByLabelText('URL')).toBeNull();
    // SSL defaults replace untouched numeric fields.
    expect((screen.getByLabelText('Check interval (seconds)') as HTMLInputElement).value).toBe('3600');
    expect((screen.getByLabelText('Failure threshold') as HTMLInputElement).value).toBe('1');
  });

  it('keeps numeric fields the user edited when the type changes', async () => {
    renderForm();
    await fireEvent.input(screen.getByLabelText('Check interval (seconds)'), { target: { value: '90' } });
    await chooseType('dns');
    expect((screen.getByLabelText('Check interval (seconds)') as HTMLInputElement).value).toBe('90');
  });

  it('HTTP fields: method select, blank expected status hint "Any 2xx", header rows add and remove, body assertion', async () => {
    renderForm();
    const method = screen.getByLabelText('Method') as HTMLSelectElement;
    expect(Array.from(method.options).map((o) => o.value)).toEqual([
      'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
    ]);
    expect(screen.getByLabelText('Expected status')).toHaveAttribute('placeholder', 'Any 2xx');

    await fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    expect(screen.getByLabelText('Header 1 name')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    expect(screen.getByLabelText('Header 2 name')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove header 1' }));
    expect(screen.queryByLabelText('Header 2 name')).toBeNull();

    expect(screen.queryByLabelText('Text')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Response body check'), { target: { value: 'contains' } });
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    await fireEvent.change(screen.getByLabelText('Response body check'), { target: { value: 'regex' } });
    expect(screen.getByLabelText('Pattern')).toBeInTheDocument();
  });

  it('submit for ssl sends checkConfig.warnDays 14 and target host:port', async () => {
    const { props } = renderForm();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Cert' } });
    await chooseType('ssl');
    await fireEvent.input(screen.getByLabelText(/Host/), { target: { value: 'example.com:8443' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
    const payload = store.create.mock.calls[0][0];
    expect(payload.type).toBe('ssl');
    expect(payload.target).toBe('example.com:8443');
    expect(payload.checkConfig).toEqual({ warnDays: 14 });
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
  });

  it('submit for dns sends recordType and expectedValue', async () => {
    renderForm();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'MX' } });
    await chooseType('dns');
    await fireEvent.input(screen.getByLabelText('Hostname'), { target: { value: 'example.com' } });
    await fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'MX' } });
    await fireEvent.input(screen.getByLabelText('Expected value'), { target: { value: 'mx.example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
    expect(store.create.mock.calls[0][0].checkConfig).toEqual({
      recordType: 'MX',
      expectedValue: 'mx.example.com',
    });
  });

  it('blocks submit with inline errors for empty name and NaN interval', async () => {
    renderForm();
    await fireEvent.input(screen.getByLabelText('URL'), { target: { value: 'https://a.co' } });
    await fireEvent.input(screen.getByLabelText('Check interval (seconds)'), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    expect(await screen.findByText('Enter a name')).toBeInTheDocument();
    expect(screen.getByText(/Enter a whole number between 30 and 86,400/)).toBeInTheDocument();
    expect(store.create).not.toHaveBeenCalled();
  });

  it('edit mode prefills values and saves channels with the selected ids', async () => {
    api.getMonitorChannels.mockResolvedValue({ channels: [{ id: 'ch-9' }] });
    const { props } = renderForm({ mode: 'edit', monitor: existing() });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('API');
    expect((screen.getByLabelText('Check interval (seconds)') as HTMLInputElement).value).toBe('120');
    expect(screen.queryByLabelText('Type')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('channel-selector').getAttribute('data-selected')).toBe('ch-9')
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Pick channel one' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.update).toHaveBeenCalledTimes(1));
    expect(store.update.mock.calls[0][0]).toBe('m1');
    expect(store.update.mock.calls[0][2]).not.toHaveProperty('type');
    await waitFor(() =>
      expect(api.setMonitorChannels).toHaveBeenCalledWith('m1', 'org-1', ['ch-9', 'ch-1'])
    );
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  });

  it('renders WillNotify with eventType monitoring and the selected channel ids', async () => {
    renderForm();
    const node = screen.getByTestId('will-notify');
    expect(node.getAttribute('data-event-type')).toBe('monitoring');
    expect(node.getAttribute('data-project-id')).toBe('proj-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Pick channel one' }));
    await waitFor(() =>
      expect(screen.getByTestId('will-notify').getAttribute('data-channel-ids')).toBe('ch-1')
    );
  });

  it('severity select offers the five severities', () => {
    renderForm();
    const select = screen.getByLabelText('Severity') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'critical', 'high', 'medium', 'low', 'informational',
    ]);
  });

  it('auto-resolve checkbox is labelled "Resolve the incident automatically on recovery" and defaults on', () => {
    renderForm();
    const box = screen.getByLabelText('Resolve the incident automatically on recovery') as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('public display name and group inputs are present under "Status page"', () => {
    renderForm();
    expect(screen.getByText('Status page')).toBeInTheDocument();
    expect(screen.getByLabelText('Public display name')).toBeInTheDocument();
    expect(screen.getByLabelText('Group')).toBeInTheDocument();
  });

  it('header remove buttons have aria-labels', async () => {
    renderForm({ mode: 'edit', monitor: existing({ httpConfig: { method: 'GET', headers: { A: '1', B: '2' } } }) });
    expect(screen.getByRole('button', { name: 'Remove header 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove header 2' })).toBeInTheDocument();
  });

  it('duplicate mode creates a new monitor named "(copy)"', async () => {
    renderForm({ mode: 'duplicate', monitor: existing({ displayName: 'Public API' }) });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('API (copy)');
    expect((screen.getByLabelText('Public display name') as HTMLInputElement).value).toBe('');
    await fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
    expect(store.update).not.toHaveBeenCalled();
  });
});
