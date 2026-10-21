import type { LogEntry } from '$lib/api/logs';

let nextLogId = 1;

/** Restart the `log-1`, `log-2`, ... id sequence (call from `beforeEach` when ids matter). */
export function resetLogIds(): void {
  nextLogId = 1;
}

/** A plain log row for tests; every call gets the next `log-<n>` id. */
export function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  const id = `log-${nextLogId++}`;
  return {
    id,
    time: '2026-10-21T10:42:13.123Z',
    projectId: 'p1',
    service: 'api',
    level: 'info',
    message: 'GET /health',
    metadata: { hostname: 'web-1' },
    ...overrides,
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A promise whose settlement the test controls, for in-flight request scenarios. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
