import { WEB_VITAL_THRESHOLDS, type WebVitalName, type WebVitalRating } from '@logtide/shared';
import { severityTone, stateTone, type Tone } from '$lib/utils/severity';

export const VITAL_LABELS: Record<WebVitalName, string> = {
  LCP: 'Largest Contentful Paint',
  INP: 'Interaction to Next Paint',
  CLS: 'Cumulative Layout Shift',
  FCP: 'First Contentful Paint',
  TTFB: 'Time to First Byte',
};

export const RATING_LABELS: Record<WebVitalRating, string> = {
  good: 'Good',
  'needs-improvement': 'Needs improvement',
  poor: 'Poor',
};

/** good => green, needs improvement => amber, poor => red (all through the shared tone tables). */
export function ratingTone(rating: WebVitalRating): Tone {
  if (rating === 'good') return stateTone('resolved');
  if (rating === 'needs-improvement') return severityTone('medium');
  return severityTone('high');
}

/** CLS has no unit and three decimals; time metrics are rounded ms, shown in seconds above 1000 ms. */
export function formatVitalValue(name: WebVitalName, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  if (value > 1000) return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} s`;
  return `${Math.round(value).toLocaleString('en-US')} ms`;
}

/** Threshold figure without rounding the small CLS bounds away. */
function formatThreshold(name: WebVitalName, value: number): string {
  if (name === 'CLS') return String(value);
  return `${value.toLocaleString('en-US')} ms`;
}

export function thresholdsLine(name: WebVitalName): string {
  const t = WEB_VITAL_THRESHOLDS[name];
  return `Good up to ${formatThreshold(name, t.good)}, poor above ${formatThreshold(name, t.poor)}`;
}

/** Integer percentages that always add up to 100 (largest remainder), or zeros without samples. */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

/** Mirrors the backend sample cap for the "most recent" note. */
export const MAX_VITAL_SAMPLES = 10000;
