import { describe, it, expect } from 'vitest';
import { createRequestGuard } from './request-guard';

describe('request guard', () => {
  it('only the latest token is accepted', () => {
    const guard = createRequestGuard();
    const first = guard.next();
    expect(guard.isLatest(first)).toBe(true);
    const second = guard.next();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });
});
