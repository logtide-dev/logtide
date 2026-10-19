import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable config so individual tests can exercise the FRONTEND_URL fallbacks.
const mockConfig = vi.hoisted(() => ({
  FRONTEND_URL: 'https://app.logtide.dev/' as string | undefined,
  NODE_ENV: 'test',
}));

vi.mock('../../config/index.js', () => ({
  config: mockConfig,
}));

import {
  getFrontendUrl,
  generateAlertEmail,
  generateErrorEmail,
  generateIncidentEmail,
  generateSigmaDetectionEmail,
  generateMonitorEmail,
  generateDigestEmail,
  type DigestEmailData,
  type MonitorEmailData,
} from '../../lib/email-templates.js';

describe('Email Templates (branches) - getFrontendUrl fallbacks', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockConfig.FRONTEND_URL = 'https://app.logtide.dev/';
    mockConfig.NODE_ENV = 'test';
  });

  it('strips a single trailing slash from the configured URL', () => {
    expect(getFrontendUrl()).toBe('https://app.logtide.dev');
  });

  it('falls back to localhost without warning outside production', () => {
    mockConfig.FRONTEND_URL = undefined;
    mockConfig.NODE_ENV = 'development';

    expect(getFrontendUrl()).toBe('http://localhost:5173');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to localhost and warns in production', () => {
    mockConfig.FRONTEND_URL = '';
    mockConfig.NODE_ENV = 'production';

    expect(getFrontendUrl()).toBe('http://localhost:5173');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FRONTEND_URL not set in production'));
  });

  it('uses the fallback URL inside generated email links', () => {
    mockConfig.FRONTEND_URL = undefined;

    const result = generateAlertEmail({ ruleName: 'R', logCount: 1, threshold: 1, timeWindow: 1 });

    expect(result.text).toContain('http://localhost:5173/dashboard/alerts');
  });
});

describe('Email Templates (branches) - Alert Email', () => {
  it('lists service, organization and project in a rate-of-change email', () => {
    const result = generateAlertEmail({
      ruleName: 'Spike',
      logCount: 900,
      threshold: 10,
      timeWindow: 60,
      service: 'payments-api',
      organizationName: 'Acme Corp',
      projectName: 'Checkout',
      baselineMetadata: {
        baseline_value: 1234.4,
        current_value: 9876.6,
        deviation_ratio: 8,
        baseline_type: 'percentile_p95',
      },
    });

    expect(result.html).toContain('Service Filter');
    expect(result.html).toContain('payments-api');
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('Checkout');
    expect(result.html).toContain('95th percentile (7 days)');
    expect(result.html).toContain('9,877');
    expect(result.html).toContain('1,234');
    expect(result.text).toContain('Service: payments-api');
    expect(result.text).toContain('Organization: Acme Corp');
    expect(result.text).toContain('Project: Checkout');
    expect(result.text).toContain('Baseline (95th percentile (7 days)): 1,234 logs/hr');
  });

  it('falls back to the raw baseline type when no label is known', () => {
    const result = generateAlertEmail({
      ruleName: 'Spike',
      logCount: 10,
      threshold: 1,
      timeWindow: 5,
      baselineMetadata: {
        baseline_value: 10,
        current_value: 30,
        deviation_ratio: 3,
        baseline_type: 'custom_window',
      },
    });

    expect(result.html).toContain('custom_window');
    expect(result.text).toContain('Baseline (custom_window)');
    expect(result.text).not.toContain('Service:');
    expect(result.text).not.toContain('Organization:');
  });

  it('pluralizes the window and lists levels in a threshold email', () => {
    const result = generateAlertEmail({
      ruleName: 'Errors',
      logCount: 1500,
      threshold: 1000,
      timeWindow: 15,
      levels: ['error', 'critical'],
    });

    expect(result.html).toContain('15</strong> minutes');
    expect(result.html).toContain('Log Levels');
    expect(result.html).toContain('error, critical');
    expect(result.text).toContain('last 15 minutes');
    expect(result.text).toContain('Log Levels: error, critical');
  });

  it('uses the singular minute and omits empty levels', () => {
    const result = generateAlertEmail({
      ruleName: 'Errors',
      logCount: 2,
      threshold: 1,
      timeWindow: 1,
      levels: [],
    });

    expect(result.text).toContain('last 1 minute,');
    expect(result.text).not.toContain('Log Levels');
    expect(result.html).not.toContain('Log Levels');
  });
});

describe('Email Templates (branches) - label fallbacks', () => {
  it('error email falls back to the raw language name', () => {
    const result = generateErrorEmail({
      exceptionType: 'Panic',
      language: 'zig',
      service: 'core',
      isNewErrorGroup: false,
      errorGroupId: 'eg-1',
      organizationName: 'Acme',
      projectName: 'Main',
    });

    expect(result.html).toContain('zig');
    expect(result.html).toContain('Error: Panic');
  });

  it('incident email falls back to the raw severity and neutral color', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Odd thing',
      severity: 'unknown' as unknown as 'low',
      organizationName: 'Acme',
    });

    expect(result.html).toContain('unknown');
    expect(result.html).toContain('#6b7280');
  });

  it('sigma email falls back to the raw severity and neutral color', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Odd rule',
      severity: 'weird' as unknown as 'low',
      service: 'auth',
      organizationName: 'Acme',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('weird');
    expect(result.html).toContain('#6b7280');
  });
});

describe('Email Templates (branches) - Monitor Email', () => {
  const down: MonitorEmailData = {
    monitorId: 'mon-1',
    monitorName: 'API <Health>',
    status: 'down',
    severity: 'critical',
    organizationName: 'Acme Corp',
    target: 'https://api.example.com/health',
    errorCode: 'ECONNREFUSED',
    responseTimeMs: 0,
    consecutiveFailures: 3,
    downtimeDuration: '5m',
  };

  it('renders a down email with every detail row', () => {
    const result = generateMonitorEmail(down);

    expect(result.html).toContain('Monitor down: API &lt;Health&gt;');
    expect(result.html).toContain('is not responding.');
    expect(result.html).toContain('Error: <strong>ECONNREFUSED</strong>');
    expect(result.html).toContain('Critical');
    expect(result.html).toContain('#fef2f2');
    expect(result.html).toContain('https://api.example.com/health');
    expect(result.html).toContain('Response Time');
    expect(result.html).toContain('Consecutive Failures');
    expect(result.html).not.toContain('Downtime Duration');
    expect(result.html).toContain('https://app.logtide.dev/dashboard/monitoring');

    expect(result.text).toContain('MONITOR DOWN: API <Health>');
    expect(result.text).toContain('API <Health> is not responding.');
    expect(result.text).toContain('Target: https://api.example.com/health');
    expect(result.text).toContain('Error: ECONNREFUSED');
    // 0 is a real measurement and must still be printed.
    expect(result.text).toContain('Response Time: 0ms');
    expect(result.text).toContain('Consecutive Failures: 3');
    expect(result.text).not.toContain('Downtime Duration');
  });

  it('uses a warning box for non-critical down monitors and skips missing details', () => {
    const result = generateMonitorEmail({
      monitorId: 'mon-2',
      monitorName: 'Worker',
      status: 'down',
      severity: 'medium',
      organizationName: 'Acme Corp',
      responseTimeMs: null,
    });

    expect(result.html).toContain('#fefce8');
    expect(result.html).not.toContain('#fef2f2');
    expect(result.html).not.toContain('Error: <strong>');
    expect(result.html).toContain('Medium');
    expect(result.text).not.toContain('Target:');
    expect(result.text).not.toContain('Error:');
    expect(result.text).not.toContain('Response Time');
    expect(result.text).not.toContain('Consecutive Failures');
  });

  it('renders a recovery email with downtime and hides down-only rows', () => {
    const result = generateMonitorEmail({ ...down, status: 'up', responseTimeMs: 87 });

    expect(result.html).toContain('Monitor recovered: API &lt;Health&gt;');
    expect(result.html).toContain('is back online.');
    expect(result.html).toContain('Downtime: <strong>5m</strong>');
    expect(result.html).toContain('#f0fdf4');
    expect(result.html).toContain('Recovered');
    expect(result.html).not.toContain('Consecutive Failures');
    expect(result.html).toContain('Downtime Duration');

    expect(result.text).toContain('MONITOR RECOVERED: API <Health>');
    expect(result.text).toContain('API <Health> is back online.');
    expect(result.text).toContain('Response Time: 87ms');
    expect(result.text).toContain('Downtime Duration: 5m');
    expect(result.text).not.toContain('Error: ECONNREFUSED');
    expect(result.text).not.toContain('Consecutive Failures');
  });

  it('renders a recovery email without downtime and with an unknown severity', () => {
    const result = generateMonitorEmail({
      monitorId: 'mon-3',
      monitorName: 'Cron',
      status: 'up',
      severity: 'odd' as unknown as 'low',
      organizationName: 'Acme Corp',
    });

    expect(result.html).toContain('Cron</strong> is back online.');
    expect(result.html).not.toContain('Downtime:');
    expect(result.html).toContain('odd');
    expect(result.text).not.toContain('Downtime Duration');
  });
});

describe('Email Templates (branches) - Digest edge cases', () => {
  const minimal: DigestEmailData = {
    organizationName: 'Acme Corp',
    frequency: 'daily',
    periodLabel: 'last 24 hours',
    unsubscribeUrl: 'https://app.logtide.dev/unsubscribe?token=t',
    dashboardUrl: 'https://app.logtide.dev/dashboard',
  } as DigestEmailData;

  it('renders sections whose optional lists are empty without their tables', () => {
    const result = generateDigestEmail({
      ...minimal,
      logVolume: { current: 10, previous: 5, trend: '+5' },
      newErrorGroups: [
        { exceptionType: 'RangeError', exceptionMessage: null, occurrenceCount: 1, language: 'go' },
      ],
      logBreakdown: {
        levels: [{ level: 'info', current: 10, previous: 5 }],
        errorRatePct: 0,
        previousErrorRatePct: 0,
      },
      traces: {
        spanCount: 3,
        previousSpanCount: 0,
        trend: '+3',
        errorSpanCount: 0,
        services: [],
        slowestSpans: [],
      },
      alerts: { total: 0, previousTotal: 1, trend: '-1', topRules: [] },
      securityActivity: { openedBySeverity: [], resolvedCount: 2, topTechniques: [] },
      usage: { logEvents: 10, logBytes: 512, spans: 3, topProjects: [], quotaWarnings: [] },
      webhooks: { delivered: 4, failed: 0, dead: 0 },
    } as DigestEmailData);

    // Error group without a message renders just the type.
    expect(result.html).toContain('>RangeError</td>');
    expect(result.text).toContain('RangeError (go, 1 occurrences)');

    // Breakdown without daily rows has no per-day table.
    expect(result.html).not.toContain('>Day</th>');
    expect(result.text).not.toContain('Per day:');

    // Traces without services or slow spans keep only the totals.
    expect(result.html).not.toContain('Top services by calls');
    expect(result.html).not.toContain('Slowest spans in the period.');
    expect(result.text).not.toContain('Slowest spans:');

    // Alerts with no top rules render no ranking table.
    expect(result.html).not.toContain('>Triggers</th>');

    // Security activity without severities or techniques.
    expect(result.html).toContain('Incidents Opened');
    expect(result.html).not.toContain('MITRE Technique');
    expect(result.text).toContain('Incidents opened: 0');
    expect(result.text).not.toContain('Opened by severity:');
    expect(result.text).not.toContain('Top MITRE techniques:');

    // Usage under 1 KB prints whole bytes; no projects or quota warnings.
    expect(result.html).toContain('512 B');
    expect(result.text).toContain('Log volume: 512 B');
    expect(result.html).not.toContain('Month-to-date usage');
    expect(result.text).not.toContain('Top projects:');
    expect(result.text).not.toContain('Month-to-date');

    // No dead letters, no warning.
    expect(result.html).not.toContain('dead-letter queue');
    expect(result.text).not.toContain('Dead-lettered deliveries');

    // Preheader counts the sections present, incidents included.
    expect(result.html).toContain('10 logs, 0 alerts, 0 incidents for Acme Corp');
  });

  it('uses the singular "delivery" for exactly one dead letter', () => {
    const result = generateDigestEmail({
      ...minimal,
      webhooks: { delivered: 0, failed: 1, dead: 1 },
    } as DigestEmailData);

    expect(result.html).toContain('<strong>1</strong> delivery reached the dead-letter queue');
    expect(result.text).toContain('Dead-lettered deliveries need attention.');
  });

  it('renders uptime totals without a table when no monitor is below par', () => {
    const result = generateDigestEmail({
      ...minimal,
      uptime: { monitorCount: 2, overallUptimePct: 100, worstMonitors: [] },
    } as DigestEmailData);

    expect(result.html).toContain('Uptime');
    expect(result.html).toContain('100%');
    expect(result.html).not.toContain('>Monitor</th>');
    expect(result.text).toContain('Overall: 100% across 2 monitor(s)');
  });

  it('falls back to a generic preheader when no counted section is present', () => {
    const result = generateDigestEmail({
      ...minimal,
      teamActivity: { membersAdded: 0, membersRemoved: 0, configChanges: 1, failedLogins: 0 },
    } as DigestEmailData);

    expect(result.html).toContain('Digest for Acme Corp');
    expect(result.html).not.toContain('Log Volume');
    expect(result.text).toContain('Config changes: 1');
  });

  it('is not quiet when traces arrived during a log-free period', () => {
    const result = generateDigestEmail({
      ...minimal,
      logVolume: { current: 0, previous: 0, trend: 'no change' },
      traces: {
        spanCount: 5,
        previousSpanCount: 0,
        trend: '+5',
        errorSpanCount: 0,
        services: [],
        slowestSpans: [],
      },
    } as DigestEmailData);

    expect(result.html).not.toContain('No activity during this period');
    expect(result.text).toContain('Total logs: 0');
  });
});
