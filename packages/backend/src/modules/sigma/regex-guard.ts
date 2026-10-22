/**
 * Time-boxed regex execution for user-supplied Sigma `|re` patterns.
 *
 * A static check (safe-regex2) cannot prove a pattern safe: overlapping
 * alternations such as `(a|aa)+$` pass it and still backtrack exponentially.
 * Instead every test runs in a dedicated worker thread and the calling thread
 * waits on a SharedArrayBuffer with a hard deadline (Atomics.wait). When the
 * deadline passes the worker is terminated and the pattern is blacklisted, so
 * a hostile pattern costs the main thread at most REGEX_TIME_BUDGET_MS once
 * and never blocks the event loop again. A timed out pattern never matches.
 *
 * The same code path serves the preview endpoint (API process) and ingest-time
 * matching (worker process).
 */

import { Worker } from 'node:worker_threads';

export const REGEX_TIME_BUDGET_MS = 100;
const WORKER_START_BUDGET_MS = 5_000;
const MAX_POISONED = 1_000;

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const ctl = new Int32Array(workerData.sab);
const cache = new Map();
parentPort.on('message', (m) => {
  let result = 0;
  try {
    const key = m.flags + '/' + m.pattern;
    let re = cache.get(key);
    if (re === undefined) {
      re = new RegExp(m.pattern, m.flags);
      if (cache.size >= 1000) cache.clear();
      cache.set(key, re);
    }
    result = re.test(m.value) ? 1 : 0;
  } catch (e) {
    result = 2;
  }
  Atomics.store(ctl, 1, result);
  Atomics.store(ctl, 0, 1);
  Atomics.notify(ctl, 0);
});
Atomics.store(ctl, 0, 1);
Atomics.notify(ctl, 0);
`;

let worker: Worker | null = null;
let ctl: Int32Array | null = null;
const poisoned = new Set<string>();

function startWorker(): boolean {
  try {
    const sab = new SharedArrayBuffer(8);
    const view = new Int32Array(sab);
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { sab } });
    w.unref();
    w.on('error', () => {
      if (worker === w) {
        worker = null;
        ctl = null;
      }
    });
    w.on('exit', () => {
      if (worker === w) {
        worker = null;
        ctl = null;
      }
    });
    // Ready handshake: the worker flips ctl[0] once its message handler is set.
    if (Atomics.wait(view, 0, 0, WORKER_START_BUDGET_MS) === 'timed-out') {
      void w.terminate();
      return false;
    }
    Atomics.store(view, 0, 0);
    worker = w;
    ctl = view;
    return true;
  } catch {
    return false;
  }
}

function killWorker(): void {
  const w = worker;
  worker = null;
  ctl = null;
  if (w) void w.terminate();
}

/**
 * Test `value` against `/pattern/flags` within the time budget.
 * Returns false when the pattern is invalid, previously timed out, or times
 * out now (in which case it is blacklisted).
 */
export function boundedRegexTest(
  pattern: string,
  flags: string,
  value: string,
  budgetMs: number = REGEX_TIME_BUDGET_MS
): boolean {
  const key = `${flags}/${pattern}`;
  if (poisoned.has(key)) return false;
  if (!worker || !ctl) {
    if (!startWorker() || !worker || !ctl) return false;
  }
  const w = worker;
  const view = ctl;
  Atomics.store(view, 0, 0);
  w.postMessage({ pattern, flags, value });
  if (Atomics.wait(view, 0, 0, budgetMs) === 'timed-out') {
    if (poisoned.size >= MAX_POISONED) poisoned.clear();
    poisoned.add(key);
    killWorker();
    return false;
  }
  return Atomics.load(view, 1) === 1;
}

/** Test hook: drop the worker and the blacklist. */
export function resetRegexGuard(): void {
  killWorker();
  poisoned.clear();
}
