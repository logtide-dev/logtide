/**
 * Core Web Vitals names and rating thresholds (single source of truth).
 * `good` is the inclusive upper bound of "good", `poor` the exclusive lower
 * bound of "poor" (values above it are poor).
 */
export const WEB_VITAL_NAMES = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;

export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export const WEB_VITAL_THRESHOLDS: Record<WebVitalName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export function rateWebVital(name: WebVitalName, value: number): WebVitalRating {
  const t = WEB_VITAL_THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value > t.poor) return 'poor';
  return 'needs-improvement';
}

export function isWebVitalName(x: unknown): x is WebVitalName {
  return typeof x === 'string' && (WEB_VITAL_NAMES as readonly string[]).includes(x);
}
