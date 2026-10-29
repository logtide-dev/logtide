// Live tail controller: owns one WebSocket at a time, reconnects with
// exponential backoff, buffers while paused and filters every streamed row
// through the parsed query on the client too (B15: a server that ignored `q`
// must never show unfiltered rows). No Svelte here: the page renders the
// snapshots it receives through `onUpdate`.

import { matchesLogSearch, type LogSearchQuery } from '@logtide/shared';
import type { LogEntry } from '$lib/api/logs';
import { logHostname } from './log-fields';

export type LiveTailState = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

/** Row counts the live tail can keep (newest first). */
export const LIVE_TAIL_LIMITS = [50, 100, 200, 500, 1000] as const;

/** Close code the server uses for auth, access and query errors: never retried. */
const POLICY_VIOLATION = 1008;

export interface LiveTailSnapshot {
  state: LiveTailState;
  /** Rows shown, newest first, at most `limit`. */
  logs: LogEntry[];
  pausedBy: 'manual' | 'scroll' | null;
  /** Matching rows received while paused (counted even past the buffer cap). */
  pendingCount: number;
  /** Current reconnect attempt (1-based) while reconnecting, else 0. */
  attempt: number;
  /** Last server error (query error message or close reason), cleared by a new connection. */
  error: string | null;
}

export interface LiveTailOptions {
  connect: () => Promise<WebSocket>;
  query: LogSearchQuery | null;
  limit: number;
  onUpdate(s: LiveTailSnapshot): void;
  /** Reconnect attempts before giving up (default 5). */
  maxAttempts?: number;
  /** First backoff wait (default 1000 ms), doubled per attempt. */
  baseDelayMs?: number;
  /** Longest backoff wait (default 16000 ms). */
  maxDelayMs?: number;
}

export interface LiveTail {
  /** (Re)start with the rows already on screen; any previous socket is dropped. */
  start(initial: LogEntry[]): void;
  /** Close the socket, cancel timers; a stopped tail never notifies again. */
  stop(): void;
  /** Buffer new rows instead of showing them; a scroll pause never replaces a manual one. */
  pause(reason: 'manual' | 'scroll'): void;
  /** Show the buffered rows on top and keep streaming. */
  resume(): void;
  /** Reconnect now from attempt 0 (the Reconnect button). */
  retry(): void;
  setLimit(limit: number): void;
}

function timeOf(log: LogEntry): number {
  const ms = Date.parse(log.time);
  return Number.isNaN(ms) ? 0 : ms;
}

function isLogLike(value: unknown): value is LogEntry {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.time === 'string';
}

export function createLiveTail(opts: LiveTailOptions): LiveTail {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 16000;

  let limit = Math.max(1, opts.limit);
  let running = false;
  let state: LiveTailState = 'disconnected';
  let logs: LogEntry[] = [];
  let pending: LogEntry[] = [];
  let pendingCount = 0;
  let pausedBy: 'manual' | 'scroll' | null = null;
  let attempt = 0;
  let error: string | null = null;

  // Bumped by every connect, stop and restart: callbacks of an older socket
  // or connect promise compare their captured value and bail out.
  let seq = 0;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function notify() {
    if (!running) return;
    opts.onUpdate({ state, logs, pausedBy, pendingCount, attempt, error });
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function release(ws: WebSocket | null) {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  function dropSocket() {
    const ws = socket;
    socket = null;
    release(ws);
  }

  function matches(log: LogEntry): boolean {
    if (!opts.query) return true;
    try {
      return matchesLogSearch(
        {
          ...log,
          message: typeof log.message === 'string' ? log.message : String(log.message ?? ''),
          level: typeof log.level === 'string' ? log.level : '',
          service: typeof log.service === 'string' ? log.service : '',
          hostname: logHostname(log),
        },
        opts.query,
      );
    } catch {
      // fail closed: a row the matcher cannot evaluate is not shown
      return false;
    }
  }

  function ingest(batch: unknown[]) {
    const rows = batch.filter(isLogLike).filter(matches);
    if (rows.length === 0) return;
    // newest first; Array.prototype.sort is stable, so equal times keep server order
    rows.sort((a, b) => timeOf(b) - timeOf(a));
    if (pausedBy) {
      pending = [...rows, ...pending].slice(0, limit);
      pendingCount += rows.length;
    } else {
      logs = [...rows, ...logs].slice(0, limit);
    }
    notify();
  }

  function handleMessage(data: unknown) {
    let msg: unknown;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return;
    }
    if (msg === null || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    if (m.type === 'connected') {
      attempt = 0;
      error = null;
      state = 'live';
      notify();
    } else if (m.type === 'logs') {
      if (Array.isArray(m.logs)) ingest(m.logs);
    } else if (m.type === 'error') {
      // the server closes with 1008 right after; keep the message for that state
      error = typeof m.error === 'string' && m.error ? m.error : 'Live tail error';
    }
  }

  function fail(code: number | null, reason: string) {
    socket = null;
    if (code === POLICY_VIOLATION) {
      if (!error) error = reason || 'Live tail was closed by the server';
      state = 'disconnected';
      attempt = 0;
      notify();
      return;
    }
    if (attempt >= maxAttempts) {
      state = 'disconnected';
      notify();
      return;
    }
    attempt += 1;
    state = 'reconnecting';
    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
    notify();
  }

  function open() {
    clearTimer();
    dropSocket();
    const mine = ++seq;
    state = attempt === 0 ? 'connecting' : 'reconnecting';
    notify();

    let promise: Promise<WebSocket>;
    try {
      promise = opts.connect();
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then(
      (ws) => {
        if (mine !== seq || !running) {
          release(ws);
          return;
        }
        socket = ws;
        ws.onmessage = (ev: MessageEvent) => {
          if (mine === seq && running) handleMessage(ev.data);
        };
        ws.onclose = (ev: CloseEvent) => {
          if (mine !== seq || !running) return;
          fail(ev.code, ev.reason ?? '');
        };
        // a close event always follows an error event
        ws.onerror = () => {};
      },
      () => {
        if (mine !== seq || !running) return;
        fail(null, '');
      },
    );
  }

  return {
    start(initial) {
      seq++;
      clearTimer();
      dropSocket();
      running = true;
      logs = initial.slice(0, limit);
      pending = [];
      pendingCount = 0;
      pausedBy = null;
      attempt = 0;
      error = null;
      open();
    },
    stop() {
      running = false;
      seq++;
      clearTimer();
      dropSocket();
      state = 'disconnected';
    },
    pause(reason) {
      if (!running) return;
      if (pausedBy === 'manual' || pausedBy === reason) return;
      pausedBy = reason;
      notify();
    },
    resume() {
      if (!running || !pausedBy) return;
      logs = [...pending, ...logs].slice(0, limit);
      pending = [];
      pendingCount = 0;
      pausedBy = null;
      notify();
    },
    retry() {
      if (!running) return;
      attempt = 0;
      error = null;
      open();
    },
    setLimit(next) {
      limit = Math.max(1, Math.floor(next));
      logs = logs.slice(0, limit);
      pending = pending.slice(0, limit);
      notify();
    },
  };
}
