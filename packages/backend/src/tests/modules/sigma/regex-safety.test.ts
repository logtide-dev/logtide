import { describe, it, expect, afterAll } from 'vitest';
import { SigmaFieldMatcher } from '../../../modules/sigma/field-matcher.js';
import { resetRegexGuard } from '../../../modules/sigma/regex-guard.js';

describe('Sigma |re safety', () => {
  afterAll(() => resetRegexGuard());

  it('does not run a catastrophic backtracking pattern', () => {
    const value = 'a'.repeat(40) + '!';
    const start = Date.now();
    const matched = SigmaFieldMatcher.match(value, '^(a+)+$', { modifier: 're' });
    expect(Date.now() - start).toBeLessThan(500);
    expect(matched).toBe(false);
  });

  // safe-regex2 reports these as safe (no star height, overlapping alternation).
  it.each(['(a|aa)+$', '(a|a)+$'])('time-boxes overlapping alternation %s', (pattern) => {
    const value = 'a'.repeat(40) + '!';
    const start = Date.now();
    expect(SigmaFieldMatcher.match(value, pattern, { modifier: 're' })).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
    // blacklisted now: a repeat costs nothing
    const again = Date.now();
    expect(SigmaFieldMatcher.match(value, pattern, { modifier: 're' })).toBe(false);
    expect(Date.now() - again).toBeLessThan(50);
  });

  it('keeps working after a pattern timed out (worker restarted)', () => {
    SigmaFieldMatcher.match('a'.repeat(40) + '!', '(a|aa)+$', { modifier: 're' });
    expect(SigmaFieldMatcher.match('error 42', 'error [0-9]+', { modifier: 're' })).toBe(true);
    expect(SigmaFieldMatcher.match('ERROR 42', 'error [0-9]+', { modifier: 're', caseSensitive: false })).toBe(true);
  });

  it('rejects patterns longer than the cap', () => {
    expect(SigmaFieldMatcher.match('a', 'a'.repeat(2000), { modifier: 're' })).toBe(false);
  });

  it('invalid syntax does not match', () => {
    expect(SigmaFieldMatcher.match('a', '(unclosed', { modifier: 're' })).toBe(false);
  });

  it('still matches ordinary patterns', () => {
    expect(SigmaFieldMatcher.match('error 42', 'error [0-9]+', { modifier: 're' })).toBe(true);
  });
});
