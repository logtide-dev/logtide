import { describe, it, expect } from 'vitest';
import {
  generateAlertEmail,
  generateErrorEmail,
  generateIncidentEmail,
  generateSigmaDetectionEmail,
  generateMonitorEmail,
  generateProjectHealthEmail,
} from '../../lib/email-templates.js';

const XSS = '<img src=x onerror=alert(1)>';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function expectConsole(html: string) {
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain('@media (prefers-color-scheme: dark)');
  expect(html).not.toContain('—');
  expect(html).not.toContain('NaN');
}

const alert = {
  ruleName: 'Payment errors spike',
  logCount: 1284,
  threshold: 500,
  timeWindow: 5,
  service: 'payments-api',
  levels: ['error', 'critical'],
  organizationName: 'Northwind',
  projectName: 'Production',
};

describe('console notification emails', () => {
  it('threshold alert: pill, big number, meter, rule name once, sentence-case button', () => {
    const { html } = generateAlertEmail(alert);
    expectConsole(html);
    expect(html).toContain('Alert triggered');
    expect(html).toContain('1,284');
    expect(html).toContain('logs matched in the last 5 minutes');
    expect(html).toContain('threshold 500');
    expect(html).toContain('View alert history');
    expect(count(html, 'Payment errors spike')).toBe(2); // <title> and the heading
  });

  it.each([
    [500, 500],
    [10, 0],
  ])('threshold alert with logCount %i and threshold %i renders without a meter', (logCount, threshold) => {
    const { html } = generateAlertEmail({ ...alert, logCount, threshold });
    expectConsole(html);
    expect(html).not.toContain('class="lt-mark"');
  });

  it('rate-of-change alert shows the deviation', () => {
    const { html } = generateAlertEmail({
      ...alert,
      baselineMetadata: { baseline_value: 400, current_value: 1600, deviation_ratio: 4, baseline_type: 'rolling_7d_avg' },
    });
    expectConsole(html);
    expect(html).toContain('Anomaly');
    expect(html).toContain('4x');
    expect(html).toContain('7-day rolling average');
  });

  it('error: state pill and the message exactly once', () => {
    const { html } = generateErrorEmail({
      exceptionType: 'ConnectionTimeoutError',
      exceptionMessage: 'timeout to db-primary after 5000ms',
      language: 'nodejs',
      service: 'payments-api',
      isNewErrorGroup: true,
      errorGroupId: 'eg1',
      organizationName: 'Northwind',
      projectName: 'Production',
    });
    expectConsole(html);
    expect(html).toContain('New error');
    expect(html).toContain('View error details');
    expect(count(html, 'timeout to db-primary after 5000ms')).toBe(1);
  });

  it.each([
    [{ isRegression: true }, 'Regression'],
    [{ isEscalating: true }, 'Escalating'],
    [{}, '>Error<'],
  ])('error pill for %o reads %s', (flags, label) => {
    const { html } = generateErrorEmail({
      exceptionType: 'KeyError',
      language: 'python',
      service: 'billing',
      isNewErrorGroup: false,
      errorGroupId: 'eg2',
      organizationName: 'Northwind',
      projectName: 'Production',
      ...flags,
    });
    expect(html).toContain(label);
  });

  it('incident and sigma use the severity pill', () => {
    const incident = generateIncidentEmail({
      incidentId: 'i1',
      title: 'Brute force on auth-service',
      severity: 'high',
      organizationName: 'Northwind',
    }).html;
    expectConsole(incident);
    expect(incident).toContain('lt-fill-error');
    expect(incident).toContain('View incident');

    const sigma = generateSigmaDetectionEmail({
      ruleTitle: 'Suspicious sudo',
      severity: 'critical',
      service: 'bastion',
      organizationName: 'Northwind',
      detectionId: 'd1',
      matchedFields: { user: 'root' },
    }).html;
    expectConsole(sigma);
    expect(sigma).toContain('lt-fill-critical');
    expect(sigma).toContain('&quot;user&quot;');
  });

  it('monitor down and up', () => {
    const down = generateMonitorEmail({
      monitorId: 'm1',
      monitorName: 'checkout.northwind.example',
      status: 'down',
      severity: 'critical',
      organizationName: 'Northwind',
      errorCode: 'ETIMEDOUT',
    }).html;
    expectConsole(down);
    expect(down).toContain('lt-fill-error');
    expect(down).toContain('>Down<');
    expect(down).toContain('View monitor');

    const up = generateMonitorEmail({
      monitorId: 'm1',
      monitorName: 'checkout.northwind.example',
      status: 'up',
      severity: 'critical',
      organizationName: 'Northwind',
      downtimeDuration: '4m 12s',
    }).html;
    expect(up).toContain('lt-fill-success');
    expect(up).toContain('>Up<');
  });

  it('project health keeps its message', () => {
    const { html } = generateProjectHealthEmail({
      projectName: 'Production',
      organizationName: 'Northwind',
      kind: 'opened',
      severity: 'warning',
      title: 'No logs received',
      message: 'No logs arrived in the last 30 minutes.',
      openedAt: '2026-11-07 14:00 UTC',
      resolvedAt: null,
      link: 'https://app.example/dashboard/projects/p1',
    });
    expectConsole(html);
    expect(html).toContain('No logs arrived in the last 30 minutes.');
    expect(html).toContain('View project health');
  });

  it('escapes names everywhere', () => {
    const htmls = [
      generateAlertEmail({ ...alert, organizationName: XSS, ruleName: XSS, service: XSS }).html,
      generateErrorEmail({
        exceptionType: XSS,
        exceptionMessage: XSS,
        language: 'nodejs',
        service: XSS,
        isNewErrorGroup: true,
        errorGroupId: 'x',
        organizationName: XSS,
        projectName: XSS,
      }).html,
      generateIncidentEmail({ incidentId: 'i', title: XSS, description: XSS, severity: 'low', organizationName: XSS, affectedServices: [XSS] }).html,
      generateMonitorEmail({ monitorId: 'm', monitorName: XSS, status: 'down', severity: 'low', organizationName: XSS, target: XSS }).html,
    ];
    for (const html of htmls) {
      expect(html).not.toContain('<img src=x');
    }
  });
});
