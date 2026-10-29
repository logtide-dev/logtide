import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  list: vi.fn(),
  bulk: vi.fn(),
  getProjects: vi.fn(),
  getMembers: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/api/incidents', () => ({
  incidentsAPI: { list: h.list, bulk: h.bulk },
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/organizations', () => ({
  organizationsAPI: { getOrganizationMembers: h.getMembers },
}));
vi.mock('$lib/api/stream-tickets', () => ({ requestStreamTicket: vi.fn().mockResolvedValue('t') }));
vi.mock('$lib/api/siem', () => ({ getDashboardStats: vi.fn() }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, warning: h.warning, error: h.error, info: vi.fn() },
}));

import Page from './+page.svelte';
import { page } from '$app/state';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { siemStore } from '$lib/stores/siem';
import { scopeStore } from '$lib/stores/scope';

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

const inc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org-1',
  title: `Incident ${id}`,
  severity: 'high',
  status: 'open',
  source: 'alert',
  projectId: null,
  assigneeId: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  lastEventAt: '2026-01-01T10:30:00.000Z',
  ...extra,
});

function setUrl(qs = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/incidents${qs}`);
}

async function renderPage() {
  const view = render(Page);
  await waitFor(() => expect(h.list).toHaveBeenCalled());
  return view;
}

const lastFilters = () => h.list.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  Object.values(h).forEach((m) => m.mockReset());
  h.list.mockResolvedValue({ incidents: [inc('a'), inc('b')], total: 2 });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'Project One' }] });
  h.getMembers.mockResolvedValue({ members: [] });
  setUrl();
  siemStore.clear();
  scopeStore.reset();
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

afterEach(() => {
  siemStore.stopRealtimeUpdates();
  vi.unstubAllGlobals();
});

describe('inbox page', () => {
  it('loads with default status filter and 25 per page', async () => {
    await renderPage();
    const f = lastFilters();
    expect(f.organizationId).toBe('org-1');
    expect(f.status).toEqual(['open', 'investigating']);
    expect(f.limit).toBe(25);
    expect(f.offset).toBe(0);
    expect(await screen.findByText('Incident a')).toBeTruthy();
  });

  it('shared link with status=all and source=alert loads those filters', async () => {
    setUrl('?status=all&source=alert&severity=high');
    await renderPage();
    const f = lastFilters();
    expect(f.status).toBeUndefined();
    expect(f.source).toEqual(['alert']);
    expect(f.severity).toEqual(['high']);
  });

  it('legacy repeated status, projectId and out of range page are read', async () => {
    setUrl('?status=resolved&status=open&projectId=p1&page=0');
    await renderPage();
    const f = lastFilters();
    expect(f.status).toEqual(['resolved', 'open']);
    expect(f.projectIds).toEqual(['p1']);
    expect(f.offset).toBe(0);
  });

  it('a ruleId param filters and shows a removable chip', async () => {
    setUrl('?source=sigma&ruleId=rule-9');
    await renderPage();
    expect(lastFilters().ruleId).toBe('rule-9');
    expect(screen.getByText('rule-9')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove rule filter' }));
    const url = h.goto.mock.calls.at(-1)![0] as URL;
    expect(url.searchParams.has('ruleId')).toBe(false);
    expect(url.searchParams.get('source')).toBe('sigma');
  });

  it('400 invalid_assignee drops the stale assignee from the URL', async () => {
    setUrl('?assignee=me&source=alert');
    h.list.mockRejectedValueOnce(
      Object.assign(new Error('Assignee is not a member of this organization'), {
        status: 400,
        code: 'invalid_assignee',
      })
    );
    await renderPage();
    await waitFor(() => expect(h.goto).toHaveBeenCalled());
    const [url, opts] = h.goto.mock.calls.at(-1)!;
    expect((url as URL).searchParams.has('assignee')).toBe(false);
    expect((url as URL).searchParams.get('source')).toBe('alert');
    expect(opts.replaceState).toBe(true);
  });

  it('other list errors keep the assignee and show the error state', async () => {
    setUrl('?assignee=me');
    h.list.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(await screen.findByText('Could not load incidents')).toBeTruthy();
    expect(h.goto).not.toHaveBeenCalled();
  });

  it('changing a filter updates the URL (replaceState) and resets page to 1 and clears selection', async () => {
    setUrl('?page=2');
    h.list.mockResolvedValue({ incidents: [inc('a'), inc('b')], total: 60 });
    await renderPage();
    await screen.findByText('Incident a');
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await fireEvent.click(boxes[0]);
    expect(screen.getByText('1 selected')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    const [url, opts] = h.goto.mock.calls.at(-1)!;
    expect((url as URL).searchParams.get('assignee')).toBe('me');
    expect((url as URL).searchParams.has('page')).toBe(false);
    expect(opts.replaceState).toBe(true);
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('bulk acknowledge reports "3 of 5 updated" when the server returns skipped ids, then reloads silently and clears selection', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((i) => inc(i));
    h.list.mockResolvedValue({ incidents: rows, total: 5 });
    h.bulk.mockResolvedValue({
      updated: [rows[0], rows[1], rows[2]],
      skipped: [
        { id: 'd', reason: 'invalid_transition' },
        { id: 'e', reason: 'not_found' },
      ],
    });
    await renderPage();
    await screen.findByText('Incident a');
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByText('5 selected')).toBeTruthy();
    const callsBefore = h.list.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(h.warning).toHaveBeenCalled());
    const message = h.warning.mock.calls[0][0] as string;
    expect(message).toContain('3 of 5 updated');
    expect(message).toContain('Incident d');
    expect(message).toContain('Incident e');
    expect(h.bulk).toHaveBeenCalledWith({
      organizationId: 'org-1',
      ids: ['a', 'b', 'c', 'd', 'e'],
      action: 'acknowledge',
    });
    await waitFor(() => expect(h.list.mock.calls.length).toBe(callsBefore + 1));
    expect(screen.queryByText('5 selected')).toBeNull();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('bulk failure keeps the selection and shows an error toast', async () => {
    h.bulk.mockRejectedValue(new Error('Forbidden'));
    await renderPage();
    await screen.findByText('Incident a');
    await fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Forbidden'));
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('row title links to the detail route', async () => {
    await renderPage();
    const link = await screen.findByRole('link', { name: 'Incident a' });
    expect(link.getAttribute('href')).toBe('/dashboard/incidents/a');
  });

  it('fetch error renders EmptyState variant error with Retry', async () => {
    h.list.mockRejectedValueOnce(new Error('Boom'));
    await renderPage();
    expect(await screen.findByText('Could not load incidents')).toBeTruthy();
    expect(screen.getByText('Boom')).toBeTruthy();
    h.list.mockResolvedValueOnce({ incidents: [inc('z')], total: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Incident z')).toBeTruthy();
  });

  it('empty with filters offers Clear filters', async () => {
    setUrl('?source=monitor');
    h.list.mockResolvedValue({ incidents: [], total: 0 });
    await renderPage();
    expect(await screen.findByText('No incidents match these filters')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const url = h.goto.mock.calls.at(-1)![0] as URL;
    expect(url.searchParams.has('source')).toBe(false);
  });

  it('empty without filters links to Create alert and detection rules', async () => {
    h.list.mockResolvedValue({ incidents: [], total: 0 });
    await renderPage();
    expect(await screen.findByText('No incidents')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create alert' }).getAttribute('href')).toBe(
      '/dashboard/alerts?create=1'
    );
    expect(screen.getByRole('link', { name: 'Open detection rules' }).getAttribute('href')).toBe(
      '/dashboard/security/rules'
    );
  });

  it('SSE incident_updated updates the row without showing the skeleton', async () => {
    await renderPage();
    await screen.findByText('Incident a');
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    FakeEventSource.instances[0].emit({ type: 'incident_updated', data: inc('a', { status: 'investigating' }) });
    expect(await screen.findByText('Acknowledged')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('connection pill shows Live, Reconnecting, Disconnected', async () => {
    await renderPage();
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    FakeEventSource.instances[0].emit({ type: 'connected' });
    expect((await screen.findByTestId('connection-pill')).textContent).toContain('Live');
    FakeEventSource.instances[0].onerror?.();
    await waitFor(() => expect(screen.getByTestId('connection-pill').textContent).toContain('Reconnecting'));
  });

  it('connection pill shows Disconnected after the retries are exhausted', async () => {
    await renderPage();
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 6; i++) {
        FakeEventSource.instances[i].onerror?.();
        await vi.advanceTimersByTimeAsync(3000 * 2 ** i);
      }
      await tick();
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId('connection-pill').textContent).toContain('Disconnected');
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });
});
