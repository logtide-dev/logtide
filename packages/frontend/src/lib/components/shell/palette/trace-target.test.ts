import { describe, it, expect } from 'vitest';
import { resolveTraceTarget } from './trace-target';

const ctx = (scope: string[], traces: string[], all: string[]) => ({
  scopeProjectIds: scope,
  tracesProjectIds: traces,
  allProjectIds: all,
});

describe('resolveTraceTarget', () => {
  it('prefers the single scoped project', () => {
    expect(resolveTraceTarget('t', ctx(['a'], ['b'], ['a', 'b'])).projectId).toBe('a');
  });

  it('uses the only project with traces when the scope is not a single project', () => {
    expect(resolveTraceTarget('t', ctx([], ['b'], ['a', 'b'])).projectId).toBe('b');
    expect(resolveTraceTarget('t', ctx(['a', 'b'], ['b'], ['a', 'b'])).projectId).toBe('b');
  });

  it('uses the only project overall', () => {
    expect(resolveTraceTarget('t', ctx([], [], ['a'])).projectId).toBe('a');
  });

  it('returns null instead of guessing between several', () => {
    expect(resolveTraceTarget('t', ctx([], ['a', 'b'], ['a', 'b'])).projectId).toBeNull();
    expect(resolveTraceTarget('t', ctx([], [], [])).projectId).toBeNull();
  });
});
