import { describe, it, expect } from 'vitest';
import { SigmaFieldMatcher } from '../../../modules/sigma/field-matcher.js';

describe('Sigma |re safety', () => {
  it('does not run a catastrophic backtracking pattern', () => {
    const value = 'a'.repeat(40) + '!';
    const start = Date.now();
    const matched = SigmaFieldMatcher.match(value, '^(a+)+$', { modifier: 're' });
    expect(Date.now() - start).toBeLessThan(500);
    expect(matched).toBe(false);
  });

  it('rejects patterns longer than the cap', () => {
    expect(SigmaFieldMatcher.match('a', 'a'.repeat(2000), { modifier: 're' })).toBe(false);
  });

  it('still matches ordinary patterns', () => {
    expect(SigmaFieldMatcher.match('error 42', 'error [0-9]+', { modifier: 're' })).toBe(true);
  });
});
