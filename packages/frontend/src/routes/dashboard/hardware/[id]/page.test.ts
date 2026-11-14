import { get } from 'svelte/store';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  get: vi.fn(),
  events: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/hardware', () => ({
  getHardwareHost: h.get,
  getHardwareHostEvents: h.events,
  updateHardwareHost: h.update,
  deleteHardwareHost: h.del,
}));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProject = h.getProject;
  },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, warning: vi.fn(), error: h.error, info: vi.fn() },
}));

import Page from './+page.svelte';
import { page } from '$app/state';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { detail, detailResponse, events, summary, vmHost, staleHost } from '$lib/components/hardware/hardware-fixtures';

const org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as 'owner' | 'admin' | 'member',
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function setRole(role: 'owner' | 'admin' | 'member') {
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org, role });
}

async function renderPage() {
  const view = render(Page);
  await waitFor(() => expect(h.get).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  (page as { params: Record<string, string> }).params = { id: 'h-crit' };
  h.get.mockResolvedValue(detailResponse());
  h.events.mockResolvedValue({ events });
  h.getProject.mockResolvedValue({ project: { id: 'p1', organizationId: 'org-1' } });
  h.update.mockResolvedValue({});
  h.del.mockResolvedValue(null);
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  setRole('owner');
});

describe('hardware host detail page', () => {
  it('loads the host and its events and renders the header', async () => {
    await renderPage();
    expect(h.get).toHaveBeenCalledWith('h-crit');
    expect(h.events).toHaveBeenCalledWith('h-crit', 50);
    const header = await screen.findByTestId('host-header');
    expect(within(header).getByText('Dell Inc.')).toBeTruthy();
    expect(within(header).getByText('PowerEdge R640')).toBeTruthy();
    expect(within(header).getByText('6.8.0-45-generic')).toBeTruthy();
    expect(within(header).getByText('1.0.0')).toBeTruthy();
    expect(within(header).getByTestId('hardware-status').textContent).toContain('Critical');
    expect(within(header).getByTestId('last-evaluated').textContent).not.toContain('Not yet');
    expect(screen.queryByTestId('stale-banner')).toBeNull();
    expect(screen.queryByTestId('vm-banner')).toBeNull();
  });

  it('lists findings with severity, message, component and value against threshold', async () => {
    await renderPage();
    const rows = await screen.findAllByTestId('finding');
    expect(rows).toHaveLength(3);
    // critical first
    expect(rows[0].getAttribute('data-severity')).toBe('critical');
    expect(rows[0].textContent).toContain('Disk sda reallocated 14 sectors in the last 7 days');
    expect(rows[0].textContent).toContain('Disks');
    expect(rows[0].textContent).toContain('14 (threshold 10)');
    expect(rows[0].textContent).toContain('disk.reallocated_growing');
  });

  it('shows the collector row with hints for unavailable collectors', async () => {
    await renderPage();
    await screen.findByTestId('collectors');
    expect(screen.getByTestId('collector-smart').getAttribute('data-ok')).toBe('true');
    expect(screen.getByTestId('collector-ipmi').getAttribute('data-ok')).toBe('false');
    expect(screen.getByTestId('collector-hints').textContent).toContain('ipmi: No BMC or ipmitool');
  });

  it('renders the disks table with a critical disk', async () => {
    await renderPage();
    const rows = await screen.findAllByTestId('disk-row');
    expect(rows).toHaveLength(2);
    const sda = rows[0];
    expect(sda.getAttribute('data-status')).toBe('critical');
    expect(sda.textContent).toContain('/dev/sda');
    expect(sda.textContent).toContain('ST4000NM0035');
    expect(sda.textContent).toContain('ATA');
    expect(sda.textContent).toContain('Failed');
    expect(sda.textContent).toContain('24');
    expect(sda.textContent).toContain('+4 in 24 h, +14 in 7 d');
    expect(sda.textContent).toContain('41 °C');
    const nvme = rows[1];
    expect(nvme.textContent).toContain('NVME');
    expect(nvme.textContent).toContain('83%');
    expect(nvme.textContent).toContain('96%');
    expect(nvme.textContent).toContain('52 °C');
  });

  it('lists devices that vanished from the data', async () => {
    await renderPage();
    const missing = await screen.findByTestId('missing-disks');
    expect(missing.textContent).toContain('sdc');
    expect(screen.queryByTestId('missing-memory')).toBeNull();
  });

  it('renders memory totals and ECC deltas per controller', async () => {
    await renderPage();
    const rows = await screen.findAllByTestId('memory-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('mc0');
    expect(screen.queryByRole('columnheader', { name: 'Size' })).toBeNull();
    expect(rows[0].textContent).toContain('+3 in 24 h, +7 in 7 d');
    expect(rows[1].textContent).toContain('DIMM_B1');
    expect(rows[1].textContent).toContain('controller mc1');
    expect(rows[1].textContent).toContain('no change');
    expect(within(screen.getByTestId('section-memory')).getByText(/64 GB/)).toBeTruthy();
  });

  it('renders cpu, cooling, power and network sections', async () => {
    await renderPage();
    const cpu = await screen.findByTestId('cpu-row');
    expect(cpu.textContent).toContain('54 °C');
    expect(cpu.textContent).toContain('90 °C');
    expect(cpu.textContent).toContain('100 °C');
    expect(screen.getByTestId('throttle-row')).toBeTruthy();

    const fan = screen.getByTestId('fan-row');
    expect(fan.textContent).toContain('5,400 rpm');
    expect(fan.textContent).toContain('1,200 rpm');

    expect(screen.getAllByTestId('psu-row')).toHaveLength(2);
    expect(screen.getByTestId('voltage-row').textContent).toContain('12.06 V');
    expect(screen.getByTestId('voltage-row').textContent).toContain('10.8 V crit');
    expect(screen.getByTestId('thermal-row').textContent).toContain('Inlet Temp');
    expect(screen.getByTestId('thermal-row').textContent).toContain('24 °C');

    const nics = screen.getAllByTestId('nic-row');
    expect(nics[0].textContent).toContain('Up');
    expect(nics[0].textContent).toContain('10 Gb/s');
    expect(nics[1].textContent).toContain('Down');
  });

  it('places 7 day sparklines inside their component section', async () => {
    await renderPage();
    const memory = await screen.findByTestId('section-memory');
    expect(within(memory).getByRole('img', { name: 'mc0 corrected errors, last 7 days' })).toBeTruthy();
    const disks = screen.getByTestId('section-disks');
    expect(within(disks).getByRole('img', { name: 'sda reallocated sectors, last 7 days' })).toBeTruthy();
    expect(within(screen.getByTestId('section-cpu')).queryByTestId('trends')).toBeNull();
  });

  it('shows hardware events with a logs link and the detection pack link', async () => {
    await renderPage();
    const list = await screen.findByTestId('events');
    expect(list.textContent).toContain('EDAC MC0: 1 CE memory read error');
    expect(list.textContent).toContain('memory ecc');
    const logs = screen.getByRole('link', { name: 'View in Logs' });
    const href = decodeURIComponent(logs.getAttribute('href')!.replace(/\+/g, ' '));
    expect(href).toContain('/dashboard/logs');
    expect(href).toContain('service:hardware host:db-01');
    expect(screen.getByTestId('pack-link').getAttribute('href')).toBe('/dashboard/alerts');
  });

  it('shows a compact line when there are no events and keeps the page when events fail', async () => {
    h.events.mockResolvedValue({ events: [] });
    const first = await renderPage();
    expect(await screen.findByTestId('no-events')).toBeTruthy();
    first.unmount();

    h.events.mockRejectedValue(new Error('events down'));
    await renderPage();
    expect(await screen.findByText(/Could not load events: events down/)).toBeTruthy();
    expect(await screen.findAllByTestId('finding')).toHaveLength(3);
  });

  it('shows the VM banner and "No data" for sensor sections of a virtual machine', async () => {
    h.get.mockResolvedValue({
      host: detail({
        ...vmHost,
        findings: [],
        collectors: [{ collector: 'net', ok: true }],
        snapshot: {
          disks: { status: 'unknown', disks: [] },
          memory: { status: 'unknown', sizeBytes: null, controllers: [] },
          cpu: { status: 'unknown', sensors: [], throttle: [] },
          cooling: { status: 'unknown', fans: [] },
          power: { status: 'unknown', supplies: [], voltages: [] },
          network: detail().snapshot.network,
        },
      }),
      series: [],
    });
    await renderPage();
    const banner = await screen.findByTestId('vm-banner');
    expect(banner.textContent).toContain('virtual machine');
    expect(within(screen.getByTestId('host-header')).getByTestId('hardware-status').textContent).toContain('No sensors');
    for (const key of ['disks', 'memory', 'cpu', 'cooling', 'power']) {
      expect(screen.getByTestId(`no-data-${key}`).textContent).toBe('No data');
    }
    expect(screen.queryByTestId('no-data-network')).toBeNull();
    expect(screen.getByTestId('no-findings')).toBeTruthy();
  });

  it('shows the stale banner and mute badge for a stale muted host', async () => {
    h.get.mockResolvedValue({ host: detail({ ...staleHost, findings: [] }), series: [] });
    await renderPage();
    const banner = await screen.findByTestId('stale-banner');
    expect(banner.textContent).toContain('stopped reporting');
    expect(banner.querySelector('time')).toBeTruthy();
    expect(screen.getByTestId('muted-badge')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unmute/ })).toBeTruthy();
  });

  it('lets owners and admins mute and unmute', async () => {
    for (const role of ['owner', 'admin'] as const) {
      setRole(role);
      h.get.mockClear();
      h.update.mockClear();
      const view = await renderPage();
      await fireEvent.click(await screen.findByRole('button', { name: /^Mute/ }));
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('h-crit', { muted: true }));
      await waitFor(() => expect(h.success).toHaveBeenCalledWith('Host muted'));
      view.unmount();
    }
  });

  it('takes permissions from the host organization and switches to it', async () => {
    organizationStore.clear();
    organizationStore.setOrganizations([
      { ...org, role: 'owner' },
      { ...org, id: 'org-2', name: 'Other', slug: 'other', role: 'member' },
    ]);
    organizationStore.setCurrentOrganization('org-1');
    h.getProject.mockResolvedValue({ project: { id: 'p1', organizationId: 'org-2' } });
    await renderPage();
    await screen.findByTestId('host-header');
    await waitFor(() => expect(get(organizationStore).currentOrganization?.id).toBe('org-2'));
    expect(screen.queryByRole('button', { name: /Forget/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mute/ })).toBeNull();
  });

  it('hides mute and forget from plain members', async () => {
    setRole('member');
    await renderPage();
    await screen.findByTestId('host-header');
    expect(screen.queryByRole('button', { name: /Mute/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget host' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('forgets a host after confirmation and goes back to the list', async () => {
    await renderPage();
    await fireEvent.click(await screen.findByRole('button', { name: 'Forget host' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('db-01');
    expect(h.del).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Forget host' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('h-crit'));
    await waitFor(() => expect(h.goto).toHaveBeenCalledWith('/dashboard/hardware'));
  });

  it('shows an error state when the host cannot be loaded', async () => {
    h.get.mockRejectedValue(new Error('Host not found'));
    render(Page);
    expect(await screen.findByText('Could not load this host')).toBeTruthy();
    expect(screen.getByText('Host not found')).toBeTruthy();
  });

  it('works for a healthy host without findings', async () => {
    h.get.mockResolvedValue({ host: detail({ ...summary(), findings: [] }), series: [] });
    await renderPage();
    const header = await screen.findByTestId('host-header');
    expect(within(header).getByTestId('hardware-status').textContent).toContain('OK');
    expect(screen.getByTestId('no-findings')).toBeTruthy();
  });
  it('pauses polling while the tab is hidden and refreshes when it is visible again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setVis = (v: string) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      await renderPage();
      await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
      setVis('hidden');
      await vi.advanceTimersByTimeAsync(180_000);
      expect(h.get).toHaveBeenCalledTimes(1);
      setVis('visible');
      await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    } finally {
      setVis('visible');
      vi.useRealTimers();
    }
  });
});
