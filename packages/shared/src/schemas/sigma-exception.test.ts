import { describe, it, expect } from 'vitest';
import { createExceptionSchema } from './sigma-exception.js';

const eq = (value = 'api') => ({ field: 'service', operator: 'equals' as const, values: [value] });

describe('createExceptionSchema', () => {
  it('accepts a single equals condition', () => {
    expect(createExceptionSchema.safeParse({ conditions: [eq()] }).success).toBe(true);
  });

  it('rejects empty conditions', () => {
    expect(createExceptionSchema.safeParse({ conditions: [] }).success).toBe(false);
  });

  it('rejects more than 5 conditions', () => {
    const conditions = Array.from({ length: 6 }, () => eq());
    expect(createExceptionSchema.safeParse({ conditions }).success).toBe(false);
    expect(createExceptionSchema.safeParse({ conditions: conditions.slice(0, 5) }).success).toBe(true);
  });

  it('rejects equals with two values', () => {
    const r = createExceptionSchema.safeParse({
      conditions: [{ field: 'service', operator: 'equals', values: ['a', 'b'] }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts in with 50 values and rejects 51', () => {
    const mk = (n: number) => ({
      conditions: [
        { field: 'service', operator: 'in', values: Array.from({ length: n }, (_, i) => `v${i}`) },
      ],
    });
    expect(createExceptionSchema.safeParse(mk(50)).success).toBe(true);
    expect(createExceptionSchema.safeParse(mk(51)).success).toBe(false);
  });

  it('rejects field with spaces', () => {
    const r = createExceptionSchema.safeParse({
      conditions: [{ field: 'bad field', operator: 'equals', values: ['x'] }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects expiresAt in the past', () => {
    const r = createExceptionSchema.safeParse({
      conditions: [eq()],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(r.success).toBe(false);
    const ok = createExceptionSchema.safeParse({
      conditions: [eq()],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(ok.success).toBe(true);
  });

  it('accepts missing reason and expiresAt', () => {
    const r = createExceptionSchema.safeParse({ conditions: [eq()] });
    expect(r.success).toBe(true);
  });
});
