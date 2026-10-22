import {
  WEB_VITAL_NAMES,
  isWebVitalName,
  metadataFilterSchema,
  rateWebVital,
  resolveMetadataPath,
  type WebVitalName,
  type WebVitalRating,
} from '@logtide/shared';
import { reservoir } from '../../database/reservoir.js';
import { percentile } from './percentile.js';

export const MAX_VITAL_SAMPLES = 10000;
const MAX_ROUTES = 20;
const MAX_ROUTE_LENGTH = 200;
const UNKNOWN_ROUTE = '(unknown)';
const ROUTE_KEYS = ['page.pathname', 'page.url', 'url.path', 'http.route', 'route'];

export interface WebVitalSummary {
  name: WebVitalName;
  p75: number | null;
  rating: WebVitalRating | null;
  samples: number;
  /** Sample counts per rating bucket (computed from the shared thresholds). */
  distribution: { good: number; needsImprovement: number; poor: number };
}

export interface WebVitalRouteRow {
  route: string;
  samples: number;
  metrics: Partial<Record<WebVitalName, { p75: number; rating: WebVitalRating; samples: number }>>;
}

export interface WebVitalsSummary {
  projectId: string;
  from: string;
  to: string;
  sampleCount: number;
  skipped: number;
  truncated: boolean;
  metrics: WebVitalSummary[];
  routes: WebVitalRouteRow[];
}

export interface WebVitalsSummaryInput {
  projectId: string;
  from: Date;
  to: Date;
}

/** Strip origin, query and hash; collapse a trailing slash; cap the length. */
export function normalizeRoute(raw: unknown): string {
  if (typeof raw !== 'string') return UNKNOWN_ROUTE;
  let value = raw.trim();
  if (value === '') return UNKNOWN_ROUTE;
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, '');
  value = value.replace(/^\/\/[^/?#]*/, '');
  const cut = value.search(/[?#]/);
  if (cut >= 0) value = value.slice(0, cut);
  if (value === '') value = '/';
  if (value.length > 1) value = value.replace(/\/+$/, '');
  if (value === '') value = '/';
  return value.slice(0, MAX_ROUTE_LENGTH);
}

function routeOf(metadata: Record<string, unknown> | undefined): string {
  for (const key of ROUTE_KEYS) {
    const value = resolveMetadataPath(metadata, key);
    if (typeof value === 'string' && value.trim() !== '') return normalizeRoute(value);
  }
  return UNKNOWN_ROUTE;
}

class WebVitalsService {
  async getSummary(input: WebVitalsSummaryInput): Promise<WebVitalsSummary> {
    const { projectId, from, to } = input;

    const result = await reservoir.query({
      projectId,
      from,
      to,
      metadataFilters: [metadataFilterSchema.parse({ key: 'performance.metric', op: 'exists' })],
      sortBy: 'time',
      sortOrder: 'desc',
      limit: MAX_VITAL_SAMPLES,
      offset: 0,
    });

    const logs = result.logs ?? [];
    // hasMore is true only when a row exists past the limit, so exactly 10,000 samples is not truncated.
    const truncated = result.hasMore === true;

    const perMetric = new Map<WebVitalName, number[]>(WEB_VITAL_NAMES.map((n) => [n, []]));
    const perRoute = new Map<string, { samples: number; values: Map<WebVitalName, number[]> }>();
    let skipped = 0;
    let sampleCount = 0;

    for (const log of logs) {
      const metadata = log.metadata as Record<string, unknown> | undefined;
      const name = resolveMetadataPath(metadata, 'performance.metric');
      const value = resolveMetadataPath(metadata, 'performance.value');
      if (!isWebVitalName(name) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        skipped++;
        continue;
      }
      sampleCount++;
      perMetric.get(name)!.push(value);

      const route = routeOf(metadata);
      let entry = perRoute.get(route);
      if (!entry) {
        entry = { samples: 0, values: new Map() };
        perRoute.set(route, entry);
      }
      entry.samples++;
      const list = entry.values.get(name);
      if (list) list.push(value);
      else entry.values.set(name, [value]);
    }

    const metrics: WebVitalSummary[] = WEB_VITAL_NAMES.map((name) => {
      const values = perMetric.get(name)!;
      const distribution = { good: 0, needsImprovement: 0, poor: 0 };
      for (const v of values) {
        const rating = rateWebVital(name, v);
        if (rating === 'good') distribution.good++;
        else if (rating === 'poor') distribution.poor++;
        else distribution.needsImprovement++;
      }
      const p75 = percentile([...values].sort((a, b) => a - b), 0.75);
      return {
        name,
        p75,
        rating: p75 === null ? null : rateWebVital(name, p75),
        samples: values.length,
        distribution,
      };
    });

    const routes: WebVitalRouteRow[] = [...perRoute.entries()]
      .sort((a, b) => b[1].samples - a[1].samples || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, MAX_ROUTES)
      .map(([route, entry]) => {
        const row: WebVitalRouteRow = { route, samples: entry.samples, metrics: {} };
        for (const name of WEB_VITAL_NAMES) {
          const values = entry.values.get(name);
          if (!values || values.length === 0) continue;
          const p75 = percentile([...values].sort((a, b) => a - b), 0.75) as number;
          row.metrics[name] = { p75, rating: rateWebVital(name, p75), samples: values.length };
        }
        return row;
      });

    return {
      projectId,
      from: from.toISOString(),
      to: to.toISOString(),
      sampleCount,
      skipped,
      truncated,
      metrics,
      routes,
    };
  }
}

export const webVitalsService = new WebVitalsService();
