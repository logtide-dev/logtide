import { db } from '../../database/connection.js';
import { sql } from 'kysely';
import type { LogLevel } from '@logtide/shared';

// Preview types
export type { LogLevel } from '@logtide/shared';
export type PreviewRange = '1d' | '7d' | '14d' | '30d';

export interface PreviewAlertRuleInput {
  organizationId: string;
  projectId?: string | null;
  service?: string | null;
  level: LogLevel[];
  threshold: number;
  timeWindow: number; // minutes
  previewRange: PreviewRange;
}

export interface PreviewIncident {
  id: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  triggerCount: number;
  peakValue: number;
  averageValue: number;
  sampleLogs: Array<{
    time: Date;
    service: string;
    level: string;
    message: string;
    traceId?: string;
  }>;
}

export interface PreviewStatistics {
  incidents: {
    averageDuration: number;
    maxDuration: number;
    minDuration: number;
  };
  temporalPatterns: {
    byDayOfWeek: Array<{ day: string; count: number }>;
    byHourOfDay: Array<{ hour: number; count: number }>;
  };
  thresholdAnalysis: {
    percentAboveThreshold: number;
    p50Value: number;
    p95Value: number;
    p99Value: number;
  };
}

export interface PreviewSuggestion {
  type: 'threshold_too_low' | 'threshold_too_high' | 'time_based_pattern' | 'no_data';
  severity: 'info' | 'warning';
  message: string;
  detail?: string;
  recommendedValue?: number;
}

export interface PreviewAlertRuleOutput {
  summary: {
    totalTriggers: number;
    totalIncidents: number;
    affectedServices: string[];
    timeRange: {
      from: Date;
      to: Date;
    };
  };
  incidents: PreviewIncident[];
  statistics: PreviewStatistics;
  suggestions: PreviewSuggestion[];
}

export interface AlertRule {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  service: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  emailRecipients: string[];
  webhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlertRuleInput {
  organizationId: string;
  projectId?: string | null;
  name: string;
  enabled?: boolean;
  service?: string | null;
  level: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold: number;
  timeWindow: number;
  emailRecipients: string[];
  webhookUrl?: string | null;
}

export interface UpdateAlertRuleInput {
  name?: string;
  enabled?: boolean;
  service?: string | null;
  level?: ('debug' | 'info' | 'warn' | 'error' | 'critical')[];
  threshold?: number;
  timeWindow?: number;
  emailRecipients?: string[];
  webhookUrl?: string | null;
}

export class AlertsService {
  /**
   * Create a new alert rule
   */
  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    const alertRule = await db
      .insertInto('alert_rules')
      .values({
        organization_id: input.organizationId,
        project_id: input.projectId || null,
        name: input.name,
        enabled: input.enabled ?? true,
        service: input.service || null,
        level: input.level,
        threshold: input.threshold,
        time_window: input.timeWindow,
        email_recipients: input.emailRecipients,
        webhook_url: input.webhookUrl || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapAlertRule(alertRule);
  }

  /**
   * Get all alert rules for an organization
   */
  async getAlertRules(
    organizationId: string,
    options?: { projectId?: string | null; enabledOnly?: boolean }
  ): Promise<AlertRule[]> {
    let query = db
      .selectFrom('alert_rules')
      .selectAll()
      .where('organization_id', '=', organizationId);

    if (options?.projectId !== undefined) {
      if (options.projectId === null) {
        // Get only org-level alerts (projectId is null)
        query = query.where('project_id', 'is', null);
      } else {
        // Get alerts for specific project OR org-level alerts
        query = query.where((eb) =>
          eb.or([
            eb('project_id', '=', options.projectId!),
            eb('project_id', 'is', null),
          ])
        );
      }
    }

    if (options?.enabledOnly) {
      query = query.where('enabled', '=', true);
    }

    const rules = await query.orderBy('created_at', 'desc').execute();

    return rules.map(this.mapAlertRule);
  }

  /**
   * Get alert rule by ID
   */
  async getAlertRule(id: string, organizationId: string): Promise<AlertRule | null> {
    const rule = await db
      .selectFrom('alert_rules')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return rule ? this.mapAlertRule(rule) : null;
  }

  /**
   * Update alert rule
   */
  async updateAlertRule(
    id: string,
    organizationId: string,
    input: UpdateAlertRuleInput
  ): Promise<AlertRule | null> {
    const updateData: any = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.service !== undefined) updateData.service = input.service;
    if (input.level !== undefined) updateData.level = input.level;
    if (input.threshold !== undefined) updateData.threshold = input.threshold;
    if (input.timeWindow !== undefined) updateData.time_window = input.timeWindow;
    if (input.emailRecipients !== undefined) updateData.email_recipients = input.emailRecipients;
    if (input.webhookUrl !== undefined) updateData.webhook_url = input.webhookUrl;

    const rule = await db
      .updateTable('alert_rules')
      .set(updateData)
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    return rule ? this.mapAlertRule(rule) : null;
  }

  /**
   * Delete alert rule
   */
  async deleteAlertRule(id: string, organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('alert_rules')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0) > 0;
  }

  /**
   * Check alert rules and trigger if threshold is met
   */
  async checkAlertRules() {
    const rules = await db
      .selectFrom('alert_rules')
      .selectAll()
      .where('enabled', '=', true)
      .execute();

    const triggeredAlerts = [];

    for (const rule of rules) {
      const triggered = await this.checkRule(rule);
      if (triggered) {
        triggeredAlerts.push(triggered);
      }
    }

    return triggeredAlerts;
  }

  /**
   * Check a single rule
   */
  private async checkRule(rule: any) {
    // Get the last trigger time for this rule
    const lastTrigger = await db
      .selectFrom('alert_history')
      .select(['triggered_at'])
      .where('rule_id', '=', rule.id)
      .orderBy('triggered_at', 'desc')
      .executeTakeFirst();

    // Determine the time window for counting logs
    const timeWindow = new Date(Date.now() - rule.time_window * 60 * 1000);

    // If there's a last trigger, only count logs AFTER it
    // This prevents re-triggering on the same logs
    const fromTime = lastTrigger
      ? new Date(Math.max(new Date(lastTrigger.triggered_at).getTime(), timeWindow.getTime()))
      : timeWindow;

    // Count NEW logs (after last trigger or within time window)
    let query = db
      .selectFrom('logs')
      .select((eb) => eb.fn.count('time').as('count'))
      .where('time', '>', fromTime) // Use > to exclude the exact trigger time
      .where('level', 'in', rule.level);

    // Service filter: treat "unknown" as wildcard (matches any service filter)
    if (rule.service) {
      query = query.where((eb) =>
        eb.or([
          eb('service', '=', rule.service),
          eb('service', '=', 'unknown'),
        ])
      );
    }

    // Filter logs by project_id if rule is project-scoped
    if (rule.project_id) {
      query = query.where('project_id', '=', rule.project_id);
    } else {
      // Security: For organization-wide rules, filter by organization's projects
      // Get all project IDs for this organization
      const orgProjects = await db
        .selectFrom('projects')
        .select(['id'])
        .where('organization_id', '=', rule.organization_id)
        .execute();

      const projectIds = orgProjects.map((p) => p.id);

      if (projectIds.length > 0) {
        query = query.where('project_id', 'in', projectIds);
      } else {
        // No projects in organization, skip
        return null;
      }
    }

    const result = await query.executeTakeFirst();
    const count = Number(result?.count || 0);

    if (count >= rule.threshold) {
      // Record alert trigger
      const historyRecord = await db
        .insertInto('alert_history')
        .values({
          rule_id: rule.id,
          triggered_at: new Date(),
          log_count: count,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      return {
        historyId: historyRecord.id,
        rule_id: rule.id,
        rule_name: rule.name,
        organization_id: rule.organization_id,
        project_id: rule.project_id,
        log_count: count,
        threshold: rule.threshold,
        time_window: rule.time_window,
        email_recipients: rule.email_recipients,
        webhook_url: rule.webhook_url,
      };
    }

    return null;
  }

  /**
   * Get alert history for an organization
   */
  async getAlertHistory(
    organizationId: string,
    options?: { projectId?: string; limit?: number; offset?: number }
  ) {
    let query = db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .leftJoin('projects', 'projects.id', 'alert_rules.project_id')
      .select([
        'alert_history.id',
        'alert_history.rule_id',
        'alert_rules.name as rule_name',
        'alert_rules.project_id',
        'projects.name as project_name',
        'alert_history.triggered_at',
        'alert_history.log_count',
        'alert_history.notified',
        'alert_history.error',
        // Alert rule details
        'alert_rules.threshold',
        'alert_rules.time_window',
        'alert_rules.service',
        'alert_rules.level',
      ])
      .where('alert_rules.organization_id', '=', organizationId);

    if (options?.projectId) {
      query = query.where((eb) =>
        eb.or([
          eb('alert_rules.project_id', '=', options.projectId!),
          eb('alert_rules.project_id', 'is', null),
        ])
      );
    }

    const results = await query
      .orderBy('alert_history.triggered_at', 'desc')
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0)
      .execute();

    let totalQuery = db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select((eb) => eb.fn.count('alert_history.id').as('count'))
      .where('alert_rules.organization_id', '=', organizationId);

    if (options?.projectId) {
      totalQuery = totalQuery.where((eb) =>
        eb.or([
          eb('alert_rules.project_id', '=', options.projectId!),
          eb('alert_rules.project_id', 'is', null),
        ])
      );
    }

    const total = await totalQuery.executeTakeFirst();

    return {
      history: results.map((row) => ({
        id: row.id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        projectId: row.project_id,
        projectName: row.project_name,
        triggeredAt: row.triggered_at,
        logCount: row.log_count,
        notified: row.notified,
        error: row.error,
        threshold: row.threshold,
        timeWindow: row.time_window,
        service: row.service,
        level: row.level,
      })),
      total: Number(total?.count || 0),
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    };
  }

  /**
   * Mark alert as notified
   */
  async markAsNotified(historyId: string, error?: string) {
    await db
      .updateTable('alert_history')
      .set({
        notified: error ? false : true,
        error: error || null,
      })
      .where('id', '=', historyId)
      .execute();
  }

  /**
   * Preview how an alert rule would have performed over historical data
   */
  async previewAlertRule(input: PreviewAlertRuleInput): Promise<PreviewAlertRuleOutput> {
    // 1. Parse time range
    const rangeMs: Record<PreviewRange, number> = {
      '1d': 86400000,
      '7d': 604800000,
      '14d': 1209600000,
      '30d': 2592000000,
    };
    const to = new Date();
    const from = new Date(to.getTime() - rangeMs[input.previewRange]);

    // 2. Determine bucket interval based on time range (optimize for data volume)
    const bucketInterval =
      input.previewRange === '1d'
        ? '5 minutes'
        : input.previewRange === '7d'
          ? '15 minutes'
          : '1 hour';

    // 3. Get project IDs (single project or all org projects)
    const projectIds = await this.getProjectIds(input.organizationId, input.projectId);
    if (projectIds.length === 0) {
      return this.emptyPreviewResult(from, to);
    }

    // 4. Execute time-bucketed query
    const buckets = await this.getTimeBuckets(
      from,
      to,
      bucketInterval,
      projectIds,
      input.level,
      input.service
    );

    if (buckets.length === 0) {
      return this.emptyPreviewResult(from, to, [
        {
          type: 'no_data',
          severity: 'info',
          message: 'No logs found in the selected time range',
          detail: 'Try adjusting your filters or selecting a longer time range.',
        },
      ]);
    }

    // 5. Cluster consecutive triggers into incidents
    const bucketMs = this.getBucketMs(bucketInterval);
    const incidents = this.clusterIncidents(buckets, input.threshold, bucketMs);

    // 6. Fetch sample logs for top incidents (limit to avoid heavy queries)
    const topIncidents = incidents.slice(0, 10);
    for (const incident of topIncidents) {
      incident.sampleLogs = await this.fetchSampleLogs(
        incident.startTime,
        incident.endTime,
        projectIds,
        input.level,
        input.service
      );
    }

    // 7. Get affected services
    const affectedServices = await this.getAffectedServices(
      from,
      to,
      projectIds,
      input.level,
      input.service
    );

    // 8. Compute statistics
    const statistics = this.computeStatistics(buckets, incidents, input.threshold);

    // 9. Generate suggestions
    const suggestions = this.generateSuggestions(
      statistics,
      incidents,
      input.threshold,
      input.previewRange
    );

    return {
      summary: {
        totalTriggers: incidents.reduce((sum, i) => sum + i.triggerCount, 0),
        totalIncidents: incidents.length,
        affectedServices,
        timeRange: { from, to },
      },
      incidents: topIncidents,
      statistics,
      suggestions,
    };
  }

  /**
   * Get project IDs for the preview query
   */
  private async getProjectIds(
    organizationId: string,
    projectId?: string | null
  ): Promise<string[]> {
    if (projectId) {
      return [projectId];
    }

    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    return projects.map((p) => p.id);
  }

  /**
   * Get time-bucketed log counts
   */
  private async getTimeBuckets(
    from: Date,
    to: Date,
    bucketInterval: string,
    projectIds: string[],
    levels: LogLevel[],
    service?: string | null
  ): Promise<Array<{ bucket: Date; count: number }>> {
    let query = db
      .selectFrom('logs')
      .select([
        sql<Date>`time_bucket(${sql.lit(bucketInterval)}, time)`.as('bucket'),
        sql<string>`count(*)::int`.as('count'),
      ])
      .where('time', '>=', from)
      .where('time', '<=', to)
      .where('level', 'in', levels)
      .where('project_id', 'in', projectIds);

    if (service) {
      query = query.where((eb) =>
        eb.or([eb('service', '=', service), eb('service', '=', 'unknown')])
      );
    }

    const results = await query.groupBy('bucket').orderBy('bucket', 'asc').execute();

    return results.map((r) => ({
      bucket: new Date(r.bucket),
      count: Number(r.count),
    }));
  }

  /**
   * Get bucket size in milliseconds
   */
  private getBucketMs(bucketInterval: string): number {
    if (bucketInterval === '5 minutes') return 5 * 60 * 1000;
    if (bucketInterval === '15 minutes') return 15 * 60 * 1000;
    return 60 * 60 * 1000; // 1 hour
  }

  /**
   * Cluster consecutive buckets that exceed threshold into incidents
   */
  private clusterIncidents(
    buckets: Array<{ bucket: Date; count: number }>,
    threshold: number,
    bucketMs: number
  ): PreviewIncident[] {
    const incidents: PreviewIncident[] = [];
    let currentIncident: PreviewIncident | null = null;

    for (const bucket of buckets) {
      if (bucket.count >= threshold) {
        if (!currentIncident) {
          // Start new incident
          currentIncident = {
            id: crypto.randomUUID(),
            startTime: bucket.bucket,
            endTime: new Date(bucket.bucket.getTime() + bucketMs),
            durationMinutes: bucketMs / 60000,
            triggerCount: 1,
            peakValue: bucket.count,
            averageValue: bucket.count,
            sampleLogs: [],
          };
        } else {
          // Extend current incident
          currentIncident.endTime = new Date(bucket.bucket.getTime() + bucketMs);
          currentIncident.durationMinutes =
            (currentIncident.endTime.getTime() - currentIncident.startTime.getTime()) / 60000;
          currentIncident.triggerCount += 1;
          currentIncident.peakValue = Math.max(currentIncident.peakValue, bucket.count);
          // Running average
          currentIncident.averageValue = Math.round(
            (currentIncident.averageValue * (currentIncident.triggerCount - 1) + bucket.count) /
              currentIncident.triggerCount
          );
        }
      } else if (currentIncident) {
        // End current incident
        incidents.push(currentIncident);
        currentIncident = null;
      }
    }

    // Don't forget the last incident
    if (currentIncident) {
      incidents.push(currentIncident);
    }

    return incidents;
  }

  /**
   * Fetch sample logs for an incident
   */
  private async fetchSampleLogs(
    from: Date,
    to: Date,
    projectIds: string[],
    levels: LogLevel[],
    service?: string | null
  ): Promise<PreviewIncident['sampleLogs']> {
    let query = db
      .selectFrom('logs')
      .select(['time', 'service', 'level', 'message', 'trace_id'])
      .where('time', '>=', from)
      .where('time', '<=', to)
      .where('project_id', 'in', projectIds)
      .where('level', 'in', levels);

    if (service) {
      query = query.where((eb) =>
        eb.or([eb('service', '=', service), eb('service', '=', 'unknown')])
      );
    }

    const logs = await query.orderBy('time', 'desc').limit(5).execute();

    return logs.map((log) => ({
      time: new Date(log.time),
      service: log.service,
      level: log.level,
      message: log.message,
      traceId: log.trace_id || undefined,
    }));
  }

  /**
   * Get unique services affected in the time range
   */
  private async getAffectedServices(
    from: Date,
    to: Date,
    projectIds: string[],
    levels: LogLevel[],
    serviceFilter?: string | null
  ): Promise<string[]> {
    let query = db
      .selectFrom('logs')
      .select('service')
      .distinct()
      .where('time', '>=', from)
      .where('time', '<=', to)
      .where('project_id', 'in', projectIds)
      .where('level', 'in', levels);

    if (serviceFilter) {
      query = query.where((eb) =>
        eb.or([eb('service', '=', serviceFilter), eb('service', '=', 'unknown')])
      );
    }

    const services = await query.execute();
    return services.map((s) => s.service).filter((s) => s !== 'unknown');
  }

  /**
   * Compute statistics from buckets and incidents
   */
  private computeStatistics(
    buckets: Array<{ bucket: Date; count: number }>,
    incidents: PreviewIncident[],
    threshold: number
  ): PreviewStatistics {
    // Duration stats
    const durations = incidents.map((i) => i.durationMinutes);
    const avgDuration =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    // Temporal patterns
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDayOfWeek = dayNames.map((day) => ({ day, count: 0 }));
    const byHourOfDay = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));

    for (const incident of incidents) {
      const day = incident.startTime.getUTCDay();
      const hour = incident.startTime.getUTCHours();
      byDayOfWeek[day].count += 1;
      byHourOfDay[hour].count += 1;
    }

    // Threshold analysis (percentiles)
    const counts = buckets.map((b) => b.count).sort((a, b) => a - b);
    const getPercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const index = Math.min(Math.floor(arr.length * p), arr.length - 1);
      return arr[index];
    };

    const percentAbove =
      buckets.length > 0
        ? Math.round((buckets.filter((b) => b.count >= threshold).length / buckets.length) * 100)
        : 0;

    return {
      incidents: {
        averageDuration: avgDuration,
        maxDuration: Math.max(...durations, 0),
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
      },
      temporalPatterns: { byDayOfWeek, byHourOfDay },
      thresholdAnalysis: {
        percentAboveThreshold: percentAbove,
        p50Value: getPercentile(counts, 0.5),
        p95Value: getPercentile(counts, 0.95),
        p99Value: getPercentile(counts, 0.99),
      },
    };
  }

  /**
   * Generate suggestions based on preview analysis
   */
  private generateSuggestions(
    stats: PreviewStatistics,
    incidents: PreviewIncident[],
    threshold: number,
    range: PreviewRange
  ): PreviewSuggestion[] {
    const suggestions: PreviewSuggestion[] = [];
    const rangeDays = { '1d': 1, '7d': 7, '14d': 14, '30d': 30 }[range];

    // Too many triggers (alert fatigue)
    if (stats.thresholdAnalysis.percentAboveThreshold > 15) {
      suggestions.push({
        type: 'threshold_too_low',
        severity: 'warning',
        message: `Alert would trigger ${stats.thresholdAnalysis.percentAboveThreshold}% of time buckets`,
        detail: 'This may cause alert fatigue. Consider raising the threshold.',
        recommendedValue: stats.thresholdAnalysis.p95Value,
      });
    } else if (incidents.length > rangeDays * 5) {
      // More than 5 incidents per day average
      suggestions.push({
        type: 'threshold_too_low',
        severity: 'warning',
        message: `${incidents.length} incidents in ${rangeDays} days may be too noisy`,
        detail: 'Consider increasing the threshold to reduce noise.',
        recommendedValue: Math.ceil(threshold * 1.5),
      });
    }

    // No triggers at all
    if (incidents.length === 0 && stats.thresholdAnalysis.p99Value > 0) {
      suggestions.push({
        type: 'threshold_too_high',
        severity: 'info',
        message: `No triggers found in the last ${rangeDays} days`,
        detail: 'The threshold may be too high to catch real issues.',
        recommendedValue:
          stats.thresholdAnalysis.p95Value > 0 ? stats.thresholdAnalysis.p95Value : undefined,
      });
    }

    // Time-based pattern detection
    const maxDayCount = Math.max(...stats.temporalPatterns.byDayOfWeek.map((d) => d.count));
    const maxDay = stats.temporalPatterns.byDayOfWeek.find((d) => d.count === maxDayCount);
    if (maxDay && incidents.length > 3 && maxDayCount > incidents.length * 0.4) {
      suggestions.push({
        type: 'time_based_pattern',
        severity: 'info',
        message: `${Math.round((maxDayCount / incidents.length) * 100)}% of incidents occur on ${maxDay.day}`,
        detail: 'This might indicate scheduled jobs or recurring patterns.',
      });
    }

    // Hour-based pattern
    const maxHourCount = Math.max(...stats.temporalPatterns.byHourOfDay.map((h) => h.count));
    const maxHour = stats.temporalPatterns.byHourOfDay.find((h) => h.count === maxHourCount);
    if (maxHour && incidents.length > 3 && maxHourCount > incidents.length * 0.3) {
      suggestions.push({
        type: 'time_based_pattern',
        severity: 'info',
        message: `Peak activity at ${maxHour.hour}:00 UTC`,
        detail: 'Consider if this aligns with expected patterns (deployments, traffic peaks).',
      });
    }

    return suggestions;
  }

  /**
   * Return empty preview result
   */
  private emptyPreviewResult(
    from: Date,
    to: Date,
    suggestions: PreviewSuggestion[] = []
  ): PreviewAlertRuleOutput {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      summary: {
        totalTriggers: 0,
        totalIncidents: 0,
        affectedServices: [],
        timeRange: { from, to },
      },
      incidents: [],
      statistics: {
        incidents: { averageDuration: 0, maxDuration: 0, minDuration: 0 },
        temporalPatterns: {
          byDayOfWeek: dayNames.map((day) => ({ day, count: 0 })),
          byHourOfDay: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
        },
        thresholdAnalysis: {
          percentAboveThreshold: 0,
          p50Value: 0,
          p95Value: 0,
          p99Value: 0,
        },
      },
      suggestions,
    };
  }

  private mapAlertRule(row: any): AlertRule {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      name: row.name,
      enabled: row.enabled,
      service: row.service,
      level: row.level,
      threshold: row.threshold,
      timeWindow: row.time_window,
      emailRecipients: row.email_recipients,
      webhookUrl: row.webhook_url,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const alertsService = new AlertsService();
