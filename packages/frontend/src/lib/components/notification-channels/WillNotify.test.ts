import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

const preview = vi.hoisted(() => vi.fn());
const orgState = vi.hoisted(() => ({ store: null as any }));

vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview },
}));

vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  orgState.store = writable({ currentOrganization: { id: 'org-1' } });
  return { organizationStore: orgState.store };
});

import WillNotify from './WillNotify.svelte';

const ROUTING_HREF = '/dashboard/settings/notifications/routing';
const ops = { id: 'c1', name: 'Ops', type: 'email' };
const hooks = { id: 'c2', name: 'Hooks', type: 'webhook' };

async function settle(ms = 250) {
  await vi.advanceTimersByTimeAsync(ms);
}

function text() {
  return screen.getByTestId('will-notify-text').textContent;
}

function deferred<T>() {
  let resolveFn!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolveFn = r));
  return { promise, resolve: resolveFn };
}

beforeEach(() => {
  vi.useFakeTimers();
  preview.mockReset();
  orgState.store.set({ currentOrganization: { id: 'org-1' } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WillNotify', () => {
  it('renders the destination list', async () => {
    preview.mockResolvedValue({ destinations: [ops, hooks], fallback: null });
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    expect(text()).toBe('Will notify: Ops (email), Hooks (webhook)');
  });

  it('renders destinations and the fallback together', async () => {
    preview.mockResolvedValue({ destinations: [hooks], fallback: 'owners_admins_email' });
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    expect(text()).toBe(
      'Will notify: Hooks (webhook). Will also email organization owners and admins'
    );
  });

  it('renders the fallback alone', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: 'owners_admins_email' });
    render(WillNotify, { props: { eventType: 'incident' } });
    await settle();
    expect(text()).toBe('Will email organization owners and admins');
  });

  it('renders nobody', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: null });
    render(WillNotify, { props: { eventType: 'incident' } });
    await settle();
    expect(text()).toBe('Nobody will be notified');
  });

  it('links to the routing settings page', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: null });
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    const link = screen.getByRole('link', { name: 'Edit routing' });
    expect(link.getAttribute('href')).toBe(ROUTING_HREF);
  });

  it('passes eventType, projectId and channelIds to the api', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: null });
    render(WillNotify, { props: { eventType: 'alert', projectId: 'p1', channelIds: ['c1', 'c2'] } });
    await settle();
    expect(preview).toHaveBeenCalledTimes(1);
    const [params, signal] = preview.mock.calls[0];
    expect(params).toEqual({
      organizationId: 'org-1',
      eventType: 'alert',
      projectId: 'p1',
      channelIds: ['c1', 'c2'],
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('refetches when channelIds change and ignores a stale slower response', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    preview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(WillNotify, { props: { eventType: 'alert', channelIds: ['c1'] } });
    await settle();
    await rerender({ eventType: 'alert', channelIds: ['c1', 'c2'] });
    await settle();
    expect(preview).toHaveBeenCalledTimes(2);

    second.resolve({ destinations: [hooks], fallback: null });
    await settle(0);
    first.resolve({ destinations: [ops], fallback: null });
    await settle(0);

    expect(text()).toBe('Will notify: Hooks (webhook)');
  });

  it('debounces rapid prop changes into one request', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: null });
    const { rerender } = render(WillNotify, { props: { eventType: 'alert', channelIds: ['a'] } });
    await vi.advanceTimersByTimeAsync(50);
    await rerender({ eventType: 'alert', channelIds: ['a', 'b'] });
    await vi.advanceTimersByTimeAsync(50);
    await rerender({ eventType: 'alert', channelIds: ['a', 'b', 'c'] });
    await settle();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0].channelIds).toEqual(['a', 'b', 'c']);
  });

  it('does not request without a current organization', async () => {
    orgState.store.set({ currentOrganization: null });
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByTestId('will-notify')).toBeNull();
  });

  it('refetches when the organization changes', async () => {
    preview.mockResolvedValue({ destinations: [], fallback: null });
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    orgState.store.set({ currentOrganization: { id: 'org-2' } });
    await settle();
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview.mock.calls[1][0].organizationId).toBe('org-2');
  });

  it('shows an error text instead of throwing', async () => {
    preview.mockRejectedValue(new Error('boom'));
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    expect(text()).toBe('Could not load recipients');
  });

  it('shows Checking recipients before the first response', async () => {
    preview.mockReturnValue(new Promise(() => {}));
    render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    expect(text()).toBe('Checking recipients');
  });

  it('does not write state after unmount', async () => {
    const pending = deferred<any>();
    preview.mockReturnValue(pending.promise);
    const { unmount } = render(WillNotify, { props: { eventType: 'alert' } });
    await settle();
    const signal: AbortSignal = preview.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ destinations: [ops], fallback: null });
    await settle(0);
    expect(screen.queryByTestId('will-notify')).toBeNull();
  });
});
