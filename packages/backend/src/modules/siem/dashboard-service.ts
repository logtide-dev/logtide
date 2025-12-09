import { Kysely, sql } from 'kysely';
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
        sql<Date>`time_bucket(${bucketInterval}, time)`.as('timestamp'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
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
        sql<string>`unnest(mitre_tactics)`.as('tactic'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('time', '>=', startTime)
      .where('time', '<=', endTime)
      .where('mitre_techniques', 'is not', null)
      .where('mitre_tactics', 'is not', null);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    const results = await query
      .groupBy(['technique', 'tactic'])
      .orderBy('count', 'desc')
      .limit(50) // Top 50 technique-tactic combinations
      .execute();

    return results.map((row) => ({
      technique: row.technique,
      tactic: row.tactic,
      count: row.count,
    }));
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

  private getTimeRange(timeRange: '24h' | '7d' | '30d'): {
    startTime: Date;
    endTime: Date;
  } {
    const endTime = new Date();
    const startTime = new Date();

    switch (timeRange) {
      case '24h':
        startTime.setHours(startTime.getHours() - 24);
        break;
      case '7d':
        startTime.setDate(startTime.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(startTime.getDate() - 30);
        break;
    }

    return { startTime, endTime };
  }

  private getBucketInterval(
    timeRange: '24h' | '7d' | '30d'
  ): string {
    switch (timeRange) {
      case '24h':
        return '1 hour';
      case '7d':
        return '6 hours';
      case '30d':
        return '1 day';
      default:
        return '1 hour';
    }
  }
}
