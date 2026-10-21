// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore plain ESM
import { hasLongDash, RULES } from './detectors.mjs';
import { readAllowlist, assertRatchet } from './helpers';

describe('no-dash detector', () => {
  it('flags an em dash and an en dash', () => {
    expect(hasLongDash(JSON.parse('"a \\u2014 b"'))).toBe(true);
    expect(hasLongDash(JSON.parse('"1\\u20132"'))).toBe(true);
  });

  it('accepts hyphens and minus signs', () => {
    expect(hasLongDash('a - b -- c')).toBe(false);
    expect(hasLongDash('1-2')).toBe(false);
  });
});

describe('no em or en dash in app source', () => {
  it('has no offender outside the allowlist', () => {
    assertRatchet('no-dash', RULES['no-dash'](), readAllowlist('no-dash'));
  });
});
