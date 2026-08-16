import { sql } from 'kysely';
import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';

export interface ProjectUsage {
  projectId: string;
  projectName: string;
  events: number;
  bytes: number;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface TypeUsage {
  type: string;
  quantity: number;
}

export interface UsageBreakdown {
  /** Volume per metering signal type (logs.ingested.events/bytes, and later spans/metrics). */
  byType: TypeUsage[];
  /** Per-project consumption (from metering), with the project name resolved. */
  byProject: ProjectUsage[];
  /** Which services produced the ingested logs (from the reservoir, engine-agnostic). */
  byService: ValueCount[];
  /** Level distribution of the ingested logs. */
  byLevel: ValueCount[];
}

export interface UsageBreakdownParams {
  organizationId: string;
  from: Date;
  to: Date;
  /** Cap on the number of services returned (levels are always returned in full). */
  limit?: number;
  /**
   * When false, byService/byLevel come back empty and the per-project reservoir
   * queries behind them are skipped entirely. For callers that only need the
   * metering halves (the digest usage section), that is two log-store scans per
   * project saved. Defaults to true, so existing callers are unaffected.
   */
  includeValueBreakdowns?: boolean;
}

/**
 * Org-scoped "what is being ingested" breakdown for the Usage view.
 * - byProject: events/bytes per project from metering_events, joined to project names.
 * - byService / byLevel: composition of the ingested logs, aggregated across the org's
 *   projects via the reservoir abstraction (so it works on any storage engine).
 *   Opt out with includeValueBreakdowns: false when the caller only needs the
 *   metering halves.
 */
export async function getUsageBreakdown(params: UsageBreakdownParams): Promise<UsageBreakdown> {
  const { organizationId, from, to } = params;
  const limit = params.limit ?? 20;
  const includeValueBreakdowns = params.includeValueBreakdowns ?? true;

  const projects = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where('organization_id', '=', organizationId)
    .execute();
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  // Per-project events/bytes from metering_events.
  const meter = await sql<{ project_id: string | null; type: string; quantity: number | string }>`
    SELECT project_id, type, SUM(quantity)::float8 AS quantity
    FROM metering_events
    WHERE organization_id = ${organizationId}
      AND time >= ${from} AND time < ${to}
      AND type IN ('logs.ingested.events', 'logs.ingested.bytes')
    GROUP BY project_id, type`.execute(db);

  const perProject = new Map<string, { events: number; bytes: number }>();
  for (const r of meter.rows) {
    if (!r.project_id) continue;
    const q = typeof r.quantity === 'number' ? r.quantity : parseFloat(r.quantity);
    const acc = perProject.get(r.project_id) ?? { events: 0, bytes: 0 };
    if (r.type === 'logs.ingested.events') acc.events += q;
    else acc.bytes += q;
    perProject.set(r.project_id, acc);
  }

  const byProject: ProjectUsage[] = Array.from(perProject.entries())
    .map(([projectId, v]) => ({
      projectId,
      projectName: nameById.get(projectId) ?? 'unknown',
      events: v.events,
      bytes: v.bytes,
    }))
    .sort((a, b) => b.events - a.events);

  // Volume per metering signal type (all counter types, so future spans/metrics surface too).
  // storage.snapshot is a gauge, not a counter: excluded from summed breakdowns.
  // ingestion.* health counters (WS1) are operational signals, not usage: hidden from tenants.
  const typeRows = await sql<{ type: string; quantity: number | string }>`
    SELECT type, SUM(quantity)::float8 AS quantity
    FROM metering_events
    WHERE organization_id = ${organizationId}
      AND time >= ${from} AND time < ${to}
      AND type <> 'storage.snapshot'
      AND type NOT LIKE 'ingestion.%'
    GROUP BY type
    ORDER BY type`.execute(db);
  const byType: TypeUsage[] = typeRows.rows.map((r) => ({
    type: r.type,
    quantity: typeof r.quantity === 'number' ? r.quantity : parseFloat(r.quantity),
  }));

  if (!includeValueBreakdowns) {
    return { byType, byProject, byService: [], byLevel: [] };
  }

  // Service + level composition from the ingested logs, merged across the org's projects.
  const serviceCounts = new Map<string, number>();
  const levelCounts = new Map<string, number>();
  for (const p of projects) {
    const [svc, lvl] = await Promise.all([
      reservoir.topValues({ field: 'service', projectId: p.id, from, to, limit: 50 }),
      reservoir.topValues({ field: 'level', projectId: p.id, from, to, limit: 20 }),
    ]);
    for (const v of svc.values) {
      const key = String(v.value);
      serviceCounts.set(key, (serviceCounts.get(key) ?? 0) + v.count);
    }
    for (const v of lvl.values) {
      const key = String(v.value);
      levelCounts.set(key, (levelCounts.get(key) ?? 0) + v.count);
    }
  }

  const toSorted = (m: Map<string, number>, lim: number): ValueCount[] =>
    Array.from(m.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, lim);

  return {
    byType,
    byProject,
    byService: toSorted(serviceCounts, limit),
    byLevel: toSorted(levelCounts, 20),
  };
}
