import { describe, it, expect } from 'vitest';
import { generateDigestEmail, type DigestEmailData } from '../../lib/email-templates.js';

const long = (prefix: string, n = 120) => `${prefix} ${'x'.repeat(n)}`;
const times = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

/** Every section enabled, every list at the generator's cap (10 or 5 rows), long values. */
const maximal: DigestEmailData = {
  organizationName: 'Northwind Logistics International',
  frequency: 'weekly',
  periodLabel: 'last 7 days',
  logVolume: { current: 98765432, previous: 87654321, trend: '+11111111 (+12.7%)' },
  topErrorServices: times(10, (i) => ({ service: long(`service-${i}`, 40), errorCount: 123456, previousCount: 23456, delta: 100000 })),
  newErrorGroups: times(10, (i) => ({
    exceptionType: long(`ExceptionType${i}`, 40),
    exceptionMessage: long('message', 200),
    occurrenceCount: 98765,
    language: 'nodejs',
  })),
  security: {
    totalDetections: 4567,
    topRules: times(5, (i) => ({ ruleTitle: long(`Rule ${i}`, 60), severity: 'high', count: 321 })),
    openIncidents: 12,
  },
  uptime: { monitorCount: 50, overallUptimePct: 99.95, worstMonitors: times(5, (i) => ({ name: long(`monitor-${i}`, 40), uptimePct: 97.5 })) },
  logBreakdown: {
    levels: ['debug', 'info', 'warn', 'error', 'critical'].map((level) => ({ level, current: 1234567, previous: 1034567 })),
    errorRatePct: 3.3,
    previousErrorRatePct: 2.1,
    daily: times(7, (i) => ({ date: `2026-11-0${i + 1}`, count: 14000000 })),
  },
  topErrorMessages: times(10, (i) => ({ message: long(`error message ${i}`, 200), count: 9876 })),
  alerts: { total: 120, previousTotal: 80, trend: '+40 (+50.0%)', topRules: times(5, (i) => ({ name: long(`alert rule ${i}`, 60), count: 40 })) },
  traces: {
    spanCount: 40000000,
    previousSpanCount: 30000000,
    trend: '+10000000 (+33.3%)',
    errorSpanCount: 250000,
    services: times(10, (i) => ({ service: long(`svc-${i}`, 40), calls: 1200000, errorRatePct: 3.2, p95Ms: 450 })),
    slowestSpans: times(5, (i) => ({ service: long(`svc-${i}`, 40), operation: long('GET /api/v1/orders', 60), durationMs: 5200 })),
  },
  metrics: { datapoints: 880000000, previousDatapoints: 800000000, trend: '+80000000 (+10.0%)' },
  securityActivity: {
    openedBySeverity: ['critical', 'high', 'medium', 'low', 'informational'].map((severity) => ({ severity, count: 20 })),
    resolvedCount: 55,
    topTechniques: times(5, (i) => ({ technique: long(`T11${i}0`, 40), count: 9 })),
  },
  monitorPerformance: times(5, (i) => ({ name: long(`monitor-${i}`, 40), avgMs: 120, p95Ms: 450, failedChecks: 3 })),
  usage: {
    logEvents: 1500000000,
    logBytes: 1610612736000,
    spans: 40000000,
    topProjects: times(5, (i) => ({ name: long(`project-${i}`, 40), events: 900000000 })),
    quotaWarnings: times(3, (i) => ({ capability: `capability.${i}`, usedPct: 92 })),
  },
  webhooks: { delivered: 50000, failed: 120, dead: 3 },
  teamActivity: { membersAdded: 2, membersRemoved: 1, configChanges: 7, failedLogins: 4 },
  unsubscribeUrl: 'https://app.northwind.example/unsubscribe?token=tok_123',
  dashboardUrl: 'https://app.northwind.example/dashboard',
};

describe('console digest email', () => {
  it('stays under the Gmail clipping limit with every section full', () => {
    const { html } = generateDigestEmail(maximal);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(102 * 1024);
  });

  it('uses the console layout, sentence-case titles and the unsubscribe footer', () => {
    const { html } = generateDigestEmail(maximal);
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('Weekly digest');
    expect(html).toContain('Top services by errors');
    expect(html).toContain('98,765,432');
    expect(html).toContain('View dashboard');
    expect(html).toContain('https://app.northwind.example/unsubscribe?token=tok_123');
    expect(html).not.toContain('/dashboard/settings/notifications/destinations');
    expect(html).not.toContain('—');
  });

  it('shows the quiet notice when nothing arrived', () => {
    const { html } = generateDigestEmail({
      ...maximal,
      logVolume: { current: 0, previous: 0, trend: '0' },
      traces: undefined,
    });
    expect(html).toContain('No activity during this period. Your systems have been quiet.');
  });

  it('leaves no title for disabled sections', () => {
    const { html } = generateDigestEmail({ ...maximal, webhooks: undefined, teamActivity: undefined });
    expect(html).not.toContain('>Webhooks<');
    expect(html).not.toContain('>Team activity<');
  });
});
