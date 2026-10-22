import { describe, it, expect } from 'vitest';
import { createRequestGuard } from './request-guard';

describe('createRequestGuard', () => {
  it('begin invalidates earlier tokens', () => {
    const guard = createRequestGuard();
    const a = guard.begin();
    const b = guard.begin();
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(b)).toBe(true);
    expect(guard.current()).toBe(b);
  });

  it('invalidate makes the latest token stale', () => {
    const guard = createRequestGuard();
    const a = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(a)).toBe(false);
    const b = guard.begin();
    expect(guard.isCurrent(b)).toBe(true);
    expect(b).not.toBe(a);
  });

  it('keeps separate guards independent', () => {
    const rows = createRequestGuard();
    const histogram = createRequestGuard();
    const r = rows.begin();
    histogram.begin();
    histogram.invalidate();
    expect(rows.isCurrent(r)).toBe(true);
  });
});
