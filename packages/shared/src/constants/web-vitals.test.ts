import { describe, it, expect } from 'vitest';
import { rateWebVital, isWebVitalName, WEB_VITAL_NAMES, WEB_VITAL_THRESHOLDS } from './web-vitals.js';

const cases: Array<[Parameters<typeof rateWebVital>[0], number, number]> = [
  ['LCP', 2500, 4000],
  ['INP', 200, 500],
  ['CLS', 0.1, 0.25],
  ['FCP', 1800, 3000],
  ['TTFB', 800, 1800],
];

describe('rateWebVital', () => {
  for (const [name, good, poor] of cases) {
    it(`rates ${name} boundaries`, () => {
      expect(rateWebVital(name, good)).toBe('good');
      expect(rateWebVital(name, good + 0.01)).toBe('needs-improvement');
      expect(rateWebVital(name, poor)).toBe('needs-improvement');
      expect(rateWebVital(name, poor + 0.01)).toBe('poor');
      expect(rateWebVital(name, 0)).toBe('good');
    });
  }

  it('exposes thresholds for every name', () => {
    for (const name of WEB_VITAL_NAMES) {
      expect(WEB_VITAL_THRESHOLDS[name].good).toBeLessThan(WEB_VITAL_THRESHOLDS[name].poor);
    }
  });
});

describe('isWebVitalName', () => {
  it('accepts known names', () => {
    for (const name of WEB_VITAL_NAMES) expect(isWebVitalName(name)).toBe(true);
  });

  it('rejects lowercase and unknown', () => {
    expect(isWebVitalName('lcp')).toBe(false);
    expect(isWebVitalName('FID')).toBe(false);
    expect(isWebVitalName(undefined)).toBe(false);
    expect(isWebVitalName(5)).toBe(false);
  });
});
