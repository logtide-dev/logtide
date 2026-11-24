import { describe, it, expect } from 'vitest';
import { limitFieldFromOverride, limitFieldToOverride, limitText } from './user-limits-form';

describe('user limits form', () => {
  it('maps stored overrides to form fields and back', () => {
    for (const override of ['default', 'unlimited', 0, 12] as const) {
      expect(limitFieldToOverride(limitFieldFromOverride(override))).toBe(override);
    }
  });

  it('accepts whole numbers from 0 to 100000 as custom limits', () => {
    expect(limitFieldToOverride({ mode: 'custom', text: '5' })).toBe(5);
    expect(limitFieldToOverride({ mode: 'custom', text: 5 })).toBe(5);
    expect(limitFieldToOverride({ mode: 'custom', text: ' 0 ' })).toBe(0);
    expect(limitFieldToOverride({ mode: 'custom', text: '100000' })).toBe(100000);
  });

  it('rejects anything else', () => {
    for (const text of ['', '-1', '1.5', 'abc', '100001', '1e3']) {
      expect(limitFieldToOverride({ mode: 'custom', text }), text).toBeNull();
    }
  });

  it('ignores the typed number unless the mode is custom', () => {
    expect(limitFieldToOverride({ mode: 'default', text: '9' })).toBe('default');
    expect(limitFieldToOverride({ mode: 'unlimited', text: 'x' })).toBe('unlimited');
  });

  it('limitText', () => {
    expect(limitText(null)).toBe('no limit');
    expect(limitText(3)).toBe('3');
    expect(limitText(12000)).toBe('12,000');
  });
});
