import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  listStatusUpdates: vi.fn(),
  createStatusUpdate: vi.fn(),
  postStatusUpdateMessage: vi.fn(),
  deleteStatusUpdate: vi.fn(),
  getStatusPageConfig: vi.fn(),
}));

vi.mock('$lib/api/status-page', () => api);
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';
import { page } from '$app/state';
import StatusUpdatesPanel from './StatusUpdatesPanel.svelte';
import { parseUptimeUrl } from './uptime-url';
import type { Monitor } from '$lib/api/monitoring';

function monitor(id: string, name: string, displayName: string | null = null): Monitor {
  return {
    id,
    organizationId: 'org-1',
    projectId: 'proj-1',
    name,
    type: 'http',
    target: 'https://example.com',
    intervalSeconds: 60,
    timeoutSeconds: 10,
    gracePeriodSeconds: null,
    failureThreshold: 2,
    autoResolve: true,
    enabled: true,
    httpConfig: null,
    severity: 'high',
    displayName,
    groupName: null,
    displayOrder: 0,
    checkConfig: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

const MONITORS = [monitor('m1', 'api-internal', 'Public API'), monitor('m2', 'Billing')];

const ITEM = {
  id: 's1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  title: 'API latency',
  status: 'investigating',
  severity: 'major',
  createdAt: '2026-10-22T10:00:00Z',
  updatedAt: '2026-10-22T10:00:00Z',
  resolvedAt: null,
  monitorIds: ['m1'],
  sourceIncidentId: null,
};

function setUrl(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/uptime${search}`);
}

function renderPanel(prefill = null as ReturnType<typeof parseUptimeUrl>['prefill']) {
  return render(StatusUpdatesPanel, {
    props: { orgId: 'org-1', projectId: 'proj-1', monitors: MONITORS, prefill },
  });
}

beforeEach(() => {
  vi.mocked(goto).mockClear();
  setUrl('?tab=status-updates');
  api.listStatusUpdates.mockReset().mockResolvedValue({ incidents: [ITEM] });
  api.createStatusUpdate.mockReset().mockResolvedValue({ incident: ITEM });
  api.postStatusUpdateMessage.mockReset().mockResolvedValue({ update: {} });
  api.deleteStatusUpdate.mockReset().mockResolvedValue(null);
  api.getStatusPageConfig
    .mockReset()
    .mockResolvedValue({ config: {}, subscriptionsAvailable: false });
});

describe('StatusUpdatesPanel', () => {
  it('copy uses "Status updates" and "New status update"', async () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Status updates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New status update' })).toBeInTheDocument();
    await screen.findByText('API latency');
  });

  it('list shows affected component chips and the status and severity badges', async () => {
    renderPanel();
    await screen.findByText('API latency');
    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getByText('Investigating')).toBeInTheDocument();
    expect(screen.getByTestId('affected-chip').textContent?.trim()).toBe('Public API');
  });

  it('shows an empty state when there are no updates', async () => {
    api.listStatusUpdates.mockResolvedValue({ incidents: [] });
    renderPanel();
    expect(await screen.findByText('No status updates yet')).toBeInTheDocument();
  });

  it('prefill from the URL opens the create dialog with title, mapped severity, message and affected components', async () => {
    setUrl(
      '?tab=status-updates&create=1&title=API%20down&severity=high&message=Looking%20into%20it&monitorIds=m2&sourceIncidentId=inc-7'
    );
    renderPanel(parseUptimeUrl(page.url).prefill);
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('API down');
    expect((within(dialog).getByLabelText('Severity') as HTMLSelectElement).value).toBe('major');
    expect((within(dialog).getByLabelText('Message (optional)') as HTMLTextAreaElement).value).toBe(
      'Looking into it'
    );
    expect((within(dialog).getByLabelText('Billing') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Public API') as HTMLInputElement).checked).toBe(false);
  });

  it('create sends monitorIds and sourceIncidentId', async () => {
    setUrl('?tab=status-updates&create=1&title=API%20down&severity=critical&monitorIds=m1,m2,gone&sourceIncidentId=inc-7');
    renderPanel(parseUptimeUrl(page.url).prefill);
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Publish update' }));
    await waitFor(() => expect(api.createStatusUpdate).toHaveBeenCalledTimes(1));
    const body = api.createStatusUpdate.mock.calls[0][0];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      projectId: 'proj-1',
      title: 'API down',
      severity: 'critical',
      monitorIds: ['m1', 'm2'],
      sourceIncidentId: 'inc-7',
    });
  });

  it('closing the dialog removes create=1 from the URL', async () => {
    setUrl('?tab=status-updates&create=1&title=x');
    renderPanel(parseUptimeUrl(page.url).prefill);
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(goto).toHaveBeenCalled());
    const url = vi.mocked(goto).mock.calls[0][0] as URL;
    expect(url.searchParams.has('create')).toBe(false);
    expect(url.searchParams.has('title')).toBe(false);
  });

  it('requires a title before publishing', async () => {
    renderPanel();
    await screen.findByText('API latency');
    await fireEvent.click(screen.getByRole('button', { name: 'New status update' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Publish update' }));
    expect(await within(dialog).findByText('Enter a title')).toBeInTheDocument();
    expect(api.createStatusUpdate).not.toHaveBeenCalled();
  });

  it('deleting a status update asks for confirmation first', async () => {
    renderPanel();
    await screen.findByText('API latency');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete API latency' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.deleteStatusUpdate).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete status update' }));
    await waitFor(() => expect(api.deleteStatusUpdate).toHaveBeenCalledWith('s1', 'org-1'));
  });

  it('post update dialog requires a message and can resolve', async () => {
    renderPanel();
    await screen.findByText('API latency');
    await fireEvent.click(screen.getByRole('button', { name: 'Post an update to API latency' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Post update' });
    expect(submit).toBeDisabled();

    await fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'resolved' } });
    await fireEvent.input(within(dialog).getByLabelText('Message'), { target: { value: 'Fixed.' } });
    expect(submit).not.toBeDisabled();
    await fireEvent.click(submit);
    await waitFor(() =>
      expect(api.postStatusUpdateMessage).toHaveBeenCalledWith('s1', 'org-1', {
        status: 'resolved',
        message: 'Fixed.',
      })
    );
  });

  it('hint about email subscribers appears only when subscriptions are available', async () => {
    renderPanel();
    await screen.findByText('API latency');
    await fireEvent.click(screen.getByRole('button', { name: 'New status update' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('subscribers-hint')).toBeNull();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('shows the subscribers hint when subscriptions are available', async () => {
    api.getStatusPageConfig.mockResolvedValue({ config: {}, subscriptionsAvailable: true });
    renderPanel();
    await screen.findByText('API latency');
    await waitFor(() => expect(api.getStatusPageConfig).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'New status update' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('subscribers-hint')).toBeInTheDocument();
  });
});
