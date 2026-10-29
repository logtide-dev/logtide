import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseLogQuery, type LogSearchQuery } from '@logtide/shared';
import type { LogEntry } from '$lib/api/logs';
import { createLiveTail, LIVE_TAIL_LIMITS, type LiveTailOptions, type LiveTailSnapshot } from './live-tail';
import { FakeWebSocket, deferred, makeLog, resetLogIds } from './test-fixtures';

const T1 = '2026-10-21T10:00:01.000Z';
const T2 = '2026-10-21T10:00:02.000Z';
const T3 = '2026-10-21T10:00:03.000Z';

function query(q: string): LogSearchQuery {
  const parsed = parseLogQuery(q);
  if (!parsed.ok) throw new Error(`bad test query ${q}`);
  return parsed.query;
}

function setup(over: Partial<Omit<LiveTailOptions, 'onUpdate'>> = {}) {
  const sockets: FakeWebSocket[] = [];
  const connect = vi.fn(async () => {
    const ws = new FakeWebSocket();
    sockets.push(ws);
    return ws.asWebSocket();
  });
  const onUpdate = vi.fn<(s: LiveTailSnapshot) => void>();
  const tail = createLiveTail({ connect, query: null, limit: 100, onUpdate, ...over });
  const last = (): LiveTailSnapshot => {
    const call = onUpdate.mock.calls.at(-1);
    if (!call) throw new Error('onUpdate never called');
    return call[0];
  };
  const socket = (i = sockets.length - 1) => sockets[i];
  return { tail, connect: (over.connect as typeof connect | undefined) ?? connect, sockets, socket, onUpdate, last };
}

/** Flush the connect promise (and any timers due now). */
const flush = () => vi.advanceTimersByTimeAsync(0);

async function goLive(t: ReturnType<typeof setup>, initial: LogEntry[] = []) {
  t.tail.start(initial);
  await flush();
  t.socket().emit({ type: 'connected', subscriberId: 'sub-1' });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLogIds();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createLiveTail', () => {
  it('offers the buffer sizes of the spec', () => {
    expect(LIVE_TAIL_LIMITS).toEqual([50, 100, 200, 500, 1000]);
  });

  it('is connecting until the connected message, then live', async () => {
    const t = setup();
    t.tail.start([]);
    expect(t.last().state).toBe('connecting');
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.last().state).toBe('connecting');
    t.socket().emit({ type: 'connected', subscriberId: 'sub-1' });
    expect(t.last()).toMatchObject({ state: 'live', attempt: 0, pausedBy: null, pendingCount: 0 });
  });

  it('keeps the initial rows capped at the limit', () => {
    const t = setup({ limit: 2 });
    const rows = [makeLog({ time: T3 }), makeLog({ time: T2 }), makeLog({ time: T1 })];
    t.tail.start(rows);
    expect(t.last().logs.map((l) => l.time)).toEqual([T3, T2]);
  });

  it('prepends matching logs newest first and caps at the limit', async () => {
    const t = setup({ limit: 4 });
    const initial = makeLog({ time: '2026-10-21T09:59:00.000Z', message: 'initial' });
    await goLive(t, [initial]);
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T1 }), makeLog({ time: T3 }), makeLog({ time: T2 })] });
    expect(t.last().logs.map((l) => l.time)).toEqual([T3, T2, T1, initial.time]);
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: '2026-10-21T10:00:04.000Z' })] });
    expect(t.last().logs).toHaveLength(4);
    expect(t.last().logs[0].time).toBe('2026-10-21T10:00:04.000Z');
    expect(t.last().logs.map((l) => l.message)).not.toContain('initial');
  });

  it('caps a single large batch at the limit', async () => {
    const t = setup({ limit: 2 });
    await goLive(t);
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T1 }), makeLog({ time: T3 }), makeLog({ time: T2 })] });
    expect(t.last().logs.map((l) => l.time)).toEqual([T3, T2]);
  });

  it('drops streamed logs that do not match the query', async () => {
    const t = setup({ query: query('level:error') });
    await goLive(t);
    t.socket().emit({
      type: 'logs',
      logs: [makeLog({ level: 'info', message: 'fine' }), makeLog({ level: 'error', message: 'boom' })],
    });
    expect(t.last().logs.map((l) => l.message)).toEqual(['boom']);
  });

  it('matches the host from metadata and the free text of the query', async () => {
    const t = setup({ query: query('host:web-2 timeout') });
    await goLive(t);
    t.socket().emit({
      type: 'logs',
      logs: [
        makeLog({ hostname: null, metadata: { hostname: 'web-2' }, message: 'db timeout' }),
        makeLog({ hostname: null, metadata: { hostname: 'web-1' }, message: 'db timeout' }),
        makeLog({ hostname: 'web-2', metadata: null, message: 'all good' }),
      ],
    });
    expect(t.last().logs).toHaveLength(1);
    expect(t.last().logs[0].metadata).toEqual({ hostname: 'web-2' });
  });

  it('does not notify for a batch with no match', async () => {
    const t = setup({ query: query('level:error') });
    await goLive(t);
    const calls = t.onUpdate.mock.calls.length;
    t.socket().emit({ type: 'logs', logs: [makeLog({ level: 'info' })] });
    expect(t.onUpdate.mock.calls.length).toBe(calls);
  });

  it('survives odd rows and malformed messages', async () => {
    const t = setup({ query: query('timeout') });
    await goLive(t);
    t.socket().emit('not json');
    t.socket().emit({ type: 'logs', logs: 'nope' });
    t.socket().emit({ type: 'logs', logs: [null, 7, { time: T1, message: null, level: 'info', service: 'api', projectId: 'p1' }] });
    t.socket().emit({ type: 'logs', logs: [makeLog({ message: 'a timeout' })] });
    expect(t.last().logs.map((l) => l.message)).toEqual(['a timeout']);
    expect(t.last().state).toBe('live');
  });

  it('buffers while paused and flushes on resume', async () => {
    const t = setup();
    const initial = makeLog({ time: '2026-10-21T09:59:00.000Z' });
    await goLive(t, [initial]);
    t.tail.pause('manual');
    expect(t.last().pausedBy).toBe('manual');
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T1 }), makeLog({ time: T2 }), makeLog({ time: T3 })] });
    expect(t.last().logs.map((l) => l.time)).toEqual([initial.time]);
    expect(t.last().pendingCount).toBe(3);
    t.tail.resume();
    expect(t.last().logs.map((l) => l.time)).toEqual([T3, T2, T1, initial.time]);
    expect(t.last()).toMatchObject({ pendingCount: 0, pausedBy: null });
  });

  it('caps the pending buffer at the limit while counting every log', async () => {
    const t = setup({ limit: 2 });
    await goLive(t);
    t.tail.pause('scroll');
    const times = [1, 2, 3, 4, 5].map((s) => `2026-10-21T10:00:0${s}.000Z`);
    for (const time of times) t.socket().emit({ type: 'logs', logs: [makeLog({ time })] });
    expect(t.last().pendingCount).toBe(5);
    t.tail.resume();
    expect(t.last().logs.map((l) => l.time)).toEqual([times[4], times[3]]);
    expect(t.last().pendingCount).toBe(0);
  });

  it('a scroll pause never replaces a manual pause', async () => {
    const t = setup();
    await goLive(t);
    t.tail.pause('manual');
    t.tail.pause('scroll');
    expect(t.last().pausedBy).toBe('manual');
    t.tail.resume();
    t.tail.pause('scroll');
    t.tail.pause('manual');
    expect(t.last().pausedBy).toBe('manual');
  });

  it('reconnects with backoff 1s, 2s, 4s, 8s, 16s then disconnects', async () => {
    const t = setup();
    await goLive(t);
    t.socket().drop(1006);
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < delays.length; i++) {
      expect(t.last()).toMatchObject({ state: 'reconnecting', attempt: i + 1 });
      await vi.advanceTimersByTimeAsync(delays[i] - 1);
      expect(t.connect).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.connect).toHaveBeenCalledTimes(i + 2);
      t.socket().drop(1006);
    }
    expect(t.last().state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.connect).toHaveBeenCalledTimes(6);
  });

  it('honours custom backoff options', async () => {
    const t = setup({ maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 150 });
    await goLive(t);
    t.socket().drop(1006);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.connect).toHaveBeenCalledTimes(2);
    t.socket().drop(1006);
    await vi.advanceTimersByTimeAsync(149);
    expect(t.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.connect).toHaveBeenCalledTimes(3);
    t.socket().drop(1006);
    expect(t.last().state).toBe('disconnected');
  });

  it('resets attempts after a successful connection', async () => {
    const t = setup();
    await goLive(t);
    t.socket().drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    t.socket().drop(1006);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.connect).toHaveBeenCalledTimes(3);
    t.socket().emit({ type: 'connected', subscriberId: 'sub-2' });
    expect(t.last()).toMatchObject({ state: 'live', attempt: 0 });
    t.socket().drop(1006);
    expect(t.last()).toMatchObject({ state: 'reconnecting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.connect).toHaveBeenCalledTimes(4);
  });

  it('keeps the rows across a reconnect', async () => {
    const t = setup();
    await goLive(t);
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T1 })] });
    t.socket().drop(1006);
    expect(t.last().logs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    t.socket().emit({ type: 'connected', subscriberId: 'sub-2' });
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T2 })] });
    expect(t.last().logs.map((l) => l.time)).toEqual([T2, T1]);
  });

  it('does not retry after a 1008 close', async () => {
    const t = setup();
    await goLive(t);
    t.socket().drop(1008, 'Access denied');
    expect(t.last()).toMatchObject({ state: 'disconnected', error: 'Access denied' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps the server error of a rejected query', async () => {
    const t = setup();
    t.tail.start([]);
    await flush();
    t.socket().emit({ type: 'error', error: 'Unexpected ")"', position: 7 });
    t.socket().drop(1008);
    expect(t.last()).toMatchObject({ state: 'disconnected', error: 'Unexpected ")"' });
    expect(t.connect).toHaveBeenCalledTimes(1);
  });

  it('counts a rejected connect as a failed attempt', async () => {
    const t = setup();
    t.connect.mockRejectedValueOnce(new Error('ticket failed')).mockRejectedValueOnce(new Error('ticket failed'));
    t.tail.start([]);
    await flush();
    expect(t.last()).toMatchObject({ state: 'reconnecting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.connect).toHaveBeenCalledTimes(2);
    expect(t.last()).toMatchObject({ state: 'reconnecting', attempt: 2 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.connect).toHaveBeenCalledTimes(3);
    t.socket().emit({ type: 'connected', subscriberId: 'sub-1' });
    expect(t.last().state).toBe('live');
  });

  it('treats a throwing connect like a rejected one', async () => {
    const t = setup();
    t.connect.mockImplementationOnce(() => {
      throw new Error('no WebSocket');
    });
    t.tail.start([]);
    await flush();
    expect(t.last()).toMatchObject({ state: 'reconnecting', attempt: 1 });
  });

  it('retry() reconnects from disconnected', async () => {
    const t = setup();
    await goLive(t);
    t.socket().drop(1008);
    expect(t.last().state).toBe('disconnected');
    t.tail.retry();
    expect(t.last()).toMatchObject({ state: 'connecting', attempt: 0, error: null });
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(2);
    t.socket().emit({ type: 'connected', subscriberId: 'sub-2' });
    expect(t.last().state).toBe('live');
  });

  it('retry() skips a pending backoff wait', async () => {
    const t = setup();
    await goLive(t);
    t.socket().drop(1006);
    t.tail.retry();
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.connect).toHaveBeenCalledTimes(2);
  });

  it('stop() closes the socket and cancels a pending reconnect', async () => {
    const t = setup();
    await goLive(t);
    const first = t.socket();
    t.tail.stop();
    expect(first.closed).toBe(true);
    expect(first.onclose).toBeNull();

    const u = setup();
    await goLive(u);
    u.socket().drop(1006);
    u.tail.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(u.connect).toHaveBeenCalledTimes(1);
  });

  it('a stopped tail ignores late messages and calls', async () => {
    const t = setup();
    await goLive(t);
    const ws = t.socket();
    const handler = ws.onmessage;
    t.tail.stop();
    t.onUpdate.mockClear();
    handler?.({ data: JSON.stringify({ type: 'logs', logs: [makeLog()] }) } as MessageEvent);
    t.tail.retry();
    t.tail.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.onUpdate).not.toHaveBeenCalled();
    expect(t.connect).toHaveBeenCalledTimes(1);
  });

  it('closes a socket that resolves after stop()', async () => {
    const pending = deferred<WebSocket>();
    const connect = vi.fn(() => pending.promise);
    const t = setup({ connect });
    t.tail.start([]);
    t.tail.stop();
    t.onUpdate.mockClear();
    const late = new FakeWebSocket();
    pending.resolve(late.asWebSocket());
    await flush();
    expect(late.closed).toBe(true);
    late.emit({ type: 'connected', subscriberId: 'late' });
    expect(t.onUpdate).not.toHaveBeenCalled();
  });

  it('a restart drops the socket of the previous run', async () => {
    const t = setup();
    await goLive(t);
    const first = t.socket();
    t.tail.start([]);
    expect(first.closed).toBe(true);
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(2);
    expect(t.last()).toMatchObject({ state: 'connecting', logs: [] });
  });

  it('setLimit trims the rows and the pending buffer', async () => {
    const t = setup({ limit: 5 });
    await goLive(t, [makeLog({ time: T3 }), makeLog({ time: T2 }), makeLog({ time: T1 })]);
    t.tail.pause('manual');
    t.socket().emit({
      type: 'logs',
      logs: ['2026-10-21T10:00:04.000Z', '2026-10-21T10:00:05.000Z', '2026-10-21T10:00:06.000Z'].map((time) =>
        makeLog({ time }),
      ),
    });
    t.tail.setLimit(2);
    expect(t.last().logs.map((l) => l.time)).toEqual([T3, T2]);
    expect(t.last().pendingCount).toBe(3);
    t.tail.resume();
    expect(t.last().logs.map((l) => l.time)).toEqual(['2026-10-21T10:00:06.000Z', '2026-10-21T10:00:05.000Z']);
  });

  it('every update is a fresh snapshot', async () => {
    const t = setup();
    await goLive(t);
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T1 })] });
    const a = t.last();
    t.socket().emit({ type: 'logs', logs: [makeLog({ time: T2 })] });
    const b = t.last();
    expect(a).not.toBe(b);
    expect(a.logs).toHaveLength(1);
    expect(b.logs).toHaveLength(2);
  });
});
