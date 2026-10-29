import { describe, it, expect } from 'vitest';
import { createLatest } from './latest';

describe('createLatest', () => {
  it('an older request is not current after a newer begin', () => {
    const latest = createLatest();
    const first = latest.begin();
    const second = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('the newest request stays current', () => {
    const latest = createLatest();
    const only = latest.begin();
    expect(only()).toBe(true);
    expect(only()).toBe(true);
  });
});
