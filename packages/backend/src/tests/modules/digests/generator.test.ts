import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DIGEST_SECTION_DEFAULTS } from '@logtide/shared';
import { DigestGeneratorService } from '../../../modules/digests/generator.js';
import type { DigestJobPayload } from '../../../modules/digests/scheduler.js';

vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {
    count: vi.fn(),
    topValues: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock('@logtide/core', () => ({
  hub: {
    captureLog: vi.fn(),
  },
}));

vi.mock('../../../database/connection.js', () => ({
    db: {
      selectFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn(),
      executeTakeFirst: vi.fn(),
    }
}));


const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-message-id' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));


vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'smtp.test.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'test@test.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@logtide.com',
    FRONTEND_URL: 'https://app.logtide.com',
  },
}));

describe('DigestGeneratorService', () => {
  let generator: DigestGeneratorService;
  let mockDb: any;
  let mockReservoir: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { reservoir } = await import('../../../database/reservoir.js');
    mockReservoir = reservoir;
    const { db } = await import('../../../database/connection.js');
    mockDb = db;

    // Defaults keep the section queries harmless; tests override with *Once.
    mockDb.execute.mockReset().mockResolvedValue([]);
    mockDb.executeTakeFirst.mockReset().mockResolvedValue({ count: 0 });
    mockReservoir.count.mockReset().mockResolvedValue({ count: 0 });
    mockReservoir.topValues.mockReset().mockResolvedValue({ values: [] });
    mockReservoir.aggregate.mockReset().mockResolvedValue({ timeseries: [], total: 0 });
    mockSendMail.mockReset().mockResolvedValue({ messageId: 'test-message-id' });

    generator = new DigestGeneratorService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAndSendDigest', () => {
    /**
     * Call order with the shared fluent mock:
     * executeTakeFirst: org lookup, then per-section counts (default {count: 0})
     * execute: recipients, projects, then per-section lists (default [])
     */
    it('should generate and send daily digest with log volume', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      // recipients lookup
      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user1@test.com',
          unsubscribe_token: 'token_1',
        },
        {
          email: 'user2@test.com',
          unsubscribe_token: 'token_2',
        },
      ]);

      // projects query
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.count.mockResolvedValueOnce({ count: 15000 });
      mockReservoir.count.mockResolvedValueOnce({ count: 12000 });

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(2);

      const firstCall = mockSendMail.mock.calls[0][0];
      expect(firstCall.to).toBe('user1@test.com');
      expect(firstCall.subject).toContain('Daily Report');
      expect(firstCall.subject).toContain('Test Organization');
      expect(firstCall.text).toContain('15,000');
      expect(firstCall.text).toContain('+3000 (+25.0%)');
      expect(firstCall.text).toContain('token_1');

      const secondCall = mockSendMail.mock.calls[1][0];
      expect(secondCall.to).toBe('user2@test.com');
      expect(secondCall.text).toContain('token_2');
    });

    it('should generate and send weekly digest', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'weekly',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'token_1',
        },
      ]);

      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.count.mockResolvedValueOnce({ count: 100000 });
      mockReservoir.count.mockResolvedValueOnce({ count: 95000 });

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.subject).toContain('Weekly Report');
      expect(emailCall.text).toContain('100,000');
      expect(emailCall.text).toContain('+5000 (+5.3%)');
    });

    it('should handle zero activity (quiet period)', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'token_1',
        },
      ]);

      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.text).toContain('No activity during this period');
      expect(emailCall.text).toContain('quiet');
    });

    it('should handle negative trend (decreased activity)', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'token_1',
        },
      ]);

      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.count.mockResolvedValueOnce({ count: 8000 });
      mockReservoir.count.mockResolvedValueOnce({ count: 10000 });

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.text).toContain('8,000');
      expect(emailCall.text).toContain('-2000 (-20.0%)');
    });

    it('should handle new activity (previous period was zero)', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'token_1',
        },
      ]);

      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.count.mockResolvedValueOnce({ count: 5000 });
      mockReservoir.count.mockResolvedValueOnce({ count: 0 });

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.text).toContain('5,000');
      expect(emailCall.text).toContain('+5000 (new activity)');
    });

    it('should skip sending if no subscribed recipients', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      // No recipients
      mockDb.execute.mockResolvedValueOnce([]);

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should handle organization with no projects', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'token_1',
        },
      ]);
      mockDb.execute.mockResolvedValueOnce([]);

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.text).toContain('No activity during this period');
      // No projects: the reservoir must never be queried
      expect(mockReservoir.count).not.toHaveBeenCalled();
      expect(mockReservoir.topValues).not.toHaveBeenCalled();
    });

    it('should throw error if organization not found', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_nonexistent',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce(undefined);

      await expect(generator.generateAndSendDigest(payload)).rejects.toThrow(
        'Organization org_nonexistent not found'
      );

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should include unsubscribe link in email', async () => {
      const payload: DigestJobPayload = {
        organizationId: 'org_1',
        digestConfigId: 'config_1',
        frequency: 'daily',
      };

      mockDb.executeTakeFirst.mockResolvedValueOnce({
        name: 'Test Organization',
      });

      mockDb.execute.mockResolvedValueOnce([
        {
          email: 'user@test.com',
          unsubscribe_token: 'secure_token_abc123',
        },
      ]);
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.count.mockResolvedValueOnce({ count: 1000 });
      mockReservoir.count.mockResolvedValueOnce({ count: 900 });

      await generator.generateAndSendDigest(payload);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.text).toContain('unsubscribe');
      expect(emailCall.text).toContain('secure_token_abc123');
      expect(emailCall.text).toContain('https://app.logtide.com/unsubscribe?token=secure_token_abc123');
    });
  });

  describe('buildReportData', () => {
    /**
     * Call order inside buildReportData with the shared fluent mock:
     * execute: projects, error_groups, top rules, monitors, uptime rows
     * executeTakeFirst: detection total, open incidents
     * reservoir: count x2, topValues x2 (previous period skipped when current is empty)
     */
    it('computes top error services with delta vs previous period', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      mockReservoir.topValues.mockResolvedValueOnce({
        values: [
          { value: 'api', count: 50 },
          { value: 'web', count: 10 },
        ],
      });
      mockReservoir.topValues.mockResolvedValueOnce({
        values: [{ value: 'api', count: 20 }],
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.topErrorServices).toEqual([
        { service: 'api', errorCount: 50, previousCount: 20, delta: 30 },
        { service: 'web', errorCount: 10, previousCount: 0, delta: 10 },
      ]);

      // error+critical levels, top 5 for current period
      const firstCall = mockReservoir.topValues.mock.calls[0][0];
      expect(firstCall.field).toBe('service');
      expect(firstCall.level).toEqual(['error', 'critical']);
      expect(firstCall.limit).toBe(5);
    });

    it('skips the previous-period query when there are no current errors', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.topErrorServices).toEqual([]);
      expect(mockReservoir.topValues).toHaveBeenCalledTimes(1);
    });

    it('collects new error groups first seen in the period', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([
        {
          exception_type: 'TypeError',
          exception_message: 'Cannot read properties of undefined',
          occurrence_count: 42,
          language: 'nodejs',
        },
        {
          exception_type: 'ValueError',
          exception_message: null,
          occurrence_count: 3,
          language: 'python',
        },
      ]); // error_groups

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.newErrorGroups).toEqual([
        {
          exceptionType: 'TypeError',
          exceptionMessage: 'Cannot read properties of undefined',
          occurrenceCount: 42,
          language: 'nodejs',
        },
        {
          exceptionType: 'ValueError',
          exceptionMessage: '',
          occurrenceCount: 3,
          language: 'python',
        },
      ]);
    });

    it('computes the security summary', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([
        { rule_title: 'Suspicious Login', severity: 'high', count: 7 },
        { rule_title: 'Port Scan', severity: 'medium', count: 4 },
      ]); // top rules

      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 11 }); // detections total
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 2 }); // open incidents

      const report = await generator.buildReportData('org_1', 'Test Org', 'weekly');

      expect(report.security).toEqual({
        totalDetections: 11,
        topRules: [
          { ruleTitle: 'Suspicious Login', severity: 'high', count: 7 },
          { ruleTitle: 'Port Scan', severity: 'medium', count: 4 },
        ],
        openIncidents: 2,
      });
    });

    it('computes uptime summary from monitor daily buckets', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([]); // top rules
      mockDb.execute.mockResolvedValueOnce([
        { id: 'mon_1', name: 'API Health' },
        { id: 'mon_2', name: 'Landing Page' },
      ]); // monitors
      mockDb.execute.mockResolvedValueOnce([
        { monitor_id: 'mon_1', successful: 95, total: 100 },
        { monitor_id: 'mon_2', successful: 100, total: 100 },
      ]); // uptime rows

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.uptime).toEqual({
        monitorCount: 2,
        overallUptimePct: 97.5,
        worstMonitors: [
          { name: 'API Health', uptimePct: 95 },
          { name: 'Landing Page', uptimePct: 100 },
        ],
      });
    });

    it('returns null uptime when the org has no enabled monitors', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      // error_groups, top rules, monitors all fall through to the [] default

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.uptime).toBeNull();
    });

    it('labels the period by frequency', async () => {
      mockDb.execute.mockResolvedValueOnce([]); // projects (none)

      const daily = await generator.buildReportData('org_1', 'Test Org', 'daily');
      expect(daily.periodLabel).toBe('last 24 hours');

      mockDb.execute.mockResolvedValueOnce([]);
      const weekly = await generator.buildReportData('org_1', 'Test Org', 'weekly');
      expect(weekly.periodLabel).toBe('last 7 days');
    });
  });

  describe('optional sections', () => {
    /**
     * The optional sections are computed AFTER the five original ones, in
     * catalog order (logBreakdown, topErrorMessages, alerts), so their mocked
     * responses queue behind the existing sections' ones.
     */
    it('skips disabled sections without issuing their queries', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      // top error services current + previous (the only two topValues calls)
      mockReservoir.topValues.mockResolvedValueOnce({ values: [{ value: 'api', count: 3 }] });
      mockReservoir.topValues.mockResolvedValueOnce({ values: [] });

      const report = await generator.buildReportData(
        'org_1',
        'Test Org',
        'daily',
        DIGEST_SECTION_DEFAULTS
      );

      expect(report.logBreakdown).toBeUndefined();
      expect(report.topErrorMessages).toBeUndefined();
      expect(report.alerts).toBeUndefined();
      expect(mockReservoir.topValues).toHaveBeenCalledTimes(2);
      expect(mockReservoir.aggregate).not.toHaveBeenCalled();
    });

    it('defaults to the section defaults when no flags are passed', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.logBreakdown).toBeUndefined();
      expect(report.topErrorMessages).toBeUndefined();
      expect(report.alerts).toBeUndefined();
    });

    it('computes logBreakdown when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      mockReservoir.topValues.mockResolvedValueOnce({ values: [] }); // top error services
      mockReservoir.topValues.mockResolvedValueOnce({
        values: [
          { value: 'info', count: 80 },
          { value: 'error', count: 20 },
        ],
      }); // levels, current window
      mockReservoir.topValues.mockResolvedValueOnce({
        values: [{ value: 'info', count: 100 }],
      }); // levels, previous window

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        logBreakdown: true,
      });

      expect(report.logBreakdown).toEqual({
        levels: [
          { level: 'debug', current: 0, previous: 0 },
          { level: 'info', current: 80, previous: 100 },
          { level: 'warn', current: 0, previous: 0 },
          { level: 'error', current: 20, previous: 0 },
          { level: 'critical', current: 0, previous: 0 },
        ],
        errorRatePct: 20,
        previousErrorRatePct: 0,
      });

      const levelCall = mockReservoir.topValues.mock.calls[1][0];
      expect(levelCall.field).toBe('level');
      expect(levelCall.projectId).toEqual(['project_1']);
      expect(levelCall.toExclusive).toBe(true);

      // Daily digests never build the per-day table
      expect(mockReservoir.aggregate).not.toHaveBeenCalled();
    });

    it('returns undefined logBreakdown when both windows are empty', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        logBreakdown: true,
      });

      expect(report.logBreakdown).toBeUndefined();
    });

    it('adds the per-day table for weekly logBreakdown', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.topValues.mockResolvedValueOnce({ values: [] }); // top error services
      mockReservoir.topValues.mockResolvedValueOnce({
        values: [{ value: 'info', count: 10 }],
      });
      mockReservoir.topValues.mockResolvedValueOnce({ values: [] });

      mockReservoir.aggregate.mockResolvedValueOnce({
        timeseries: [
          { bucket: new Date('2026-08-10T00:00:00.000Z'), total: 4 },
          { bucket: new Date('2026-08-11T00:00:00.000Z'), total: 6 },
        ],
        total: 10,
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'weekly', {
        ...DIGEST_SECTION_DEFAULTS,
        logBreakdown: true,
      });

      expect(report.logBreakdown?.daily).toEqual([
        { date: '2026-08-10', count: 4 },
        { date: '2026-08-11', count: 6 },
      ]);

      const aggregateCall = mockReservoir.aggregate.mock.calls[0][0];
      expect(aggregateCall.interval).toBe('1d');
      expect(aggregateCall.projectId).toEqual(['project_1']);
    });

    it('computes topErrorMessages when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.topValues.mockResolvedValueOnce({ values: [] }); // top error services
      mockReservoir.topValues.mockResolvedValueOnce({
        values: [
          { value: 'db timeout', count: 12 },
          { value: 'null pointer', count: 3 },
        ],
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        topErrorMessages: true,
      });

      expect(report.topErrorMessages).toEqual([
        { message: 'db timeout', count: 12 },
        { message: 'null pointer', count: 3 },
      ]);

      const messageCall = mockReservoir.topValues.mock.calls[1][0];
      expect(messageCall.field).toBe('message');
      expect(messageCall.level).toEqual(['error', 'critical']);
      expect(messageCall.limit).toBe(5);
    });

    it('returns undefined topErrorMessages when there are none', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        topErrorMessages: true,
      });

      expect(report.topErrorMessages).toBeUndefined();
    });

    it('computes alerts section when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([]); // security top rules
      mockDb.execute.mockResolvedValueOnce([]); // monitors (uptime null)
      mockDb.execute.mockResolvedValueOnce([{ name: 'High error rate', count: 5 }]); // alert rules

      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // detections total
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // open incidents
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 7 }); // alerts current
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 3 }); // alerts previous

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        alerts: true,
      });

      expect(report.alerts).toEqual({
        total: 7,
        previousTotal: 3,
        trend: '+4 (+133.3%)',
        topRules: [{ name: 'High error rate', count: 5 }],
      });

      // Org scoping goes through the alert_rules join, alert_history has no org column
      expect(mockDb.innerJoin).toHaveBeenCalledWith(
        'alert_rules',
        'alert_rules.id',
        'alert_history.rule_id'
      );
      expect(mockDb.where).toHaveBeenCalledWith('alert_rules.organization_id', '=', 'org_1');
    });

    it('returns undefined alerts when no triggers in either window', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        alerts: true,
      });

      expect(report.alerts).toBeUndefined();
    });
  });
});
