// Units and types from the metric catalog (Postgres table metric_catalog,
// filled at ingestion). Read defensively: an instance whose catalog table is
// missing simply has no units.

import { sql } from 'kysely';
import { db } from '../../../database/index.js';

export interface CatalogInfo {
  unit: string | null;
  type: string | null;
  /** Sums and histograms: OTLP aggregation temporality (first non-null across projects). */
  temporality?: 'cumulative' | 'delta' | null;
  /** Sums: monotonic flag (first non-null across projects). */
  isMonotonic?: boolean | null;
  /** Projects with a catalog row for the name, most recently seen first. */
  projectIds?: string[];
}

export interface CatalogLookup {
  /** False when the catalog could not be read (table missing): no "unknown metric" errors then. */
  available: boolean;
  entries: Map<string, CatalogInfo>;
}

/** Postgres undefined_table. */
const UNDEFINED_TABLE = '42P01';

/**
 * Unit and type per metric name across the projects: the first non-null unit
 * (most recently seen project first) and the most recently seen type.
 */
export async function loadCatalog(projectIds: string[], metricNames: string[]): Promise<CatalogLookup> {
  const entries = new Map<string, CatalogInfo>();
  if (projectIds.length === 0 || metricNames.length === 0) return { available: true, entries };
  try {
    const result = await sql<{
      project_id: string;
      metric_name: string;
      metric_type: string;
      unit: string | null;
      temporality: 'cumulative' | 'delta' | null;
      is_monotonic: boolean | null;
    }>`
      SELECT project_id, metric_name, metric_type, unit, temporality, is_monotonic
      FROM metric_catalog
      WHERE project_id = ANY(${projectIds}::uuid[])
        AND metric_name = ANY(${metricNames}::text[])
      ORDER BY last_seen_at DESC, project_id
    `.execute(db);
    for (const row of result.rows) {
      const entry = entries.get(row.metric_name);
      if (!entry) {
        entries.set(row.metric_name, {
          unit: row.unit ?? null,
          type: row.metric_type ?? null,
          temporality: row.temporality ?? null,
          isMonotonic: row.is_monotonic ?? null,
          projectIds: [row.project_id],
        });
        continue;
      }
      if (!entry.projectIds!.includes(row.project_id)) entry.projectIds!.push(row.project_id);
      // Later rows are older; they only fill what is still unknown, and only
      // for the same type as the most recent one.
      if (entry.unit === null && row.unit) entry.unit = row.unit;
      if (row.metric_type !== entry.type) continue;
      if (!entry.temporality && row.temporality) entry.temporality = row.temporality;
      if (entry.isMonotonic == null && row.is_monotonic != null) entry.isMonotonic = row.is_monotonic;
    }
    return { available: true, entries };
  } catch (err) {
    if ((err as { code?: string })?.code === UNDEFINED_TABLE) return { available: false, entries };
    throw err;
  }
}

export const HISTOGRAM_TYPES = new Set(['histogram', 'exp_histogram']);

export function isHistogramType(type: string | null | undefined): boolean {
  return !!type && HISTOGRAM_TYPES.has(type);
}

/**
 * Temporality used for the math: the catalog value, else cumulative for sums
 * and histograms (the OTLP SDK default; Prometheus counters and the older
 * catalog rows without temporality are cumulative too). Only an explicit
 * 'delta' makes a sum or histogram delta, whatever isMonotonic says.
 */
export function effectiveTemporality(info: CatalogInfo | undefined): 'cumulative' | 'delta' | null {
  if (!info) return null;
  if (info.temporality === 'cumulative' || info.temporality === 'delta') return info.temporality;
  if (info.type === 'sum' || isHistogramType(info.type)) return 'cumulative';
  return null;
}

/**
 * Unit of a query result before the override: histogram counts have no unit
 * and their rate is a count per second; everything else keeps the catalog
 * unit (durations stay in s or ms).
 */
export function queryResultUnit(
  info: CatalogInfo | undefined,
  aggregation: string,
): string | null {
  const unit = info?.unit ?? null;
  if (!isHistogramType(info?.type)) return unit;
  if (aggregation === 'count') return null;
  if (aggregation === 'rate') return '{count}/s';
  return unit;
}

/** unitOverride (when set) > catalog unit > null. */
export function resolveUnit(override: string | null | undefined, catalogUnit: string | null | undefined): string | null {
  if (typeof override === 'string' && override.length > 0) return override;
  return catalogUnit ?? null;
}
