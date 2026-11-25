/**
 * Metric catalog registry: every (project, metric name, metric type) a project
 * sends is recorded in metric_catalog with its unit, description and first and
 * last seen time.
 *
 * Called from the metrics ingest path after the batch is stored. It never
 * throws and never blocks ingestion: the caller does not await it, every
 * error is logged and swallowed. Upserts are throttled in process to one per
 * (project, name, type) every CATALOG_THROTTLE_MS, except that a change of
 * unit or description against the cached value is written immediately.
 */
import { sql } from 'kysely';
import { hub } from '@logtide/core';
import { db } from '../../../database/index.js';
import { isInternalLoggingEnabled } from '../../../utils/internal-logger.js';

export const CATALOG_THROTTLE_MS = 10 * 60_000;
/**
 * A batch whose data is this much newer than the last written last_seen is
 * written even inside the throttle window, so a backfill (old data first)
 * does not leave last_seen hours behind live data.
 */
export const CATALOG_LAST_SEEN_STEP_MS = 5 * 60_000;
/** Upper bound of the throttle map; the oldest entries are dropped first. */
export const CATALOG_THROTTLE_MAX_ENTRIES = 50_000;
const UPSERT_CHUNK = 500;
const MAX_NAME_LENGTH = 512;
const MAX_UNIT_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

interface MetricLike {
  time: Date;
  metricName: string;
  metricType: string;
  unit?: string;
  description?: string;
  isMonotonic?: boolean;
  temporality?: 'cumulative' | 'delta';
}

interface CatalogRow {
  name: string;
  type: string;
  unit: string | null;
  description: string | null;
  isMonotonic: boolean | null;
  temporality: 'cumulative' | 'delta' | null;
  firstSeen: Date;
  lastSeen: Date;
}

interface Remembered {
  at: number;
  unit: string | null;
  description: string | null;
  /** last_seen written by the last upsert (data time, ms). */
  lastSeen: number;
}

const remembered = new Map<string, Remembered>();

const keyOf = (projectId: string, name: string, type: string) => `${projectId}\u0000${name}\u0000${type}`;

function remember(key: string, value: Remembered): void {
  remembered.delete(key);
  remembered.set(key, value);
  while (remembered.size > CATALOG_THROTTLE_MAX_ENTRIES) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** Test hook: forget every throttle entry. */
export function resetMetricCatalogThrottle(): void {
  remembered.clear();
}

export function metricCatalogThrottleSize(): number {
  return remembered.size;
}

function clip(value: string | undefined, max: number): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value.length > max ? value.slice(0, max) : value;
}

function validTemporality(t: unknown): 'cumulative' | 'delta' | null {
  return t === 'cumulative' || t === 'delta' ? t : null;
}

function validTime(t: Date): number | null {
  const ms = t instanceof Date ? t.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Distinct (name, type) of a batch with the first non-empty unit/description and the time span. */
export function distinctCatalogRows(records: readonly MetricLike[], clampMs: number = Date.now()): CatalogRow[] {
  const rows = new Map<string, CatalogRow>();
  for (const r of records) {
    if (typeof r.metricName !== 'string' || r.metricName === '' || r.metricName.length > MAX_NAME_LENGTH) continue;
    const rawMs = validTime(r.time);
    if (rawMs === null) continue;
    // A sender with a skewed clock must not push first/last seen into the future.
    const ms = Math.min(rawMs, clampMs);
    const key = `${r.metricName}\u0000${r.metricType}`;
    const unit = clip(r.unit, MAX_UNIT_LENGTH);
    const description = clip(r.description, MAX_DESCRIPTION_LENGTH);
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, {
        name: r.metricName,
        type: r.metricType,
        unit,
        description,
        isMonotonic: typeof r.isMonotonic === 'boolean' ? r.isMonotonic : null,
        temporality: validTemporality(r.temporality),
        firstSeen: new Date(ms),
        lastSeen: new Date(ms),
      });
      continue;
    }
    if (existing.unit === null) existing.unit = unit;
    if (existing.description === null) existing.description = description;
    if (existing.isMonotonic === null && typeof r.isMonotonic === 'boolean') existing.isMonotonic = r.isMonotonic;
    if (existing.temporality === null) existing.temporality = validTemporality(r.temporality);
    if (ms < existing.firstSeen.getTime()) existing.firstSeen = new Date(ms);
    if (ms > existing.lastSeen.getTime()) existing.lastSeen = new Date(ms);
  }
  return [...rows.values()];
}

/** Stable (name, type) order so concurrent batches lock rows in the same order (no deadlocks). */
function byNameType(a: CatalogRow, b: CatalogRow): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

async function upsertRows(unsorted: CatalogRow[], projectId: string): Promise<void> {
  const rows = [...unsorted].sort(byNameType);
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await db
      .insertInto('metric_catalog')
      .values(
        rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
          project_id: projectId,
          metric_name: r.name,
          metric_type: r.type,
          unit: r.unit,
          description: r.description,
          is_monotonic: r.isMonotonic,
          temporality: r.temporality,
          first_seen_at: r.firstSeen,
          last_seen_at: r.lastSeen,
        }))
      )
      .onConflict((oc) =>
        oc.columns(['project_id', 'metric_name', 'metric_type']).doUpdateSet({
          unit: sql`coalesce(excluded.unit, metric_catalog.unit)`,
          description: sql`coalesce(excluded.description, metric_catalog.description)`,
          is_monotonic: sql`coalesce(excluded.is_monotonic, metric_catalog.is_monotonic)`,
          temporality: sql`coalesce(excluded.temporality, metric_catalog.temporality)`,
          first_seen_at: sql`least(metric_catalog.first_seen_at, excluded.first_seen_at)`,
          last_seen_at: sql`greatest(metric_catalog.last_seen_at, excluded.last_seen_at)`,
        })
      )
      .execute();
  }
}

/**
 * Upsert the distinct (name, type) of a batch into metric_catalog. Resolves
 * once done; never rejects. Returns the number of catalog rows written
 * (throttled ones skipped).
 */
export async function registerMetricCatalog(
  records: readonly MetricLike[],
  projectId: string,
  now: number = Date.now()
): Promise<number> {
  let due: CatalogRow[] = [];
  const previous = new Map<string, Remembered | undefined>();
  try {
    if (!projectId || records.length === 0) return 0;
    const rows = distinctCatalogRows(records, Date.now());
    due = rows.filter((r) => {
      const last = remembered.get(keyOf(projectId, r.name, r.type));
      if (last === undefined || now - last.at >= CATALOG_THROTTLE_MS) return true;
      if (r.lastSeen.getTime() - last.lastSeen >= CATALOG_LAST_SEEN_STEP_MS) return true;
      return (r.unit !== null && r.unit !== last.unit) || (r.description !== null && r.description !== last.description);
    });
    if (due.length === 0) return 0;
    // Optimistic: concurrent batches of the same metric do not pile up.
    for (const r of due) {
      const key = keyOf(projectId, r.name, r.type);
      const last = remembered.get(key);
      previous.set(key, last);
      remember(key, {
        at: now,
        unit: r.unit ?? last?.unit ?? null,
        description: r.description ?? last?.description ?? null,
        lastSeen: Math.max(r.lastSeen.getTime(), last?.lastSeen ?? 0),
      });
    }
    await upsertRows(due, projectId);
    return due.length;
  } catch (error) {
    // Let the next batch retry.
    for (const r of due) {
      const key = keyOf(projectId, r.name, r.type);
      const last = previous.get(key);
      if (last) remembered.set(key, last);
      else remembered.delete(key);
    }
    console.error('[Metrics] catalog upsert failed:', error);
    if (isInternalLoggingEnabled()) {
      hub.captureLog('warn', '[Metrics] Catalog upsert failed', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return 0;
  }
}
