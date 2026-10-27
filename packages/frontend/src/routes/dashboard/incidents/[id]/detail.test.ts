import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  addComment: vi.fn(),
  getMembers: vi.fn(),
  getAlertRule: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/incidents', () => ({
  incidentsAPI: { get: h.get, update: h.update, remove: h.remove, addComment: h.addComment },
}));
vi.mock('$lib/api/alerts', () => ({ alertsAPI: { getAlertRule: h.getAlertRule } }));
vi.mock('$lib/api/organizations', () => ({
  organizationsAPI: { getOrganizationMembers: h.getMembers },
}));
vi.mock('$lib/api/stream-tickets', () => ({ requestStreamTicket: vi.fn().mockResolvedValue('t') }));
vi.mock('$lib/api/siem', () => ({ getDashboardStats: vi.fn() }));
vi.mock('$lib/utils/siem', () => ({ exportIncidentToPdf: vi.fn() }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, warning: vi.fn(), error: h.error, info: vi.fn() },
}));

import Page from './+page.svelte';
import { page } from '$app/state';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { siemStore } from '$lib/stores/siem';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {}
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
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

const inc = (extra: Record<string, unknown> = {}) => ({
  id: 'i1',
  organizationId: 'org-1',
  title: 'Brute force on auth',
  description: null,
  severity: 'high',
  status: 'open',
  source: 'sigma',
  projectId: 'p1',
  project: { id: 'p1', name: 'Web' },
  assigneeId: 'u1',
  assignee: null,
  traceId: null,
  mitreTactics: null,
  mitreTechniques: null,
  affectedServices: ['auth'],
  ipReputation: null,
  geoData: null,
  monitorId: null,
  alertRuleId: null,
  sourceRef: null,
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
  lastEventAt: '2026-10-22T10:30:00.000Z',
  resolvedAt: null,
  ...extra,
});

const detail = (incExtra: Record<string, unknown> = {}) => ({
  incident: inc(incExtra),
  detections: [],
  comments: [],
  history: [],
  sourceEvents: [],
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  Object.values(h).forEach((m) => m.mockReset());
  h.get.mockResolvedValue(detail());
  h.getMembers.mockResolvedValue({
    members: [{ id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } }],
  });
  (page as { params: Record<string, string> }).params = { id: 'i1' };
  (page as { url: URL }).url = new URL('http://localhost/dashboard/incidents/i1');
  siemStore.clear();
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

afterEach(() => {
  siemStore.stopRealtimeUpdates();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const view = render(Page);
  await screen.findByRole('heading', { name: 'Brute force on auth' });
  return view;
}

describe('incident detail page', () => {
  it('renders header with severity, Acknowledged status and source badges', async () => {
    h.get.mockResolvedValue(detail({ status: 'investigating' }));
    await renderPage();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Acknowledged')).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
  });

  it('breadcrumbs are Incidents > <title>', async () => {
    await renderPage();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.textContent).toContain('Incidents');
    expect(nav.textContent).toContain('Brute force on auth');
    expect(screen.getByRole('link', { name: 'Incidents' }).getAttribute('href')).toBe('/dashboard/incidents');
  });

  it('Acknowledge calls update with investigating and updates the badge without the page skeleton', async () => {
    h.update.mockResolvedValue(inc({ status: 'investigating', updatedAt: '2026-10-22T11:00:00.000Z' }));
    await renderPage();
    h.get.mockResolvedValue(detail({ status: 'investigating', updatedAt: '2026-10-22T11:00:00.000Z' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(h.update).toHaveBeenCalledWith('i1', 'org-1', { status: 'investigating' });
    await waitFor(() => expect(screen.getByText('Acknowledged')).toBeTruthy());
    expect(screen.queryByLabelText('Loading incident')).toBeNull();
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('unassign sends assigneeId null', async () => {
    h.update.mockResolvedValue(inc({ assigneeId: null, updatedAt: '2026-10-22T11:00:00.000Z' }));
    await renderPage();
    await fireEvent.keyDown(screen.getByRole('button', { name: /Assignee:/ }), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Unassigned' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('i1', 'org-1', { assigneeId: null }));
  });

  it('Mark false positive updates status and, with no detections, opens no dialog', async () => {
    h.update.mockResolvedValue(inc({ status: 'false_positive', updatedAt: '2026-10-22T11:00:00.000Z' }));
    await renderPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Mark false positive' }));
    expect(h.update).toHaveBeenCalledWith('i1', 'org-1', { status: 'false_positive' });
    await waitFor(() => expect(screen.getByText('False positive')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Add exception' })).toBeNull();
  });

  it('false positive on a sigma incident opens Add exception prefilled from the detection', async () => {
    h.update.mockResolvedValue(inc({ status: 'false_positive', updatedAt: '2026-10-22T11:00:00.000Z' }));
    h.get.mockResolvedValue({
      ...detail(),
      detections: [
        {
          id: 'd1',
          time: '2026-10-22T10:00:00.000Z',
          organizationId: 'org-1',
          projectId: 'p1',
          sigmaRuleId: 'rule-7',
          logId: 'l1',
          severity: 'high',
          ruleTitle: 'Failed logins',
          ruleDescription: null,
          mitreTactics: null,
          mitreTechniques: null,
          service: 'auth',
          logLevel: 'error',
          logMessage: 'bad password',
          traceId: null,
          matchedFields: { user: 'bob' },
          incidentId: 'i1',
          category: 'security',
        },
      ],
    });
    await renderPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Mark false positive' }));
    expect(await screen.findByRole('heading', { name: 'Add exception' })).toBeTruthy();
    expect((screen.getByLabelText('Field 1') as HTMLInputElement).value).toBe('service');
    expect((screen.getByLabelText('Value 1') as HTMLInputElement).value).toBe('auth');
    expect((screen.getByLabelText('Field 2') as HTMLInputElement).value).toBe('user');
    expect((screen.getByLabelText('Value 2') as HTMLInputElement).value).toBe('bob');
    expect(screen.getByRole('dialog').textContent).toContain('"Failed logins"');
  });

  it('an SSE incident_updated for this id merges into the page and a burst of detections reloads once, silently', async () => {
    await renderPage();
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.instances[0].url).toContain('incidentId=i1');
    FakeEventSource.instances[0].emit({ type: 'connected', timestamp: 'x' });

    FakeEventSource.instances[0].emit({
      type: 'incident_updated',
      data: inc({ title: 'Renamed by someone', updatedAt: '2026-10-22T12:00:00.000Z' }),
    });
    await screen.findByRole('heading', { name: 'Renamed by someone' });

    const before = h.get.mock.calls.length;
    for (let i = 0; i < 3; i++) FakeEventSource.instances[0].emit({ type: 'detection_created', data: {} });
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(before), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(h.get.mock.calls.length).toBe(before + 1);
    expect(screen.queryByLabelText('Loading incident')).toBeNull();
  });

  it('404 renders EmptyState Incident not found with a Back to incidents link', async () => {
    h.get.mockRejectedValue(Object.assign(new Error('Incident not found'), { status: 404 }));
    render(Page);
    expect(await screen.findByText('Incident not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to incidents' }).getAttribute('href')).toBe('/dashboard/incidents');
  });

  it('publish navigates to the W12 status-page URL', async () => {
    h.get.mockResolvedValue(detail({ source: 'monitor', monitorId: 'mon-1', severity: 'high', projectId: 'p1' }));
    await renderPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Publish to status page' }));
    const url = new URL(h.goto.mock.calls.at(-1)![0] as string, 'http://x');
    expect(url.pathname).toBe('/dashboard/uptime');
    expect(url.searchParams.get('tab')).toBe('status-updates');
    expect(url.searchParams.get('create')).toBe('1');
    expect(url.searchParams.get('severity')).toBe('major');
    expect(url.searchParams.get('monitorIds')).toBe('mon-1');
    expect(url.searchParams.get('sourceIncidentId')).toBe('i1');
  });

  it('delete after confirm navigates to /dashboard/incidents', async () => {
    h.remove.mockResolvedValue(undefined);
    await renderPage();
    await fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Delete incident/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole('menuitem', { name: /Delete incident/ }));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(h.remove).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('i1', 'org-1'));
    await waitFor(() => expect(h.goto).toHaveBeenCalledWith('/dashboard/incidents'));
  });
});
