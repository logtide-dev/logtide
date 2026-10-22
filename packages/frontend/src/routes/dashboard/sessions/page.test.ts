import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getProjects: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));
vi.mock('$lib/api/sessions', () => ({
  sessionsAPI: { listSessions: h.listSessions },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'org1', name: 'Org' }) };
});

import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import SessionsPage from './+page.svelte';

function visit(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/sessions${search}`);
}

function session(id: string, extra: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    service: 'web',
    firstEvent: '2026-01-01T10:00:00Z',
    lastEvent: '2026-01-01T10:03:20Z',
    durationMs: 200_000,
    eventCount: 12,
    errorCount: 0,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  visit();
  scopeStore.set({ projectIds: ['p1'], range: { kind: 'preset', preset: '24h' } });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'One' }] });
  h.listSessions.mockResolvedValue({ sessions: [session('sess-1'), session('sess-2', { errorCount: 3 })] });
});

describe('sessions page', () => {
  it('renders rows without throwing', async () => {
    render(SessionsPage);
    expect(await screen.findByText('sess-1')).toBeInTheDocument();
    expect(screen.getByText('sess-2')).toBeInTheDocument();
    // formatted start time (this used to crash with an undefined formatTime)
    expect(screen.getAllByText(/Jan 1|2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 min 20 s').length).toBe(2);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('time range change refetches with from and to', async () => {
    render(SessionsPage);
    await waitFor(() => expect(h.listSessions).toHaveBeenCalledTimes(1));
    const first = h.listSessions.mock.calls[0][0];
    expect(Date.parse(first.to) - Date.parse(first.from)).toBe(24 * 3600_000);

    scopeStore.setRange({ kind: 'preset', preset: '1h' });
    await waitFor(() => expect(h.listSessions).toHaveBeenCalledTimes(2));
    const second = h.listSessions.mock.calls[1][0];
    expect(Date.parse(second.to) - Date.parse(second.from)).toBe(3600_000);
    expect(second.projectId).toBe('p1');
  });

  it('hides browser column when no row has it, shows it when one does', async () => {
    const view = render(SessionsPage);
    await screen.findByText('sess-1');
    expect(screen.queryByRole('columnheader', { name: 'Browser' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'User' })).toBeNull();
    view.unmount();

    h.listSessions.mockResolvedValue({
      sessions: [session('sess-1', { browser: 'Chrome', os: 'Windows', device: 'desktop', user: 'ann@example.com', entryUrl: '/pricing' })],
    });
    render(SessionsPage);
    expect(await screen.findByRole('columnheader', { name: 'Browser' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Entry URL' })).toBeInTheDocument();
    expect(screen.getByText('Windows / desktop')).toBeInTheDocument();
  });

  it('row link encodes session id with slash', async () => {
    h.listSessions.mockResolvedValue({ sessions: [session('a/b c')] });
    render(SessionsPage);
    const link = await screen.findByText('a/b c');
    expect(link.getAttribute('href')).toBe('/dashboard/sessions/a%2Fb%20c?project=p1');
  });

  it('row click goes to the detail page', async () => {
    render(SessionsPage);
    const cell = (await screen.findAllByText('3 min 20 s'))[0].closest('td')!;
    await fireEvent.click(cell);
    expect(h.goto).toHaveBeenCalledWith('/dashboard/sessions/sess-1?project=p1');
  });

  it('offers to keep searching when a filtered page is empty but more remain', async () => {
    visit('?errors=1');
    h.listSessions
      .mockResolvedValueOnce({ sessions: [], nextCursor: 'CUR1' })
      .mockResolvedValueOnce({ sessions: [session('s-late', { errorCount: 2 })] });
    render(SessionsPage);
    expect(await screen.findByText('No sessions match these filters')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep searching' }));
    expect(await screen.findByText('s-late')).toBeInTheDocument();
    expect(h.listSessions.mock.calls[1][0].cursor).toBe('CUR1');
  });

  it('next and previous follow the cursor', async () => {
    h.listSessions
      .mockResolvedValueOnce({ sessions: [session('s-a')], nextCursor: 'CUR1' })
      .mockResolvedValueOnce({ sessions: [session('s-b')] })
      .mockResolvedValueOnce({ sessions: [session('s-a')], nextCursor: 'CUR1' });
    render(SessionsPage);
    await screen.findByText('s-a');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('s-b');
    expect(h.listSessions.mock.calls[1][0].cursor).toBe('CUR1');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('s-a');
    expect(h.listSessions.mock.calls[2][0].cursor).toBeUndefined();
  });

  it('error state offers retry', async () => {
    h.listSessions.mockRejectedValueOnce(new Error('boom'));
    render(SessionsPage);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('sess-1')).toBeInTheDocument();
    expect(h.listSessions).toHaveBeenCalledTimes(2);
  });

  it('empty state when no sessions', async () => {
    h.listSessions.mockResolvedValue({ sessions: [] });
    render(SessionsPage);
    expect(await screen.findByText('No sessions in this time range')).toBeInTheDocument();
  });

  it('service and errors filters are written to the url and sent to the api', async () => {
    render(SessionsPage);
    await screen.findByText('sess-1');
    await fireEvent.change(screen.getByLabelText('Errors'), { target: { value: '1' } });
    await waitFor(() => expect(h.goto).toHaveBeenCalled());
    expect(String(h.goto.mock.calls.at(-1)![0])).toContain('errors=1');
    await waitFor(() => expect(h.listSessions.mock.calls.at(-1)![0].hasErrors).toBe(true));

    const input = screen.getByLabelText('Service');
    await fireEvent.input(input, { target: { value: 'checkout' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(String(h.goto.mock.calls.at(-1)![0])).toContain('service=checkout'));
    await waitFor(() => expect(h.listSessions.mock.calls.at(-1)![0].service).toBe('checkout'));
  });

  it('filters in the url are applied on load', async () => {
    visit('?errors=0&service=api');
    render(SessionsPage);
    await waitFor(() => expect(h.listSessions).toHaveBeenCalled());
    const call = h.listSessions.mock.calls[0][0];
    expect(call.hasErrors).toBe(false);
    expect(call.service).toBe('api');
  });
});
