import { Kysely, sql } from 'kysely';
import { MITRE_TECHNIQUES, panelTimeRangeToMs } from '@logtide/shared';
import type { Database } from '../../database/types';
import type {
  DashboardStats,
  DashboardFilters,
  TopThreat,
  TimelineBucket,
  AffectedService,
  SeverityDistribution,
  MitreHeatmapCell,
} from './types';

function resolveTacticForTechnique(technique: string): string | null {
  const direct = (MITRE_TECHNIQUES as Record<string, { tactic: string }>)[technique];
  if (direct) return direct.tactic;
  const base = technique.split('.')[0];
  const parent = (MITRE_TECHNIQUES as Record<string, { tactic: string }>)[base];
  return parent ? parent.tactic : null;
}

export class SiemDashboardService {
  constructor(private db: Kysely<Database>) {}

  async getDashboardStats(filters: DashboardFilters): Promise<DashboardStats> {
    const { startTime, endTime } = this.getTimeRange(filters.timeRange);

    const [
      topThreats,
      timeline,
      affectedServices,
      severityDistribution,
      mitreHeatmap,
      totalStats,
    ] = await Promise.all([
      this.getTopThreats(filters, startTime, endTime),
      this.getTimeline(filters, startTime, endTime),
      this.getAffectedServices(filters, startTime, endTime),
      this.getSeverityDistribution(filters, startTime, endTime),
      this.getMitreHeatmap(filters, startTime, endTime),
      this.getTotalStats(filters, startTime, endTime),
    ]);

    return {
      topThreats,
      timeline,
      affectedServices,
      severityDistribution,
      mitreHeatmap,
      totalDetections: totalStats.totalDetections,
      totalIncidents: totalStats.totalIncidents,
      openIncidents: totalStats.openIncidents,
      criticalIncidents: totalStats.criticalIncidents,
    };
  }

  /**
   * Get top threats (Sigma rules with most detections)
   */
  private async getTopThreats(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<TopThreat[]> {
    let query = this.db
      .selectFrom('detection_events')
      .select([
        'sigma_rule_id as ruleId',
        'rule_title as ruleTitle',
        'severity',
        'mitre_tactics as mitreTactics',
        'mitre_techniques as mitreTechniques',
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    const results = await query
      .groupBy([
        'sigma_rule_id',
        'rule_title',
        'severity',
        'mitre_tactics',
        'mitre_techniques',
      ])
      .orderBy('count', 'desc')
      .limit(10)
      .execute();

    return results.map((row) => ({
      ruleId: row.ruleId,
      ruleTitle: row.ruleTitle,
      count: row.count,
      severity: row.severity,
      mitreTactics: row.mitreTactics,
      mitreTechniques: row.mitreTechniques,
    }));
  }

  private async getTimeline(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<TimelineBucket[]> {
    const bucketInterval = this.getBucketInterval(filters.timeRange);

    let query = this.db
      .selectFrom('detection_events')
      .select([
        sql<Date>`time_bucket(${bucketInterval}::interval, time)`.as('timestamp'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    const results = await query
      .groupBy('timestamp')
      .orderBy('timestamp', 'asc')
      .execute();

    return results.map((row) => ({
      timestamp: row.timestamp,
      count: row.count,
    }));
  }

  private async getAffectedServices(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<AffectedService[]> {
    let detectionQuery = this.db
      .selectFrom('detection_events')
      .select([
        'service',
        sql<number>`count(*)::int`.as('detectionCount'),
        sql<number>`count(distinct incident_id)::int`.as('incidents'),
        sql<number>`count(*) filter (where severity = 'critical')::int`.as(
          'criticalCount'
        ),
        sql<number>`count(*) filter (where severity = 'high')::int`.as(
          'highCount'
        ),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime);

    if (filters.projectId) {
      detectionQuery = detectionQuery.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      detectionQuery = detectionQuery.where('severity', 'in', filters.severity);
    }

    const results = await detectionQuery
      .groupBy('service')
      .orderBy('detectionCount', 'desc')
      .limit(10)
      .execute();

    return results.map((row) => ({
      serviceName: row.service,
      detectionCount: row.detectionCount,
      incidents: row.incidents,
      criticalCount: row.criticalCount,
      highCount: row.highCount,
    }));
  }


  private async getSeverityDistribution(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<SeverityDistribution[]> {
    let query = this.db
      .selectFrom('detection_events')
      .select([
        'severity',
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    const results = await query
      .groupBy('severity')
      .orderBy('count', 'desc')
      .execute();

    const total = results.reduce((sum, row) => sum + row.count, 0);

    return results.map((row) => ({
      severity: row.severity,
      count: row.count,
      percentage: total > 0 ? Math.round((row.count / total) * 100) : 0,
    }));
  }

  private async getMitreHeatmap(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<MitreHeatmapCell[]> {
    let query = this.db
      .selectFrom('detection_events')
      .select([
        sql<string>`unnest(mitre_techniques)`.as('technique'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime)
      .where('mitre_techniques', 'is not', null);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    const results = await query.groupBy('technique').execute();

    // Pair each technique with its canonical MITRE tactic. Previously we did
    // two parallel unnest() calls on mitre_techniques and mitre_tactics in the
    // same SELECT, which PostgreSQL evaluates in lockstep: when the two arrays
    // had different lengths the shorter one got NULL-padded, producing cells
    // with null tactic/technique that crashed the frontend (issue #200).
    const cells = new Map<string, MitreHeatmapCell>();
    for (const row of results) {
      if (!row.technique) continue;
      const tactic = resolveTacticForTechnique(row.technique);
      if (!tactic) continue;
      const key = `${row.technique}|${tactic}`;
      const existing = cells.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        cells.set(key, { technique: row.technique, tactic, count: row.count });
      }
    }

    return Array.from(cells.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }

  private async getTotalStats(
    filters: DashboardFilters,
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalDetections: number;
    totalIncidents: number;
    openIncidents: number;
    criticalIncidents: number;
  }> {
    let detectionQuery = this.db
      .selectFrom('detection_events')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('organization_id', '=', filters.organizationId)
      .where('category', '=', 'security')
      .where('time', '>=', startTime)
      .where('time', '<=', endTime);

    if (filters.projectId) {
      detectionQuery = detectionQuery.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      detectionQuery = detectionQuery.where('severity', 'in', filters.severity);
    }

    const detectionResult = await detectionQuery.executeTakeFirst();
    const totalDetections = detectionResult?.count ?? 0;

    let incidentQuery = this.db
      .selectFrom('incidents')
      .select([
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) filter (where status = 'open' or status = 'investigating')::int`.as(
          'open'
        ),
        sql<number>`count(*) filter (where severity = 'critical')::int`.as(
          'critical'
        ),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('created_at', '>=', startTime)
      .where('created_at', '<=', endTime);

    if (filters.projectId) {
      incidentQuery = incidentQuery.where('project_id', '=', filters.projectId);
    }

    const incidentResult = await incidentQuery.executeTakeFirst();

    return {
      totalDetections,
      totalIncidents: incidentResult?.total ?? 0,
      openIncidents: incidentResult?.open ?? 0,
      criticalIncidents: incidentResult?.critical ?? 0,
    };
  }

  private getTimeRange(timeRange: string): {
    startTime: Date;
    endTime: Date;
  } {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - panelTimeRangeToMs(timeRange));
    return { startTime, endTime };
  }

  // Timeline bucket width by window size. The historical mapping is preserved
  // (24h -> 1 hour, 7d -> 6 hours, 30d -> 1 day); the added tiers serve the
  // wider panel presets (#305).
  private getBucketInterval(timeRange: string): string {
    const hour = 60 * 60 * 1000;
    const ms = panelTimeRangeToMs(timeRange);
    if (ms <= hour) return '5 minutes';
    if (ms <= 6 * hour) return '15 minutes';
    if (ms <= 12 * hour) return '30 minutes';
    if (ms <= 48 * hour) return '1 hour';
    if (ms <= 14 * 24 * hour) return '6 hours';
    return '1 day';
  }
}
