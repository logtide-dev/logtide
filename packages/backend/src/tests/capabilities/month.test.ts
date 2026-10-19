import { describe, it, expect } from 'vitest';
import { startOfUtcMonth } from '../../capabilities/month.js';

describe('startOfUtcMonth', () => {
  it('returns midnight UTC on the first of the month', () => {
    expect(startOfUtcMonth(new Date('2026-10-19T23:59:59.999Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(startOfUtcMonth(new Date('2026-01-01T00:00:00.000Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // 2026-03-01T00:30 in UTC+1 is still February in UTC
    expect(startOfUtcMonth(new Date('2026-02-28T23:30:00.000Z')).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});
