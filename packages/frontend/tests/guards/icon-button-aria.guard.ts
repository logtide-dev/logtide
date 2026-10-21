// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore plain ESM
import { countUnlabelledIconButtons, RULES } from './detectors.mjs';
import { readAllowlist, assertRatchet } from './helpers';

describe('icon-button-aria detector', () => {
  it('flags an icon button without a label', () => {
    expect(countUnlabelledIconButtons('<Button size="icon"><X /></Button>')).toBe(1);
  });

  it('accepts aria-label, aria-labelledby and spread attributes', () => {
    expect(countUnlabelledIconButtons('<Button size="icon" aria-label="Close"><X /></Button>')).toBe(0);
    expect(countUnlabelledIconButtons('<Button size="icon" aria-labelledby="t"><X /></Button>')).toBe(0);
    expect(countUnlabelledIconButtons('<Button size="icon" {...rest}><X /></Button>')).toBe(0);
  });

  it('ignores other sizes and lowercase buttons', () => {
    expect(countUnlabelledIconButtons('<Button size="sm">Save</Button>')).toBe(0);
    expect(countUnlabelledIconButtons('<button size="icon"><X /></button>')).toBe(0);
  });

  it('finds nested icon buttons', () => {
    const src = '{#if open}<div><Button variant="ghost" size="icon"><X /></Button></div>{/if}';
    expect(countUnlabelledIconButtons(src)).toBe(1);
  });
});

describe('every icon-only Button has an accessible name', () => {
  it('has no offender outside the allowlist', () => {
    assertRatchet('icon-button-aria', RULES['icon-button-aria'](), readAllowlist('icon-button-aria'));
  });
});
