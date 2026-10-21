// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore plain ESM
import { hasNativeConfirm, RULES } from './detectors.mjs';
import { readAllowlist, assertRatchet } from './helpers';

describe('no-confirm detector', () => {
  it('flags the native confirm() call', () => {
    expect(hasNativeConfirm("if (confirm('x')) go();")).toBe(true);
    expect(hasNativeConfirm('if (!window.confirm("x")) return;')).toBe(true);
  });

  it('ignores declarations and look-alikes', () => {
    expect(hasNativeConfirm('async function confirm() {}')).toBe(false);
    expect(hasNativeConfirm('function confirm(a) {}')).toBe(false);
    expect(hasNativeConfirm('obj.confirm(x)')).toBe(false);
    expect(hasNativeConfirm('onConfirm(x)')).toBe(false);
  });
});

describe('no native confirm() in app code (use ConfirmDialog)', () => {
  it('has no offender outside the allowlist', () => {
    assertRatchet('no-confirm', RULES['no-confirm'](), readAllowlist('no-confirm'));
  });
});
