import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const listMock = vi.fn();
const ticketMock = vi.fn();

vi.mock('$lib/api/incidents', () => ({ incidentsAPI: { list: (...a: unknown[]) => listMock(...a) } }));
vi.mock('$lib/api/stream-tickets', () => ({ requestStreamTicket: (...a: unknown[]) => ticketMock(...a) }));
vi.mock('$lib/api/siem', () => ({ getDashboardStats: vi.fn() }));
vi.mock('$lib/config', () => ({ getApiUrl: () => 'http://api.test' }));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok' }));

import { siemStore } from './siem';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const inc = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `t-${id}`, status: 'open', source: 'alert', ...extra }) as never;

const state = () => get(siemStore);

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  listMock.mockReset();
  let n = 0;
  ticketMock.mockReset();
  ticketMock.mockImplementation(async () => `ticket-${++n}`);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  siemStore.clear();
});

afterEach(() => {
  siemStore.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function seed(ids: string[]) {
  listMock.mockResolvedValueOnce({ incidents: ids.map((i) => inc(i)), total: ids.length });
  await siemStore.loadIncidents('o1', {});
}

describe('siem store incidents', () => {
  it('incident_updated replaces the row in place without changing order', async () => {
    await seed(['a', 'b', 'c']);
    siemStore.handleRealtimeEvent({ type: 'incident_updated', data: inc('b', { status: 'investigating' }) });
    expect(state().incidents.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(state().incidents[1].status).toBe('investigating');
  });

  it('incident_created is ignored when the matcher rejects it', async () => {
    await seed(['a']);
    siemStore.setIncidentMatcher((i) => i.source === 'sigma');
    siemStore.handleRealtimeEvent({ type: 'incident_created', data: inc('z', { source: 'alert' }) });
    expect(state().incidents.map((i) => i.id)).toEqual(['a']);
    siemStore.handleRealtimeEvent({ type: 'incident_created', data: inc('y', { source: 'sigma' }) });
    expect(state().incidents.map((i) => i.id)).toEqual(['y', 'a']);
    expect(state().incidentsTotal).toBe(2);
    expect(state().lastSseEvent?.type).toBe('incident_created');
  });

  it('removeIncident removes the row', async () => {
    await seed(['a', 'b']);
    siemStore.removeIncident('a');
    expect(state().incidents.map((i) => i.id)).toEqual(['b']);
    expect(state().incidentsTotal).toBe(1);
  });

  it('silent load keeps rows and never sets incidentsLoading', async () => {
    await seed(['a']);
    const seen: boolean[] = [];
    const unsub = siemStore.subscribe((s) => seen.push(s.incidentsLoading));
    listMock.mockResolvedValueOnce({ incidents: [inc('a'), inc('b')], total: 2 });
    const p = siemStore.loadIncidents('o1', {}, { silent: true });
    expect(state().incidents).toHaveLength(1);
    await p;
    unsub();
    expect(seen.every((v) => v === false)).toBe(true);
    expect(state().incidents).toHaveLength(2);
  });

  it('stale response from an older loadIncidents call is ignored', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    listMock.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    listMock.mockResolvedValueOnce({ incidents: [inc('new')], total: 1 });
    const first = siemStore.loadIncidents('o1', {});
    const second = siemStore.loadIncidents('o1', {});
    await second;
    resolveFirst({ incidents: [inc('old')], total: 1 });
    await first;
    expect(state().incidents.map((i) => i.id)).toEqual(['new']);
  });

  it('onerror closes the source, requests a NEW ticket and reconnects with backoff 1s, 2s, 4s up to 5 attempts', async () => {
    await siemStore.startRealtimeUpdates('o1');
    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];
    expect(first.url).toContain('ticket=ticket-1');
    first.emit({ type: 'connected', timestamp: 'x' });
    expect(state().sseStatus).toBe('live');

    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(state().sseStatus).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(ticketMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(2);
    const second = FakeEventSource.instances[1];
    expect(second.url).toContain('ticket=ticket-2');
    expect(second.url).not.toBe(first.url);

    // next failure waits 2s
    second.onerror?.();
    await vi.advanceTimersByTimeAsync(1999);
    expect(ticketMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(3);
    const third = FakeEventSource.instances[2];
    third.onerror?.();
    await vi.advanceTimersByTimeAsync(3999);
    expect(ticketMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(4);
  });

  it('after 5 failed attempts status is disconnected and no timers remain', async () => {
    await siemStore.startRealtimeUpdates('o1');
    for (let i = 0; i < 5; i++) {
      FakeEventSource.instances[i].onerror?.();
      await vi.advanceTimersByTimeAsync(1000 * 2 ** i);
    }
    expect(FakeEventSource.instances).toHaveLength(6);
    FakeEventSource.instances[5].onerror?.();
    expect(state().sseStatus).toBe('disconnected');
    expect(state().realtimeEnabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a successful connected event resets the attempt counter', async () => {
    await siemStore.startRealtimeUpdates('o1');
    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(1000);
    FakeEventSource.instances[1].emit({ type: 'connected' });
    FakeEventSource.instances[1].onerror?.();
    // back to a 1s delay, not 2s
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticketMock).toHaveBeenCalledTimes(3);
  });

  it('sends the project filter only for a single project', async () => {
    await siemStore.startRealtimeUpdates('o1', { projectIds: ['p1'], incidentId: 'i1' });
    const url = new URL(FakeEventSource.instances[0].url);
    expect(url.searchParams.get('projectId')).toBe('p1');
    expect(url.searchParams.get('incidentId')).toBe('i1');
    await siemStore.startRealtimeUpdates('o1', { projectIds: ['p1', 'p2'] });
    expect(new URL(FakeEventSource.instances[1].url).searchParams.has('projectId')).toBe(false);
  });

  it('stopRealtimeUpdates clears timers and closes the source', async () => {
    await siemStore.startRealtimeUpdates('o1');
    const es = FakeEventSource.instances[0];
    es.onerror?.();
    expect(vi.getTimerCount()).toBe(1);
    siemStore.stopRealtimeUpdates();
    expect(vi.getTimerCount()).toBe(0);
    expect(state().sseStatus).toBe('idle');
    await vi.advanceTimersByTimeAsync(10000);
    expect(ticketMock).toHaveBeenCalledTimes(1);

    await siemStore.startRealtimeUpdates('o1');
    const live = FakeEventSource.instances[1];
    siemStore.stopRealtimeUpdates();
    expect(live.closed).toBe(true);
  });
});
