import { describe, it, expect } from 'vitest';
import { contrastRatio, readableForeground } from './contrast';

describe('readableForeground', () => {
  it('gives dark text on white and white text on #0f172a, null on bad hex', () => {
    expect(readableForeground('#ffffff')).toBe('#111827');
    expect(readableForeground('#0f172a')).toBe('#ffffff');
    expect(readableForeground('#fff')).toBeNull();
    expect(readableForeground('not-a-colour')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and null for invalid input', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#fffffe', '#ffffff')).toBeLessThan(1.1);
    expect(contrastRatio('#12', '#ffffff')).toBeNull();
  });
});
