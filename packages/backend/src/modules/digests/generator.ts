/**
 * Digest Generator Service
 *
 * Generates and sends email digest reports summarizing organization activity
 * over a period: log volume, top services by errors, new error groups,
 * security detections and monitor uptime.
 */

import nodemailer from 'nodemailer';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { reservoir } from '../../database/reservoir.js';
import { getUsageBreakdown } from '../metering/breakdown.js';
import { getCapabilityUsage } from '../metering/capability-usage.js';
import { hub } from '@logtide/core';
import { DIGEST_SECTION_DEFAULTS, LOG_LEVELS } from '@logtide/shared';
import type { DigestSections } from '@logtide/shared';
import { config } from '../../config/index.js';
import { generateDigestEmail } from '../../lib/email-templates.js';
import type { DigestJobPayload } from './scheduler.js';

export interface DigestReportData {
  organizationName: string;
  frequency: 'daily' | 'weekly';
  periodLabel: string;
  logVolume: {
    current: number;
    previous: number;
    trend: string;
  };
  topErrorServices: Array<{
    service: string;
    errorCount: number;
    previousCount: number;
    delta: number;
  }>;
  newErrorGroups: Array<{
    exceptionType: string;
    exceptionMessage: string;
    occurrenceCount: number;
    language: string;
  }>;
  security: {
    totalDetections: number;
    topRules: Array<{ ruleTitle: string; severity: string; count: number }>;
    openIncidents: number;
  };
  uptime: {
    monitorCount: number;
    overallUptimePct: number;
    worstMonitors: Array<{ name: string; uptimePct: number }>;
  } | null;
  // Optional sections: undefined means "disabled OR no data", and the email
  // skips them entirely (no empty-state lines, unlike the five sections above).
  logBreakdown?: {
    levels: Array<{ level: string; current: number; previous: number }>;
    errorRatePct: number;
    previousErrorRatePct: number;
    /** Weekly digests only */
    daily?: Array<{ date: string; count: number }>;
  };
  topErrorMessages?: Array<{ message: string; count: number }>;
  alerts?: {
    total: number;
    previousTotal: number;
    trend: string;
    topRules: Array<{ name: string; count: number }>;
  };
  traces?: {
    spanCount: number;
    previousSpanCount: number;
    trend: string;
    errorSpanCount: number;
    /** Top 5 by calls desc */
    services: Array<{ service: string; calls: number; errorRatePct: number; p95Ms: number | null }>;
    /** Top 5 slowest spans in the period */
    slowestSpans: Array<{ service: string; operation: string; durationMs: number }>;
  };
  metrics?: {
    datapoints: number;
    previousDatapoints: number;
    trend: string;
  };
  securityActivity?: {
    /** Only severities with at least one incident, ordered critical first */
    openedBySeverity: Array<{ severity: string; count: number }>;
    resolvedCount: number;
    /** Top 5 MITRE techniques seen in the period */
    topTechniques: Array<{ technique: string; count: number }>;
  };
  /** Top 5 monitors by p95 response time, worst first */
  monitorPerformance?: Array<{
    name: string;
    avgMs: number;
    p95Ms: number;
    failedChecks: number;
  }>;
  usage?: {
    logEvents: number;
    logBytes: number;
    spans: number;
    /** Top 5 projects by ingested events */
    topProjects: Array<{ name: string; events: number }>;
    /** Capabilities at or above 80% of their configured limit (month to date) */
    quotaWarnings: Array<{ capability: string; usedPct: number }>;
  };
  webhooks?: {
    delivered: number;
    failed: number;
    dead: number;
  };
  teamActivity?: {
    membersAdded: number;
    membersRemoved: number;
    configChanges: number;
    failedLogins: number;
  };
}

interface DigestRecipient {
  email: string;
  unsubscribe_token: string;
}

interface Period {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

const ERROR_LEVELS = ['error', 'critical'] as const;

/** Reporting order for incident severities, worst first. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'] as const;

/** A capability at or above this share of its limit is worth warning about. */
const QUOTA_WARNING_THRESHOLD = 0.8;

let emailTransporter: nodemailer.Transporter | null = null;

function getEmailTransporter(): nodemailer.Transporter | null {
  if (!emailTransporter) {
    if (!config.SMTP_HOST) {
      hub.captureLog('warn', '[DigestGenerator] SMTP not configured - digest emails disabled');
      return null;
    }

    const transportOpts: Record<string, unknown> = {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_SECURE || false,
    };

    if (config.SMTP_USER && config.SMTP_PASS) {
      transportOpts.auth = {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      };
    }

    emailTransporter = nodemailer.createTransport(transportOpts as nodemailer.TransportOptions);
    hub.captureLog('info', `[DigestGenerator] Email transporter configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  }

  return emailTransporter;
}

export class DigestGeneratorService {

  async generateAndSendDigest(payload: DigestJobPayload): Promise<void> {
    const { organizationId, digestConfigId, frequency } = payload;

    hub.captureLog('info', `[DigestGenerator] Generating ${frequency} digest for org ${organizationId}`);

    try {
      const organization = await db
        .selectFrom('organizations')
        .select(['name'])
        .where('id', '=', organizationId)
        .executeTakeFirst();

      if (!organization) {
        throw new Error(`Organization ${organizationId} not found`);
      }

      const recipients = await this.fetchRecipients(organizationId, digestConfigId);

      if (recipients.length === 0) {
        hub.captureLog('info', `[DigestGenerator] No subscribed recipients for org ${organizationId}, skipping`);
        return;
      }

      // Jobs enqueued before section toggles shipped carry no flags: use defaults.
      const report = await this.buildReportData(
        organizationId,
        organization.name,
        frequency,
        payload.sections ?? DIGEST_SECTION_DEFAULTS
      );

      await this.sendDigestEmails(recipients, report);

      hub.captureLog('info', `[DigestGenerator] Digest sent to ${recipients.length} recipient(s) for org ${organizationId}`);
    } catch (error: any) {
      hub.captureLog('error', `[DigestGenerator] Failed to generate digest for org ${organizationId}: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Compute the enabled report sections for the period. Sections run
   * sequentially: this is a background cron path where simplicity beats
   * latency. A disabled section costs zero queries.
   *
   * The five original sections always run (they are non-optional fields of
   * DigestReportData); the optional ones are computed after them, in the
   * catalog order of DIGEST_SECTION_KEYS, so the order stays unambiguous.
   */
  async buildReportData(
    organizationId: string,
    organizationName: string,
    frequency: 'daily' | 'weekly',
    sections: DigestSections = DIGEST_SECTION_DEFAULTS
  ): Promise<DigestReportData> {
    const period = this.buildPeriod(frequency);

    const projects = await db
      .selectFrom('projects')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .execute();
    const projectIds = projects.map((p) => p.id);

    const logVolume = await this.calculateLogVolume(projectIds, period);
    const topErrorServices = await this.calculateTopErrorServices(projectIds, period);
    const newErrorGroups = await this.calculateNewErrorGroups(organizationId, period);
    const security = await this.calculateSecuritySummary(organizationId, period);
    const uptime = await this.calculateUptimeSummary(organizationId, period);

    const logBreakdown = sections.logBreakdown
      ? await this.calculateLogBreakdown(projectIds, period, frequency)
      : undefined;
    const topErrorMessages = sections.topErrorMessages
      ? await this.calculateTopErrorMessages(projectIds, period)
      : undefined;
    const alerts = sections.alerts
      ? await this.calculateAlertsSummary(organizationId, period)
      : undefined;
    const traces = sections.traces
      ? await this.calculateTracesSummary(projectIds, period, frequency)
      : undefined;
    const metrics = sections.metrics
      ? await this.calculateMetricsSummary(projectIds, period)
      : undefined;
    const securityActivity = sections.securityActivity
      ? await this.calculateSecurityActivity(organizationId, period)
      : undefined;
    const monitorPerformance = sections.monitorPerformance
      ? await this.calculateMonitorPerformance(organizationId, period)
      : undefined;
    const usage = sections.usage
      ? await this.calculateUsageSummary(organizationId, period)
      : undefined;
    const webhooks = sections.webhooks
      ? await this.calculateWebhookSummary(organizationId, period)
      : undefined;
    const teamActivity = sections.teamActivity
      ? await this.calculateTeamActivity(organizationId, period)
      : undefined;

    return {
      organizationName,
      frequency,
      periodLabel: frequency === 'daily' ? 'last 24 hours' : 'last 7 days',
      logVolume,
      topErrorServices,
      newErrorGroups,
      security,
      uptime,
      logBreakdown,
      topErrorMessages,
      alerts,
      traces,
      metrics,
      securityActivity,
      monitorPerformance,
      usage,
      webhooks,
      teamActivity,
    };
  }

  private buildPeriod(frequency: 'daily' | 'weekly'): Period {
    // Sliding window relative to execution time
    const hoursInPeriod = frequency === 'daily' ? 24 : 168;
    const now = new Date();
    const from = new Date(now.getTime() - hoursInPeriod * 60 * 60 * 1000);
    const previousFrom = new Date(now.getTime() - hoursInPeriod * 2 * 60 * 60 * 1000);

    return { from, to: now, previousFrom, previousTo: from };
  }

  private async calculateLogVolume(
    projectIds: string[],
    period: Period
  ): Promise<DigestReportData['logVolume']> {
    if (projectIds.length === 0) {
      return { current: 0, previous: 0, trend: this.calculateTrend(0, 0) };
    }

    const currentResult = await reservoir.count({
      projectId: projectIds,
      from: period.from,
      to: period.to,
      toExclusive: true,
    });

    const previousResult = await reservoir.count({
      projectId: projectIds,
      from: period.previousFrom,
      to: period.previousTo,
      toExclusive: true,
    });

    return {
      current: currentResult.count,
      previous: previousResult.count,
      trend: this.calculateTrend(currentResult.count, previousResult.count),
    };
  }

  /**
   * Top 5 services by error+critical log count, with the delta against the
   * previous period. Engine-agnostic through reservoir.topValues.
   */
  private async calculateTopErrorServices(
    projectIds: string[],
    period: Period
  ): Promise<DigestReportData['topErrorServices']> {
    if (projectIds.length === 0) {
      return [];
    }

    const current = await reservoir.topValues({
      field: 'service',
      projectId: projectIds,
      level: [...ERROR_LEVELS],
      from: period.from,
      to: period.to,
      limit: 5,
    });

    if (current.values.length === 0) {
      return [];
    }

    // Wide limit so services that dropped out of the top 5 still resolve
    const previous = await reservoir.topValues({
      field: 'service',
      projectId: projectIds,
      level: [...ERROR_LEVELS],
      from: period.previousFrom,
      to: period.previousTo,
      limit: 100,
    });

    const previousByService = new Map(previous.values.map((v) => [v.value, v.count]));

    return current.values.map((v) => {
      const previousCount = previousByService.get(v.value) ?? 0;
      return {
        service: v.value,
        errorCount: v.count,
        previousCount,
        delta: v.count - previousCount,
      };
    });
  }

  /**
   * Error groups whose first occurrence falls inside the period.
   */
  private async calculateNewErrorGroups(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['newErrorGroups']> {
    const groups = await db
      .selectFrom('error_groups')
      .select(['exception_type', 'exception_message', 'occurrence_count', 'language'])
      .where('organization_id', '=', organizationId)
      .where('first_seen', '>=', period.from)
      .where('first_seen', '<', period.to)
      .orderBy('occurrence_count', 'desc')
      .limit(10)
      .execute();

    return groups.map((g) => ({
      exceptionType: g.exception_type,
      exceptionMessage: g.exception_message ?? '',
      occurrenceCount: g.occurrence_count,
      language: g.language,
    }));
  }

  /**
   * Security summary: windowed detection totals and top triggered Sigma rules
   * (raw detection_events, so the most recent hours are never stale like the
   * continuous aggregates), plus a point-in-time open incident count.
   */
  private async calculateSecuritySummary(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['security']> {
    const totalRow = await db
      .selectFrom('detection_events')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('organization_id', '=', organizationId)
      .where('time', '>=', period.from)
      .where('time', '<', period.to)
      .executeTakeFirst();

    const topRules = await db
      .selectFrom('detection_events')
      .select((eb) => ['rule_title', 'severity', eb.fn.countAll<number>().as('count')] as const)
      .where('organization_id', '=', organizationId)
      .where('time', '>=', period.from)
      .where('time', '<', period.to)
      .groupBy(['rule_title', 'severity'])
      .orderBy('count', 'desc')
      .limit(5)
      .execute();

    const openRow = await db
      .selectFrom('incidents')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('organization_id', '=', organizationId)
      .where('status', 'in', ['open', 'investigating'])
      .executeTakeFirst();

    return {
      totalDetections: Number(totalRow?.count ?? 0),
      topRules: topRules.map((r) => ({
        ruleTitle: r.rule_title,
        severity: r.severity,
        count: Number(r.count),
      })),
      openIncidents: Number(openRow?.count ?? 0),
    };
  }

  /**
   * Uptime summary from monitor_uptime_daily. Returns null when the org has
   * no enabled monitors so the email can skip the section entirely.
   * Daily buckets only partially overlap a sliding 24h window; that
   * approximation is acceptable for a digest.
   */
  private async calculateUptimeSummary(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['uptime']> {
    const monitors = await db
      .selectFrom('monitors')
      .select(['id', 'name'])
      .where('organization_id', '=', organizationId)
      .where('enabled', '=', true)
      .execute();

    if (monitors.length === 0) {
      return null;
    }

    const bucketFrom = new Date(period.from);
    bucketFrom.setUTCHours(0, 0, 0, 0);

    const rows = await db
      .selectFrom('monitor_uptime_daily')
      .select((eb) => [
        'monitor_id',
        eb.fn.sum<number>('successful_checks').as('successful'),
        eb.fn.sum<number>('total_checks').as('total'),
      ])
      .where('organization_id', '=', organizationId)
      .where('bucket', '>=', bucketFrom)
      .groupBy('monitor_id')
      .execute();

    const statsByMonitor = new Map(rows.map((r) => [r.monitor_id, r]));

    let overallSuccessful = 0;
    let overallTotal = 0;
    const perMonitor: Array<{ name: string; uptimePct: number }> = [];

    for (const monitor of monitors) {
      const stats = statsByMonitor.get(monitor.id);
      const successful = Number(stats?.successful ?? 0);
      const total = Number(stats?.total ?? 0);
      overallSuccessful += successful;
      overallTotal += total;

      if (total > 0) {
        perMonitor.push({
          name: monitor.name,
          uptimePct: Math.round((successful / total) * 10000) / 100,
        });
      }
    }

    const overallUptimePct =
      overallTotal > 0 ? Math.round((overallSuccessful / overallTotal) * 10000) / 100 : 100;

    perMonitor.sort((a, b) => a.uptimePct - b.uptimePct);

    return {
      monitorCount: monitors.length,
      overallUptimePct,
      worstMonitors: perMonitor.slice(0, 5),
    };
  }

  /**
   * Per-level counts for both windows plus the error rate, and for weekly
   * digests a per-day volume table. Engine-agnostic through reservoir.
   * Levels outside LOG_LEVELS cannot exist (the level column is constrained on
   * every engine), so the canonical five are the whole population here.
   */
  private async calculateLogBreakdown(
    projectIds: string[],
    period: Period,
    frequency: 'daily' | 'weekly'
  ): Promise<DigestReportData['logBreakdown']> {
    if (projectIds.length === 0) {
      return undefined;
    }

    const current = await reservoir.topValues({
      field: 'level',
      projectId: projectIds,
      from: period.from,
      to: period.to,
      toExclusive: true,
      limit: 10,
    });

    const previous = await reservoir.topValues({
      field: 'level',
      projectId: projectIds,
      from: period.previousFrom,
      to: period.previousTo,
      toExclusive: true,
      limit: 10,
    });

    const currentByLevel = new Map(current.values.map((v) => [v.value, v.count]));
    const previousByLevel = new Map(previous.values.map((v) => [v.value, v.count]));

    const levels = LOG_LEVELS.map((level) => ({
      level: level as string, // widened: the report shape is engine-agnostic
      current: currentByLevel.get(level) ?? 0,
      previous: previousByLevel.get(level) ?? 0,
    }));

    const currentTotal = levels.reduce((sum, l) => sum + l.current, 0);
    const previousTotal = levels.reduce((sum, l) => sum + l.previous, 0);

    if (currentTotal === 0 && previousTotal === 0) {
      return undefined;
    }

    const errorRatePct = this.errorRate(
      levels.reduce((sum, l) => sum + (this.isErrorLevel(l.level) ? l.current : 0), 0),
      currentTotal
    );
    const previousErrorRatePct = this.errorRate(
      levels.reduce((sum, l) => sum + (this.isErrorLevel(l.level) ? l.previous : 0), 0),
      previousTotal
    );

    if (frequency !== 'weekly') {
      return { levels, errorRatePct, previousErrorRatePct };
    }

    const aggregated = await reservoir.aggregate({
      projectId: projectIds,
      from: period.from,
      to: period.to,
      interval: '1d',
    });

    const daily = aggregated.timeseries.map((bucket) => ({
      date: new Date(bucket.bucket).toISOString().slice(0, 10),
      count: bucket.total,
    }));

    return {
      levels,
      errorRatePct,
      previousErrorRatePct,
      ...(daily.length > 0 ? { daily } : {}),
    };
  }

  private isErrorLevel(level: string): boolean {
    return (ERROR_LEVELS as readonly string[]).includes(level);
  }

  /** Share of error+critical logs, one decimal. */
  private errorRate(errorCount: number, total: number): number {
    if (total === 0) {
      return 0;
    }

    return Math.round((errorCount / total) * 1000) / 10;
  }

  /**
   * Top 5 error/critical log messages in the period.
   */
  private async calculateTopErrorMessages(
    projectIds: string[],
    period: Period
  ): Promise<DigestReportData['topErrorMessages']> {
    if (projectIds.length === 0) {
      return undefined;
    }

    const result = await reservoir.topValues({
      field: 'message',
      projectId: projectIds,
      level: [...ERROR_LEVELS],
      from: period.from,
      to: period.to,
      limit: 5,
    });

    if (result.values.length === 0) {
      return undefined;
    }

    return result.values.map((v) => ({ message: v.value, count: v.count }));
  }

  /**
   * Alert triggers in the period vs the previous one, plus the rules that
   * fired most. alert_history carries no organization_id, so tenant scoping
   * goes through the alert_rules join.
   */
  private async calculateAlertsSummary(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['alerts']> {
    const currentRow = await db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('alert_rules.organization_id', '=', organizationId)
      .where('alert_history.triggered_at', '>=', period.from)
      .where('alert_history.triggered_at', '<', period.to)
      .executeTakeFirst();

    const previousRow = await db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('alert_rules.organization_id', '=', organizationId)
      .where('alert_history.triggered_at', '>=', period.previousFrom)
      .where('alert_history.triggered_at', '<', period.previousTo)
      .executeTakeFirst();

    const total = Number(currentRow?.count ?? 0);
    const previousTotal = Number(previousRow?.count ?? 0);

    // Nothing fired in either window: skip the ranking query and the section
    if (total === 0 && previousTotal === 0) {
      return undefined;
    }

    const topRules = await db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select((eb) => ['alert_rules.name', eb.fn.countAll<number>().as('count')] as const)
      .where('alert_rules.organization_id', '=', organizationId)
      .where('alert_history.triggered_at', '>=', period.from)
      .where('alert_history.triggered_at', '<', period.to)
      .groupBy('alert_rules.name')
      .orderBy('count', 'desc')
      .limit(5)
      .execute();

    return {
      total,
      previousTotal,
      trend: this.calculateTrend(total, previousTotal),
      topRules: topRules.map((r) => ({ name: r.name, count: Number(r.count) })),
    };
  }

  /**
   * Span volume and error spans for both windows, the busiest services and the
   * slowest spans of the period. Engine-agnostic through reservoir.
   */
  private async calculateTracesSummary(
    projectIds: string[],
    period: Period,
    frequency: 'daily' | 'weekly'
  ): Promise<DigestReportData['traces']> {
    if (projectIds.length === 0) {
      return undefined;
    }

    // Hourly buckets over 24h, daily over 7d: either way the row count stays
    // bounded (24 or 7) and we only ever sum them.
    const bucket = frequency === 'weekly' ? 'day' : 'hour';

    const currentBuckets = await reservoir.getSpanTimeseries({
      projectIds,
      from: period.from,
      to: period.to,
      bucket,
    });

    const previousBuckets = await reservoir.getSpanTimeseries({
      projectIds,
      from: period.previousFrom,
      to: period.previousTo,
      bucket,
    });

    const spanCount = currentBuckets.reduce((sum, b) => sum + b.spanCount, 0);
    const previousSpanCount = previousBuckets.reduce((sum, b) => sum + b.spanCount, 0);

    // No traces in either window: skip the ranking queries and the section
    if (spanCount === 0 && previousSpanCount === 0) {
      return undefined;
    }

    const errorSpanCount = currentBuckets.reduce((sum, b) => sum + b.errorCount, 0);

    // getServiceHealthStats is single-project by design: query each project and
    // merge by service name.
    const byService = new Map<string, { calls: number; errors: number; p95Ms: number | null }>();

    for (const projectId of projectIds) {
      const stats = await reservoir.getServiceHealthStats(projectId, period.from, period.to);

      for (const stat of stats) {
        const entry = byService.get(stat.serviceName) ?? { calls: 0, errors: 0, p95Ms: null };
        entry.calls += stat.totalCalls;
        entry.errors += stat.totalErrors;
        // Worst-project p95, NOT a merged percentile: percentiles cannot be
        // combined from per-project values without the raw distribution, so the
        // digest reports the worst project's p95 for the service.
        if (
          stat.p95LatencyMs !== null &&
          (entry.p95Ms === null || stat.p95LatencyMs > entry.p95Ms)
        ) {
          entry.p95Ms = stat.p95LatencyMs;
        }
        byService.set(stat.serviceName, entry);
      }
    }

    const services = Array.from(byService.entries())
      .map(([service, entry]) => ({
        service,
        calls: entry.calls,
        errorRatePct: this.errorRate(entry.errors, entry.calls),
        p95Ms: entry.p95Ms,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5);

    const slowest = await reservoir.querySpans({
      projectId: projectIds,
      from: period.from,
      to: period.to,
      toExclusive: true,
      sortBy: 'duration_ms',
      sortOrder: 'desc',
      limit: 5,
    });

    return {
      spanCount,
      previousSpanCount,
      trend: this.calculateTrend(spanCount, previousSpanCount),
      errorSpanCount,
      services,
      slowestSpans: slowest.spans.map((s) => ({
        service: s.serviceName,
        operation: s.operationName,
        durationMs: s.durationMs,
      })),
    };
  }

  /**
   * Metric datapoints ingested in the period vs the previous one. Only the
   * result total is needed, so both queries ask for a single row.
   */
  private async calculateMetricsSummary(
    projectIds: string[],
    period: Period
  ): Promise<DigestReportData['metrics']> {
    if (projectIds.length === 0) {
      return undefined;
    }

    const current = await reservoir.queryMetrics({
      projectId: projectIds,
      from: period.from,
      to: period.to,
      toExclusive: true,
      limit: 1,
    });

    const previous = await reservoir.queryMetrics({
      projectId: projectIds,
      from: period.previousFrom,
      to: period.previousTo,
      toExclusive: true,
      limit: 1,
    });

    if (current.total === 0 && previous.total === 0) {
      return undefined;
    }

    return {
      datapoints: current.total,
      previousDatapoints: previous.total,
      trend: this.calculateTrend(current.total, previous.total),
    };
  }

  /**
   * Incident flow of the period: what was opened (by severity), what was
   * resolved, and which MITRE techniques the detections mapped to.
   */
  private async calculateSecurityActivity(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['securityActivity']> {
    const openedRows = await db
      .selectFrom('incidents')
      .select((eb) => ['severity', eb.fn.countAll<number>().as('count')] as const)
      .where('organization_id', '=', organizationId)
      .where('created_at', '>=', period.from)
      .where('created_at', '<', period.to)
      .groupBy('severity')
      .execute();

    const resolvedRow = await db
      .selectFrom('incidents')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('organization_id', '=', organizationId)
      .where('resolved_at', '>=', period.from)
      .where('resolved_at', '<', period.to)
      .executeTakeFirst();

    // Only mitre_techniques is unnested here. Unnesting mitre_techniques and
    // mitre_tactics in the same SELECT makes PostgreSQL evaluate them in
    // lockstep and NULL-pad the shorter array, which is bug #200.
    const techniqueRows = await db
      .selectFrom('detection_events')
      .select([
        sql<string>`unnest(mitre_techniques)`.as('technique'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('organization_id', '=', organizationId)
      .where('time', '>=', period.from)
      .where('time', '<', period.to)
      .where('mitre_techniques', 'is not', null)
      .groupBy('technique')
      .orderBy('count', 'desc')
      .limit(5)
      .execute();

    const openedBySeverity = openedRows
      .map((r) => ({ severity: String(r.severity), count: Number(r.count) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => this.severityRank(a.severity) - this.severityRank(b.severity));

    const topTechniques = techniqueRows
      .filter((r) => r.technique)
      .map((r) => ({ technique: r.technique, count: Number(r.count) }));

    const resolvedCount = Number(resolvedRow?.count ?? 0);
    const openedTotal = openedBySeverity.reduce((sum, r) => sum + r.count, 0);

    if (openedTotal === 0 && resolvedCount === 0 && topTechniques.length === 0) {
      return undefined;
    }

    return { openedBySeverity, resolvedCount, topTechniques };
  }

  /** Position in SEVERITY_ORDER; unknown severities sort last. */
  private severityRank(severity: string): number {
    const index = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
    return index === -1 ? SEVERITY_ORDER.length : index;
  }

  /**
   * Response time and failure count per monitor over the period, worst p95
   * first. GROUP BY only yields monitors that were actually checked in the
   * window, so idle monitors never reach the email.
   */
  private async calculateMonitorPerformance(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['monitorPerformance']> {
    const rows = await db
      .selectFrom('monitor_results')
      .innerJoin('monitors', 'monitors.id', 'monitor_results.monitor_id')
      .select([
        'monitors.name as name',
        sql<number | null>`avg(monitor_results.response_time_ms)`.as('avg_ms'),
        sql<number | null>`percentile_cont(0.95) within group (order by monitor_results.response_time_ms)`.as(
          'p95_ms'
        ),
        sql<number>`count(*) filter (where monitor_results.status = 'down')::int`.as(
          'failed_checks'
        ),
      ])
      .where('monitor_results.organization_id', '=', organizationId)
      .where('monitor_results.time', '>=', period.from)
      .where('monitor_results.time', '<', period.to)
      .groupBy(['monitor_results.monitor_id', 'monitors.name'])
      .execute();

    if (rows.length === 0) {
      return undefined;
    }

    // Sorted here rather than in SQL: heartbeat monitors record no
    // response_time_ms, so their percentile is NULL and PostgreSQL would sort
    // those rows first under ORDER BY ... DESC.
    return rows
      .map((r) => ({
        name: r.name,
        avgMs: Math.round(Number(r.avg_ms ?? 0)),
        p95Ms: Math.round(Number(r.p95_ms ?? 0)),
        failedChecks: Number(r.failed_checks ?? 0),
      }))
      .sort((a, b) => b.p95Ms - a.p95Ms)
      .slice(0, 5);
  }

  /**
   * Ingestion volume for the period plus capabilities close to their cap.
   * Quota usage is month-to-date by definition (that is the quota window), not
   * period-scoped: the email labels it as such.
   */
  private async calculateUsageSummary(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['usage']> {
    const breakdown = await getUsageBreakdown({
      organizationId,
      from: period.from,
      to: period.to,
      limit: 5,
    });

    const quantityByType = new Map(breakdown.byType.map((t) => [t.type, t.quantity]));
    const logEvents = Number(quantityByType.get('logs.ingested.events') ?? 0);
    const logBytes = Number(quantityByType.get('logs.ingested.bytes') ?? 0);
    const spans = Number(quantityByType.get('spans.ingested') ?? 0);

    // byProject already comes sorted by events desc
    const topProjects = breakdown.byProject
      .slice(0, 5)
      .map((p) => ({ name: p.projectName, events: p.events }));

    const capabilityUsage = await getCapabilityUsage(organizationId);

    const quotaWarnings = capabilityUsage
      .filter(
        (c): c is typeof c & { limit: number } =>
          c.limit !== null && c.limit > 0 && c.current / c.limit >= QUOTA_WARNING_THRESHOLD
      )
      .map((c) => ({
        capability: c.capability as string,
        usedPct: Math.round((c.current / c.limit) * 100),
      }));

    if (logEvents === 0 && spans === 0 && quotaWarnings.length === 0) {
      return undefined;
    }

    return { logEvents, logBytes, spans, topProjects, quotaWarnings };
  }

  /**
   * Outbound webhook deliveries created in the period, by outcome. `status` is
   * mutable row state (a pending row can still turn into delivered or dead
   * after the digest is sent), so windowing on created_at is the digest's
   * deliberate approximation. Pending rows are in-flight, not an outcome, and
   * are left out of both the report and the empty check.
   */
  private async calculateWebhookSummary(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['webhooks']> {
    const rows = await db
      .selectFrom('webhook_deliveries')
      .select((eb) => ['status', eb.fn.countAll<number>().as('count')] as const)
      .where('organization_id', '=', organizationId)
      .where('created_at', '>=', period.from)
      .where('created_at', '<', period.to)
      .groupBy('status')
      .execute();

    const countByStatus = new Map(rows.map((r) => [String(r.status), Number(r.count)]));
    const delivered = countByStatus.get('delivered') ?? 0;
    const failed = countByStatus.get('failed') ?? 0;
    const dead = countByStatus.get('dead') ?? 0;

    if (delivered + failed + dead === 0) {
      return undefined;
    }

    return { delivered, failed, dead };
  }

  /**
   * Membership and configuration churn from the audit log. One pass with
   * filtered counts: four separate COUNT queries would scan the same rows four
   * times.
   */
  private async calculateTeamActivity(
    organizationId: string,
    period: Period
  ): Promise<DigestReportData['teamActivity']> {
    const row = await db
      .selectFrom('audit_log')
      .select([
        sql<number>`count(*) filter (where action = 'user.invite_accepted')::int`.as(
          'members_added'
        ),
        sql<number>`count(*) filter (where action in ('user.removed', 'user.left'))::int`.as(
          'members_removed'
        ),
        sql<number>`count(*) filter (where category = 'config_change')::int`.as('config_changes'),
        sql<number>`count(*) filter (where action = 'auth.login_failed')::int`.as('failed_logins'),
      ])
      .where('organization_id', '=', organizationId)
      .where('time', '>=', period.from)
      .where('time', '<', period.to)
      .executeTakeFirst();

    const membersAdded = Number(row?.members_added ?? 0);
    const membersRemoved = Number(row?.members_removed ?? 0);
    const configChanges = Number(row?.config_changes ?? 0);
    const failedLogins = Number(row?.failed_logins ?? 0);

    if (membersAdded === 0 && membersRemoved === 0 && configChanges === 0 && failedLogins === 0) {
      return undefined;
    }

    return { membersAdded, membersRemoved, configChanges, failedLogins };
  }

  private async fetchRecipients(
    organizationId: string,
    digestConfigId: string
  ): Promise<DigestRecipient[]> {
    const recipients = await db
      .selectFrom('digest_recipients')
      .select(['email', 'unsubscribe_token'])
      .where('organization_id', '=', organizationId)
      .where('digest_config_id', '=', digestConfigId)
      .where('subscribed', '=', true)
      .execute();

    return recipients;
  }

  private calculateTrend(current: number, previous: number): string {
    if (previous === 0 && current === 0) {
      return 'no change';
    }

    if (previous === 0) {
      return `+${current} (new activity)`;
    }

    const delta = current - previous;
    const percentChange = ((delta / previous) * 100).toFixed(1);

    if (delta > 0) {
      return `+${delta} (+${percentChange}%)`;
    } else if (delta < 0) {
      return `${delta} (${percentChange}%)`;
    } else {
      return 'no change';
    }
  }

  private async sendDigestEmails(
    recipients: DigestRecipient[],
    report: DigestReportData
  ): Promise<void> {
    const transporter = getEmailTransporter();

    if (!transporter) {
      throw new Error('Email transporter not configured');
    }

    const subject = `[LogTide Digest] ${report.frequency === 'daily' ? 'Daily' : 'Weekly'} Report - ${report.organizationName}`;
    const frontendUrl = this.getFrontendUrl();

    const emailPromises = recipients.map(async (recipient) => {
      const { html, text } = generateDigestEmail({
        ...report,
        unsubscribeUrl: `${frontendUrl}/unsubscribe?token=${recipient.unsubscribe_token}`,
        dashboardUrl: `${frontendUrl}/dashboard`,
      });

      await transporter.sendMail({
        from: `"LogTide" <${config.SMTP_FROM || config.SMTP_USER}>`,
        to: recipient.email,
        subject,
        text,
        html,
      });

      hub.captureLog('info', `[DigestGenerator] Email sent to ${recipient.email}`);
    });

    // One recipient failing must not abort the rest. Send all, then report.
    const results = await Promise.allSettled(emailPromises);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      hub.captureLog(
        'error',
        `[DigestGenerator] ${failures.length}/${recipients.length} digest emails failed to send`
      );
    }
  }

  private getFrontendUrl(): string {
    return config.FRONTEND_URL || 'http://localhost:3000';
  }
}


export const digestGenerator = new DigestGeneratorService();
