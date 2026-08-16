import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing the module
vi.mock('../../config/index.js', () => ({
  config: {
    FRONTEND_URL: 'https://app.logtide.dev',
    NODE_ENV: 'test',
  },
}));

import {
  getFrontendUrl,
  formatEmailDate,
  escapeHtml,
  truncate,
  generateAlertEmail,
  generateErrorEmail,
  generateIncidentEmail,
  generateSigmaDetectionEmail,
  generateInvitationEmail,
  generateDigestEmail,
  type DigestEmailData,
} from '../../lib/email-templates.js';

describe('Email Templates - Helpers', () => {
  describe('getFrontendUrl', () => {
    it('should return configured FRONTEND_URL', () => {
      const url = getFrontendUrl();
      expect(url).toBe('https://app.logtide.dev');
    });

    it('should remove trailing slash from URL', () => {
      // The function removes trailing slashes internally
      const url = getFrontendUrl();
      expect(url.endsWith('/')).toBe(false);
    });
  });

  describe('formatEmailDate', () => {
    it('should format date correctly', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const formatted = formatEmailDate(date);

      // Should contain date parts
      expect(formatted).toContain('2024');
      expect(formatted).toContain('Jan');
      expect(formatted).toContain('15');
    });

    it('should use current date when no date provided', () => {
      const formatted = formatEmailDate();
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(escapeHtml("it's")).toBe('it&#039;s');
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle strings without special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('truncate', () => {
    it('should truncate long strings', () => {
      const longText = 'A'.repeat(100);
      const truncated = truncate(longText, 50);
      expect(truncated).toBe('A'.repeat(47) + '...');
      expect(truncated.length).toBe(50);
    });

    it('should not modify short strings', () => {
      const shortText = 'Hello';
      expect(truncate(shortText, 50)).toBe('Hello');
    });

    it('should handle exact length strings', () => {
      const text = 'A'.repeat(50);
      expect(truncate(text, 50)).toBe(text);
    });
  });
});

describe('Email Templates - Alert Email', () => {
  it('should generate HTML and text versions', () => {
    const result = generateAlertEmail({
      ruleName: 'High Error Rate',
      logCount: 150,
      threshold: 100,
      timeWindow: 5,
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should include rule name in both versions', () => {
    const result = generateAlertEmail({
      ruleName: 'Test Alert Rule',
      logCount: 50,
      threshold: 25,
      timeWindow: 10,
    });

    expect(result.html).toContain('Test Alert Rule');
    expect(result.text).toContain('Test Alert Rule');
  });

  it('should include log count and threshold', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 200,
      threshold: 100,
      timeWindow: 5,
    });

    expect(result.html).toContain('200');
    expect(result.html).toContain('100');
    expect(result.text).toContain('200');
    expect(result.text).toContain('100');
  });

  it('should include logo URL', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 50,
      threshold: 25,
      timeWindow: 5,
    });

    expect(result.html).toContain('https://logtide.dev/logo/dark.png');
  });

  it('should include correct dashboard link', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 50,
      threshold: 25,
      timeWindow: 5,
    });

    expect(result.html).toContain('https://app.logtide.dev/dashboard/alerts');
    expect(result.text).toContain('https://app.logtide.dev/dashboard/alerts');
  });

  it('should include organization and project when provided', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 50,
      threshold: 25,
      timeWindow: 5,
      organizationName: 'Acme Corp',
      projectName: 'Backend API',
    });

    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('Backend API');
    expect(result.text).toContain('Acme Corp');
    expect(result.text).toContain('Backend API');
  });

  it('should include service filter when provided', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 50,
      threshold: 25,
      timeWindow: 5,
      service: 'api-gateway',
    });

    expect(result.html).toContain('api-gateway');
  });

  it('should include preheader text', () => {
    const result = generateAlertEmail({
      ruleName: 'My Rule',
      logCount: 50,
      threshold: 25,
      timeWindow: 5,
    });

    // Preheader is in a hidden div
    expect(result.html).toContain('50 logs exceeded threshold of 25');
  });
});

describe('Email Templates - Error Email', () => {
  it('should generate HTML and text versions', () => {
    const result = generateErrorEmail({
      exceptionType: 'TypeError',
      exceptionMessage: 'Cannot read property x of undefined',
      language: 'nodejs',
      service: 'api-service',
      isNewErrorGroup: true,
      errorGroupId: 'error-123',
      organizationName: 'Test Org',
      projectName: 'Test Project',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it('should include exception type', () => {
    const result = generateErrorEmail({
      exceptionType: 'NullPointerException',
      language: 'java',
      service: 'backend',
      isNewErrorGroup: true,
      errorGroupId: 'error-456',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('NullPointerException');
    expect(result.text).toContain('NullPointerException');
  });

  it('should show "New Error" for new error groups', () => {
    const result = generateErrorEmail({
      exceptionType: 'Error',
      language: 'nodejs',
      service: 'worker',
      isNewErrorGroup: true,
      errorGroupId: 'error-789',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('New Error');
    expect(result.text).toContain('NEW');
  });

  it('should include language label', () => {
    const result = generateErrorEmail({
      exceptionType: 'Exception',
      language: 'python',
      service: 'ml-service',
      isNewErrorGroup: false,
      errorGroupId: 'error-abc',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('Python');
  });

  it('should include error details link', () => {
    const result = generateErrorEmail({
      exceptionType: 'Error',
      language: 'nodejs',
      service: 'api',
      isNewErrorGroup: true,
      errorGroupId: 'my-error-id',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('https://app.logtide.dev/dashboard/errors/my-error-id');
    expect(result.text).toContain('https://app.logtide.dev/dashboard/errors/my-error-id');
  });

  it('should include logo', () => {
    const result = generateErrorEmail({
      exceptionType: 'Error',
      language: 'nodejs',
      service: 'api',
      isNewErrorGroup: true,
      errorGroupId: 'err-1',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('https://logtide.dev/logo/dark.png');
  });

  it('should handle null exception message', () => {
    const result = generateErrorEmail({
      exceptionType: 'Error',
      exceptionMessage: null,
      language: 'nodejs',
      service: 'api',
      isNewErrorGroup: true,
      errorGroupId: 'err-1',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });
});

describe('Email Templates - Incident Email', () => {
  it('should generate HTML and text versions', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-123',
      title: 'Security Breach Detected',
      description: 'Unauthorized access attempt',
      severity: 'critical',
      organizationName: 'Test Org',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it('should include incident title', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'SQL Injection Attempt',
      severity: 'high',
      organizationName: 'Org',
    });

    expect(result.html).toContain('SQL Injection Attempt');
    expect(result.text).toContain('SQL Injection Attempt');
  });

  it('should show correct severity badge', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      severity: 'critical',
      organizationName: 'Org',
    });

    expect(result.html).toContain('Critical');
    expect(result.text).toContain('CRITICAL');
  });

  it('should include incident link', () => {
    const result = generateIncidentEmail({
      incidentId: 'my-incident-id',
      title: 'Test',
      severity: 'medium',
      organizationName: 'Org',
    });

    expect(result.html).toContain('https://app.logtide.dev/dashboard/security/incidents/my-incident-id');
    expect(result.text).toContain('https://app.logtide.dev/dashboard/security/incidents/my-incident-id');
  });

  it('should include affected services when provided', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      severity: 'high',
      organizationName: 'Org',
      affectedServices: ['api', 'database', 'cache'],
    });

    expect(result.html).toContain('api');
    expect(result.html).toContain('database');
    expect(result.html).toContain('cache');
  });

  it('should show urgent message for critical severity', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      severity: 'critical',
      organizationName: 'Org',
    });

    expect(result.html).toContain('immediate attention');
  });

  it('should include logo', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      severity: 'low',
      organizationName: 'Org',
    });

    expect(result.html).toContain('https://logtide.dev/logo/dark.png');
  });

  it('should handle null description', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      description: null,
      severity: 'informational',
      organizationName: 'Org',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });
});

describe('Email Templates - Sigma Detection Email', () => {
  it('should generate HTML and text versions', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Suspicious PowerShell Execution',
      ruleDescription: 'Detects suspicious PowerShell commands',
      severity: 'high',
      service: 'windows-agent',
      organizationName: 'Test Org',
      detectionId: 'det-123',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it('should include rule title', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Mimikatz Detection',
      severity: 'critical',
      service: 'endpoint',
      organizationName: 'Org',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('Mimikatz Detection');
    expect(result.text).toContain('Mimikatz Detection');
  });

  it('should show severity badge', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Test Rule',
      severity: 'high',
      service: 'api',
      organizationName: 'Org',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('High');
  });

  it('should include matched fields when provided', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Test Rule',
      severity: 'medium',
      service: 'api',
      organizationName: 'Org',
      detectionId: 'det-1',
      matchedFields: {
        'CommandLine': 'mimikatz.exe',
        'User': 'SYSTEM',
      },
    });

    expect(result.html).toContain('mimikatz.exe');
    expect(result.html).toContain('SYSTEM');
  });

  it('should include security dashboard link', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Test',
      severity: 'low',
      service: 'api',
      organizationName: 'Org',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('https://app.logtide.dev/dashboard/security');
    expect(result.text).toContain('https://app.logtide.dev/dashboard/security');
  });

  it('should include logo', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Test',
      severity: 'informational',
      service: 'api',
      organizationName: 'Org',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('https://logtide.dev/logo/dark.png');
  });

  it('should show malicious activity warning for critical/high', () => {
    const result = generateSigmaDetectionEmail({
      ruleTitle: 'Test',
      severity: 'critical',
      service: 'api',
      organizationName: 'Org',
      detectionId: 'det-1',
    });

    expect(result.html).toContain('malicious activity');
  });
});

describe('Email Templates - Invitation Email', () => {
  it('should generate HTML and text versions', () => {
    const result = generateInvitationEmail({
      email: 'new@example.com',
      token: 'invite-token-123',
      organizationName: 'Acme Corp',
      inviterName: 'John Doe',
      role: 'member',
    });

    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should include organization name', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Mega Corp',
      inviterName: 'Jane',
      role: 'admin',
    });

    expect(result.html).toContain('Mega Corp');
    expect(result.text).toContain('Mega Corp');
  });

  it('should include inviter name', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Alice Smith',
      role: 'member',
    });

    expect(result.html).toContain('Alice Smith');
    expect(result.text).toContain('Alice Smith');
  });

  it('should include correct invite URL with token', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'my-special-token',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('https://app.logtide.dev/invite/my-special-token');
    expect(result.text).toContain('https://app.logtide.dev/invite/my-special-token');
  });

  it('should display correct role label for member', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('Member');
    expect(result.text).toContain('Member');
  });

  it('should display correct role label for admin', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'admin',
    });

    expect(result.html).toContain('Admin');
    expect(result.text).toContain('Admin');
  });

  it('should display correct role label for owner', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'owner',
    });

    expect(result.html).toContain('Owner');
    expect(result.text).toContain('Owner');
  });

  it('should include email address', () => {
    const result = generateInvitationEmail({
      email: 'specific@example.org',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('specific@example.org');
    expect(result.text).toContain('specific@example.org');
  });

  it('should include expiration notice', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('7 days');
    expect(result.text).toContain('7 days');
  });

  it('should include logo', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('https://logtide.dev/logo/dark.png');
  });

  it('should have proper HTML structure', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'member',
    });

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('</html>');
  });

  it('should include preheader text', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Cool Org',
      inviterName: 'Charlie',
      role: 'member',
    });

    expect(result.html).toContain('Charlie invited you to join Cool Org');
  });

  it('should handle unknown role gracefully', () => {
    const result = generateInvitationEmail({
      email: 'user@test.com',
      token: 'abc',
      organizationName: 'Org',
      inviterName: 'Bob',
      role: 'custom_role',
    });

    // Should use the raw role as fallback
    expect(result.html).toContain('custom_role');
  });
});

describe('Email Templates - Baseline Alert Email', () => {
  it('should generate rate-of-change email with baseline metadata', () => {
    const result = generateAlertEmail({
      ruleName: 'Volume Spike',
      logCount: 500,
      threshold: 100,
      timeWindow: 60,
      baselineMetadata: {
        baseline_value: 100,
        current_value: 500,
        deviation_ratio: 5,
        baseline_type: 'same_time_yesterday',
      },
    });

    expect(result.html).toContain('Volume Spike');
    expect(result.html).toContain('5x');
    expect(result.html).toContain('above normal');
    expect(result.text).toContain('5x');
    expect(result.text).toContain('ANOMALY');
  });

  it('should display correct baseline type labels', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 100,
      threshold: 10,
      timeWindow: 5,
      baselineMetadata: {
        baseline_value: 50,
        current_value: 200,
        deviation_ratio: 4,
        baseline_type: 'rolling_7d_avg',
      },
    });

    expect(result.html).toContain('7-day rolling average');
    expect(result.text).toContain('7-day rolling average');
  });
});

describe('Email Templates - Common Elements', () => {
  it('should include notification settings link in footer', () => {
    const result = generateAlertEmail({
      ruleName: 'Test',
      logCount: 10,
      threshold: 5,
      timeWindow: 1,
    });

    expect(result.html).toContain('/dashboard/settings/channels');
    expect(result.text).toContain('/dashboard/settings/channels');
  });

  it('should include LogTide branding', () => {
    const result = generateIncidentEmail({
      incidentId: 'inc-1',
      title: 'Test',
      severity: 'low',
      organizationName: 'Org',
    });

    expect(result.html).toContain('LogTide');
    expect(result.text).toContain('LogTide');
  });

  it('should have proper HTML structure', () => {
    const result = generateErrorEmail({
      exceptionType: 'Error',
      language: 'nodejs',
      service: 'api',
      isNewErrorGroup: true,
      errorGroupId: 'err-1',
      organizationName: 'Org',
      projectName: 'Project',
    });

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('</html>');
    expect(result.html).toContain('<body');
    expect(result.html).toContain('</body>');
  });
});

describe('Email Templates - Digest', () => {
  const baseData: DigestEmailData = {
    organizationName: 'Acme Corp',
    frequency: 'daily',
    periodLabel: 'last 24 hours',
    logVolume: { current: 15000, previous: 12000, trend: '+3000 (+25.0%)' },
    topErrorServices: [
      { service: 'api-<gateway>', errorCount: 50, previousCount: 20, delta: 30 },
      { service: 'web', errorCount: 10, previousCount: 15, delta: -5 },
    ],
    newErrorGroups: [
      {
        exceptionType: 'TypeError',
        exceptionMessage: 'Cannot read properties of <undefined>',
        occurrenceCount: 42,
        language: 'nodejs',
      },
    ],
    security: {
      totalDetections: 11,
      topRules: [{ ruleTitle: 'Suspicious <Login>', severity: 'high', count: 7 }],
      openIncidents: 2,
    },
    uptime: {
      monitorCount: 3,
      overallUptimePct: 99.5,
      worstMonitors: [{ name: 'API Health', uptimePct: 98.5 }],
    },
    unsubscribeUrl: 'https://app.logtide.dev/unsubscribe?token=tok_123',
    dashboardUrl: 'https://app.logtide.dev/dashboard',
  };

  it('renders every section in the HTML body', () => {
    const result = generateDigestEmail(baseData);

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('Acme Corp');
    expect(result.html).toContain('15,000');
    expect(result.html).toContain('+3000 (+25.0%)');
    expect(result.html).toContain('TypeError');
    expect(result.html).toContain('42');
    expect(result.html).toContain('Suspicious');
    expect(result.html).toContain('99.5');
    expect(result.html).toContain('98.5');
    expect(result.html).toContain('last 24 hours');
  });

  it('escapes user-controlled values in HTML', () => {
    const result = generateDigestEmail(baseData);

    expect(result.html).not.toContain('api-<gateway>');
    expect(result.html).toContain('api-&lt;gateway&gt;');
    expect(result.html).not.toContain('Suspicious <Login>');
    expect(result.html).toContain('Suspicious &lt;Login&gt;');
    expect(result.html).not.toContain('Cannot read properties of <undefined>');
  });

  it('uses the unsubscribe link in the footer instead of channel settings', () => {
    const result = generateDigestEmail(baseData);

    expect(result.html).toContain('https://app.logtide.dev/unsubscribe?token=tok_123');
    expect(result.html).toContain('Unsubscribe');
    expect(result.html).not.toContain('/dashboard/settings/channels');
  });

  it('carries all sections in the plaintext fallback', () => {
    const result = generateDigestEmail(baseData);

    expect(result.text).toContain('Acme Corp');
    expect(result.text).toContain('Total logs: 15,000');
    expect(result.text).toContain('Trend: +3000 (+25.0%)');
    expect(result.text).toContain('Previous period: 12,000');
    expect(result.text).toContain('api-<gateway>');
    expect(result.text).toContain('TypeError');
    expect(result.text).toContain('Suspicious <Login>');
    expect(result.text).toContain('Open incidents: 2');
    expect(result.text).toContain('99.5');
    expect(result.text).toContain('https://app.logtide.dev/unsubscribe?token=tok_123');
  });

  it('shows the quiet-period message when there was no log activity', () => {
    const quiet: DigestEmailData = {
      ...baseData,
      logVolume: { current: 0, previous: 0, trend: 'no change' },
      topErrorServices: [],
      newErrorGroups: [],
      security: { totalDetections: 0, topRules: [], openIncidents: 0 },
      uptime: null,
    };

    const result = generateDigestEmail(quiet);

    expect(result.html).toContain('No activity during this period');
    expect(result.text).toContain('No activity during this period');
    expect(result.text).toContain('quiet');
  });

  it('omits the uptime section when uptime is null', () => {
    const noUptime: DigestEmailData = { ...baseData, uptime: null };

    const result = generateDigestEmail(noUptime);

    expect(result.html).not.toContain('Uptime');
    expect(result.text).not.toContain('Uptime');
  });

  it('labels weekly digests as weekly', () => {
    const weekly: DigestEmailData = { ...baseData, frequency: 'weekly', periodLabel: 'last 7 days' };

    const result = generateDigestEmail(weekly);

    expect(result.html).toContain('Weekly Digest');
    expect(result.text).toContain('Weekly Digest');
    expect(result.text).toContain('last 7 days');
  });

  it('keeps the preheader unchanged when no expanded section is present', () => {
    const result = generateDigestEmail(baseData);

    expect(result.html).toContain('15,000 logs, 11 detections for Acme Corp');
  });

  // ==========================================================================
  // Expanded digest sections (#154 expansion)
  // ==========================================================================

  const longMessage = 'x'.repeat(200);

  const fullData: DigestEmailData = {
    ...baseData,
    frequency: 'weekly',
    periodLabel: 'last 7 days',
    logBreakdown: {
      levels: [
        { level: 'info', current: 9000, previous: 7000 },
        { level: 'error', current: 500, previous: 300 },
      ],
      errorRatePct: 3.3,
      previousErrorRatePct: 2,
      daily: [{ date: '2026-08-10', count: 1200 }],
    },
    topErrorMessages: [
      { message: '<script>alert(1)</script> connection refused', count: 120 },
      { message: longMessage, count: 9 },
    ],
    alerts: {
      total: 12,
      previousTotal: 4,
      trend: '+8 (+200.0%)',
      topRules: [{ name: 'High <error> rate', count: 7 }],
    },
    traces: {
      spanCount: 40000,
      previousSpanCount: 30000,
      trend: '+10000 (+33.3%)',
      errorSpanCount: 250,
      services: [
        { service: 'checkout-<svc>', calls: 1200, errorRatePct: 3, p95Ms: 450 },
        { service: 'billing', calls: 300, errorRatePct: 0, p95Ms: null },
      ],
      slowestSpans: [{ service: 'checkout-<svc>', operation: 'GET /<pay>', durationMs: 5200 }],
    },
    metrics: { datapoints: 88000, previousDatapoints: 80000, trend: '+8000 (+10.0%)' },
    securityActivity: {
      openedBySeverity: [
        { severity: 'critical', count: 2 },
        { severity: 'low', count: 1 },
      ],
      resolvedCount: 5,
      topTechniques: [{ technique: 'T1110<script>', count: 9 }],
    },
    monitorPerformance: [
      { name: 'API <Health>', avgMs: 120, p95Ms: 450, failedChecks: 3 },
      { name: 'Heartbeat <hb>', avgMs: 0, p95Ms: 0, failedChecks: 0 },
    ],
    usage: {
      logEvents: 1500000,
      logBytes: 1610612736,
      spans: 40000,
      topProjects: [{ name: 'Payments <prj>', events: 900000 }],
      quotaWarnings: [{ capability: 'logs.retention<days>', usedPct: 92 }],
    },
    webhooks: { delivered: 500, failed: 12, dead: 3 },
    teamActivity: { membersAdded: 2, membersRemoved: 1, configChanges: 7, failedLogins: 4 },
  };

  it('renders every expanded section title in HTML and plaintext', () => {
    const result = generateDigestEmail(fullData);

    const htmlTitles = [
      'Log Breakdown',
      'Top Error Messages',
      'Traces',
      'Metrics',
      'Alerts',
      'Security Activity',
      'Monitor Performance',
      'Usage',
      'Webhooks',
      'Team Activity',
    ];
    for (const title of htmlTitles) {
      expect(result.html, `html should contain the ${title} section`).toContain(title);
    }

    const textTitles = [
      'LOG BREAKDOWN',
      'TOP ERROR MESSAGES',
      'TRACES',
      'METRICS',
      'ALERTS',
      'SECURITY ACTIVITY',
      'MONITOR PERFORMANCE',
      'USAGE',
      'WEBHOOKS',
      'TEAM ACTIVITY',
    ];
    for (const title of textTitles) {
      expect(result.text, `text should contain the ${title} section`).toContain(title);
    }
  });

  it('orders the sections as specified', () => {
    const { html } = generateDigestEmail(fullData);

    const order = [
      'Log Volume',
      'Log Breakdown',
      'Top Services by Errors',
      'Top Error Messages',
      'New Error Groups',
      'Traces',
      'Metrics',
      'Alerts',
      'Security',
      'Security Activity',
      'Uptime',
      'Monitor Performance',
      'Usage',
      'Webhooks',
      'Team Activity',
      'View Dashboard',
    ];

    const positions = order.map((title) => html.indexOf(title));
    for (const [index, position] of positions.entries()) {
      expect(position, `${order[index]} should be present`).toBeGreaterThan(-1);
      if (index > 0) {
        expect(position, `${order[index]} should follow ${order[index - 1]}`).toBeGreaterThan(
          positions[index - 1]
        );
      }
    }
  });

  it('renders the log breakdown numbers in both formats', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('9,000');
    expect(result.html).toContain('3.3%');
    expect(result.html).toContain('2026-08-10');
    expect(result.text).toContain('info: 9,000');
    expect(result.text).toContain('Error rate: 3.3% (previous: 2%)');
    expect(result.text).toContain('2026-08-10: 1,200');
  });

  it('renders traces with a worst-project p95 label and a dash for missing p95', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('40,000');
    expect(result.html).toContain('p95 (worst)');
    expect(result.html).toContain('worst project');
    expect(result.html).toContain('450ms');
    expect(result.html).toContain('3%');
    expect(result.text).toContain('Spans: 40,000');
    expect(result.text).toContain('Error spans: 250');
    expect(result.text).toContain('p95 450ms');
    expect(result.text).toContain('p95 -');
    expect(result.text).toContain('GET /<pay>');
  });

  it('renders alert totals and the top rules table', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('+8 (+200.0%)');
    expect(result.text).toContain('Triggers: 12');
    expect(result.text).toContain('Previous triggers: 4');
    expect(result.text).toContain('High <error> rate: 7');
  });

  it('renders the alerts section without a rules table when nothing fired this period', () => {
    const data: DigestEmailData = {
      ...fullData,
      alerts: { total: 0, previousTotal: 6, trend: '-6 (-100.0%)', topRules: [] },
    };

    const result = generateDigestEmail(data);

    expect(result.html).toContain('Alerts');
    expect(result.html).toContain('-6 (-100.0%)');
    expect(result.html).not.toContain('Triggers</th>');
    expect(result.text).toContain('Triggers: 0');
    expect(result.text).toContain('Previous triggers: 6');
  });

  it('renders security activity counts and MITRE techniques', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('T1110');
    expect(result.text).toContain('Incidents opened: 3');
    expect(result.text).toContain('Incidents resolved: 5');
    expect(result.text).toContain('critical: 2');
  });

  it('renders untimed monitors with a dash instead of 0ms', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('120ms');
    // Untimed (heartbeat) monitors render a dash cell, never "0ms"
    expect(result.html).toContain('>-</td>');
    expect(result.html).not.toContain('>0ms</td>');
    expect(result.text).toContain('avg 120ms, p95 450ms');
    expect(result.text).toContain('avg -, p95 -');
  });

  it('humanizes usage bytes and labels quota warnings as month-to-date', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('1.5 GB');
    expect(result.html).toContain('Month-to-date usage above 80% of limit');
    expect(result.html).toContain('92%');
    expect(result.text).toContain('Log events: 1,500,000');
    expect(result.text).toContain('Log volume: 1.5 GB');
    expect(result.text).toContain('Month-to-date usage above 80% of limit');
    expect(result.text).toContain('logs.retention<days>: 92%');
  });

  it('highlights dead webhook deliveries and renders team activity', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('dead-letter queue');
    expect(result.text).toContain('Delivered: 500');
    expect(result.text).toContain('Dead: 3');
    expect(result.text).toContain('Members added: 2');
    expect(result.text).toContain('Failed logins: 4');
  });

  it('truncates long error messages to 120 characters', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('x'.repeat(117) + '...');
    expect(result.html).not.toContain('x'.repeat(121));
    expect(result.text).toContain('x'.repeat(117) + '...');
    expect(result.text).not.toContain('x'.repeat(121));
  });

  it('escapes user-controlled values from the expanded sections', () => {
    const result = generateDigestEmail(fullData);

    const payloads = [
      '<script>alert(1)</script>',
      'High <error> rate',
      'checkout-<svc>',
      'GET /<pay>',
      'API <Health>',
      'Heartbeat <hb>',
      'Payments <prj>',
      'T1110<script>',
      'logs.retention<days>',
    ];
    for (const payload of payloads) {
      expect(result.html, `html should escape ${payload}`).not.toContain(payload);
    }

    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).toContain('High &lt;error&gt; rate');
    expect(result.html).toContain('logs.retention&lt;days&gt;');
  });

  it('omits expanded sections that are undefined', () => {
    const result = generateDigestEmail(baseData);

    const htmlTitles = [
      'Log Breakdown',
      'Top Error Messages',
      'Traces',
      'Metrics',
      'Alerts',
      'Security Activity',
      'Monitor Performance',
      'Usage',
      'Webhooks',
      'Team Activity',
    ];
    for (const title of htmlTitles) {
      expect(result.html, `html should omit the ${title} section`).not.toContain(title);
    }

    const textTitles = [
      'LOG BREAKDOWN',
      'TOP ERROR MESSAGES',
      'TRACES',
      'METRICS',
      'ALERTS',
      'SECURITY ACTIVITY',
      'MONITOR PERFORMANCE',
      'USAGE',
      'WEBHOOKS',
      'TEAM ACTIVITY',
    ];
    for (const title of textTitles) {
      expect(result.text, `text should omit the ${title} section`).not.toContain(title);
    }
  });

  it('stays quiet when logs and spans are both zero', () => {
    const data: DigestEmailData = {
      ...baseData,
      logVolume: { current: 0, previous: 0, trend: 'no change' },
      traces: {
        spanCount: 0,
        previousSpanCount: 0,
        trend: 'no change',
        errorSpanCount: 0,
        services: [],
        slowestSpans: [],
      },
    };

    const result = generateDigestEmail(data);

    expect(result.html).toContain('No activity during this period');
    expect(result.text).toContain('No activity during this period');
    expect(result.html).toContain('Quiet period for Acme Corp');
  });

  it('is not a quiet period when the traces section carries spans', () => {
    const data: DigestEmailData = {
      ...baseData,
      logVolume: { current: 0, previous: 0, trend: 'no change' },
      traces: {
        spanCount: 500,
        previousSpanCount: 0,
        trend: '+500 (new activity)',
        errorSpanCount: 1,
        services: [],
        slowestSpans: [],
      },
    };

    const result = generateDigestEmail(data);

    expect(result.html).not.toContain('No activity during this period');
    expect(result.text).not.toContain('No activity during this period');
    expect(result.text).toContain('Total logs: 0');
    expect(result.text).toContain('Spans: 500');
  });

  it('adds alert and incident counts to the preheader when those sections are present', () => {
    const result = generateDigestEmail(fullData);

    expect(result.html).toContain('12 alerts');
    expect(result.html).toContain('3 incidents');
  });

  // ==========================================================================
  // Gating of the five original sections: undefined means the section was
  // disabled, and then nothing of it renders (not even its title).
  // ==========================================================================

  it('omits the log volume section when it is undefined', () => {
    const result = generateDigestEmail({ ...baseData, logVolume: undefined });

    expect(result.html).not.toContain('Log Volume');
    expect(result.text).not.toContain('LOG VOLUME');
    expect(result.text).not.toContain('Total logs:');
  });

  it('omits the top services section when it is undefined', () => {
    const result = generateDigestEmail({ ...baseData, topErrorServices: undefined });

    expect(result.html).not.toContain('Top Services by Errors');
    expect(result.text).not.toContain('TOP SERVICES BY ERRORS');
    expect(result.html).not.toContain('No errors recorded in this period.');
  });

  it('omits the new error groups section when it is undefined', () => {
    const result = generateDigestEmail({ ...baseData, newErrorGroups: undefined });

    expect(result.html).not.toContain('New Error Groups');
    expect(result.text).not.toContain('NEW ERROR GROUPS');
    expect(result.html).not.toContain('No new error groups appeared in this period.');
  });

  it('omits the security section when it is undefined', () => {
    const result = generateDigestEmail({ ...baseData, security: undefined });

    expect(result.html).not.toContain('Security');
    expect(result.text).not.toContain('SECURITY');
    expect(result.text).not.toContain('Open incidents:');
  });

  it('omits the uptime section when it is undefined', () => {
    const result = generateDigestEmail({ ...baseData, uptime: undefined });

    expect(result.html).not.toContain('Uptime');
    expect(result.text).not.toContain('UPTIME');
  });

  it('keeps the enabled-but-empty sections with their empty-state lines', () => {
    const empty: DigestEmailData = {
      ...baseData,
      logVolume: { current: 0, previous: 0, trend: 'no change' },
      topErrorServices: [],
      newErrorGroups: [],
      security: { totalDetections: 0, topRules: [], openIncidents: 0 },
      uptime: null,
    };

    const result = generateDigestEmail(empty);

    expect(result.html).toContain('Top Services by Errors');
    expect(result.html).toContain('No errors recorded in this period.');
    expect(result.html).toContain('New Error Groups');
    expect(result.html).toContain('No new error groups appeared in this period.');
    expect(result.text).toContain('SECURITY');
    expect(result.text).toContain('Open incidents: 0');
  });

  it('is never a quiet period when the log volume section is disabled', () => {
    const result = generateDigestEmail({ ...fullData, logVolume: undefined });

    expect(result.html).not.toContain('No activity during this period');
    expect(result.text).not.toContain('No activity during this period');
    expect(result.html).not.toContain('Quiet period for Acme Corp');
  });

  it('drops the logs and detections parts of the preheader with those sections off', () => {
    const result = generateDigestEmail({
      ...fullData,
      logVolume: undefined,
      security: undefined,
    });

    expect(result.html).not.toContain('logs, ');
    expect(result.html).not.toContain('11 detections');
    expect(result.html).toContain('12 alerts, 3 incidents for Acme Corp');
  });

  it('falls back to a generic preheader when no section feeds it', () => {
    const result = generateDigestEmail({
      ...baseData,
      logVolume: undefined,
      security: undefined,
    });

    expect(result.html).toContain('Digest for Acme Corp');
  });
});
