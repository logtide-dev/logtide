import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  getSessionEvents: vi.fn(),
}));

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false }));
vi.mock('$lib/api/sessions', () => ({
  sessionsAPI: { getSessionEvents: h.getSessionEvents },
}));

import { page } from '$app/state';
import SessionPage from './+page.svelte';

function visit(sessionId: string, search = '?project=p1') {
  const p = page as unknown as { url: URL; params: Record<string, string> };
  p.url = new URL(`http://localhost/dashboard/sessions/${encodeURIComponent(sessionId)}${search}`);
  p.params = { sessionId };
}

function ev(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    time: '2026-01-01T10:00:00.000Z',
    service: 'web',
    level: 'info',
    message: `message ${id}`,
    ...extra,
  };
}

const WINDOW = { from: '2026-01-01T10:00:00.000Z', to: '2026-01-01T10:05:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  visit('sess-1');
  h.getSessionEvents.mockResolvedValue({
    events: [ev('e1', { traceId: 'trace-abc' })],
    window: WINDOW,
    truncated: false,
  });
});

describe('session detail page', () => {
  it('renders trace id as link with project param', async () => {
    render(SessionPage);
    const link = await screen.findByRole('link', { name: /Trace trace-ab/ });
    expect(link).toHaveAttribute('href', '/dashboard/traces/trace-abc?project=p1');
  });

  it('error event shows View error link when errorGroupId present', async () => {
    h.getSessionEvents.mockResolvedValue({
      events: [
        ev('e1', { level: 'error', errorGroupId: 'grp-1' }),
        ev('e2', { level: 'info', errorGroupId: 'grp-2' }),
      ],
      window: WINDOW,
      truncated: false,
    });
    render(SessionPage);
    const links = await screen.findAllByRole('link', { name: 'View error' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard/errors/grp-1');
  });

  it('View logs link carries session query and padded window', async () => {
    render(SessionPage);
    const link = await screen.findByRole('link', { name: 'View logs' });
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('session:sess-1');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-01-01T09:59:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-01-01T10:06:00.000Z');
  });

  it('session id with space and slash is quoted in the logs query', async () => {
    visit('a b/c"d');
    render(SessionPage);
    const link = await screen.findByRole('link', { name: 'View logs' });
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.searchParams.get('q')).toBe('session:"a b/c\\"d"');
    expect(h.getSessionEvents.mock.calls[0][0].sessionId).toBe('a b/c"d');
  });

  it('404 renders Session not found state', async () => {
    h.getSessionEvents.mockRejectedValue(new Error('Session not found'));
    render(SessionPage);
    expect(await screen.findByRole('heading', { name: 'Session not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sessions' })).toHaveAttribute(
      'href',
      '/dashboard/sessions?project=p1',
    );
  });

  it('empty events render Session not found state', async () => {
    h.getSessionEvents.mockResolvedValue({ events: [], window: null, truncated: false });
    render(SessionPage);
    expect(await screen.findByRole('heading', { name: 'Session not found' })).toBeInTheDocument();
  });

  it('other errors offer retry', async () => {
    h.getSessionEvents.mockRejectedValueOnce(new Error('boom'));
    render(SessionPage);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('truncated notice shown', async () => {
    h.getSessionEvents.mockResolvedValue({ events: [ev('e1')], window: WINDOW, truncated: true });
    render(SessionPage);
    expect(await screen.findByText('Showing the first 1,000 events')).toBeInTheDocument();
  });

  it('missing project param shows guidance state', async () => {
    visit('sess-1', '');
    render(SessionPage);
    expect(await screen.findByText('No project selected')).toBeInTheDocument();
    expect(h.getSessionEvents).not.toHaveBeenCalled();
  });

  it('reads the legacy projectId param', async () => {
    visit('sess-1', '?projectId=legacy');
    render(SessionPage);
    await waitFor(() => expect(h.getSessionEvents).toHaveBeenCalled());
    expect(h.getSessionEvents.mock.calls[0][0].projectId).toBe('legacy');
  });

  it('renders breadcrumbs with a link back to the list', async () => {
    render(SessionPage);
    await screen.findByText('message e1');
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      '/dashboard/sessions?project=p1',
    );
  });
});
