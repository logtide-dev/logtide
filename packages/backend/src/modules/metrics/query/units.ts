// Units and types from the metric catalog (Postgres table metric_catalog,
// filled at ingestion). Read defensively: an instance whose catalog table is
// missing simply has no units.

import { sql } from 'kysely';
import { db } from '../../../database/index.js';

export interface CatalogInfo {
  unit: string | null;
  type: string | null;
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
    const result = await sql<{ metric_name: string; metric_type: string; unit: string | null }>`
      SELECT metric_name, metric_type, unit
      FROM metric_catalog
      WHERE project_id = ANY(${projectIds}::uuid[])
        AND metric_name = ANY(${metricNames}::text[])
      ORDER BY last_seen_at DESC
    `.execute(db);
    for (const row of result.rows) {
      const entry = entries.get(row.metric_name);
      if (!entry) {
        entries.set(row.metric_name, { unit: row.unit ?? null, type: row.metric_type ?? null });
      } else if (entry.unit === null && row.unit) {
        entry.unit = row.unit;
      }
    }
    return { available: true, entries };
  } catch (err) {
    if ((err as { code?: string })?.code === UNDEFINED_TABLE) return { available: false, entries };
    throw err;
  }
}

/** unitOverride (when set) > catalog unit > null. */
export function resolveUnit(override: string | null | undefined, catalogUnit: string | null | undefined): string | null {
  if (typeof override === 'string' && override.length > 0) return override;
  return catalogUnit ?? null;
}
