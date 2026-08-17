import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DIGEST_SECTION_DEFAULTS } from '@logtide/shared';
import { DigestGeneratorService } from '../../../modules/digests/generator.js';
import type { DigestJobPayload } from '../../../modules/digests/scheduler.js';

vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {
    count: vi.fn(),
    topValues: vi.fn(),
    aggregate: vi.fn(),
    getSpanTimeseries: vi.fn(),
    getServiceHealthStats: vi.fn(),
    querySpans: vi.fn(),
    queryMetrics: vi.fn(),
  },
}));

vi.mock('@logtide/core', () => ({
  hub: {
    captureLog: vi.fn(),
  },
}));

// The usage section reads the metering module directly (not through the db
// mock), so both functions are stubbed at module level and never move the
// shared fluent db mock's call cursor.
const { mockGetUsageBreakdown, mockGetCapabilityUsage } = vi.hoisted(() => ({
  mockGetUsageBreakdown: vi.fn(),
  mockGetCapabilityUsage: vi.fn(),
}));

vi.mock('../../../modules/metering/breakdown.js', () => ({
  getUsageBreakdown: mockGetUsageBreakdown,
}));

vi.mock('../../../modules/metering/capability-usage.js', () => ({
  getCapabilityUsage: mockGetCapabilityUsage,
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
    mockReservoir.getSpanTimeseries.mockReset().mockResolvedValue([]);
    mockReservoir.getServiceHealthStats.mockReset().mockResolvedValue([]);
    mockReservoir.querySpans
      .mockReset()
      .mockResolvedValue({ spans: [], total: 0, hasMore: false, limit: 5, offset: 0 });
    mockReservoir.queryMetrics
      .mockReset()
      .mockResolvedValue({ metrics: [], total: 0, hasMore: false, limit: 1, offset: 0 });
    mockSendMail.mockReset().mockResolvedValue({ messageId: 'test-message-id' });
    mockGetUsageBreakdown
      .mockReset()
      .mockResolvedValue({ byType: [], byProject: [], byService: [], byLevel: [] });
    mockGetCapabilityUsage.mockReset().mockResolvedValue([]);

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

  describe('gating of the five original sections', () => {
    /**
     * The five sections that shipped with the original digest are toggleable
     * like every other one: disabled means undefined AND zero queries, never a
     * zeroed section. Enabled-but-empty keeps its own semantics (zeros, empty
     * arrays, null uptime) and is covered by the buildReportData tests above.
     */
    const queriedTables = (): string[] =>
      mockDb.selectFrom.mock.calls.map((c: unknown[]) => c[0] as string);

    it('omits logVolume and issues no count queries when disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        logVolume: false,
      });

      expect(report.logVolume).toBeUndefined();
      expect(mockReservoir.count).not.toHaveBeenCalled();
    });

    it('omits topErrorServices and issues no topValues query when disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        topErrorServices: false,
      });

      expect(report.topErrorServices).toBeUndefined();
      expect(mockReservoir.topValues).not.toHaveBeenCalled();
    });

    it('omits newErrorGroups and never reads error_groups when disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        newErrorGroups: false,
      });

      expect(report.newErrorGroups).toBeUndefined();
      expect(queriedTables()).not.toContain('error_groups');
    });

    it('omits security and issues no detection queries when disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        security: false,
      });

      expect(report.security).toBeUndefined();
      expect(queriedTables()).not.toContain('detection_events');
      expect(queriedTables()).not.toContain('incidents');
      // The detection total and the open-incident count are the only two
      // single-row queries of the default section set.
      expect(mockDb.executeTakeFirst).not.toHaveBeenCalled();
    });

    it('omits uptime and never reads the monitor tables when disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        uptime: false,
      });

      expect(report.uptime).toBeUndefined();
      expect(queriedTables()).not.toContain('monitors');
      expect(queriedTables()).not.toContain('monitor_uptime_daily');
    });

    it('issues only the project lookup when every section is disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const allOff = Object.fromEntries(
        Object.keys(DIGEST_SECTION_DEFAULTS).map((key) => [key, false])
      ) as typeof DIGEST_SECTION_DEFAULTS;

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', allOff);

      expect(report.logVolume).toBeUndefined();
      expect(report.topErrorServices).toBeUndefined();
      expect(report.newErrorGroups).toBeUndefined();
      expect(report.security).toBeUndefined();
      expect(report.uptime).toBeUndefined();
      expect(queriedTables()).toEqual(['projects']);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(mockDb.executeTakeFirst).not.toHaveBeenCalled();
      expect(mockReservoir.count).not.toHaveBeenCalled();
      expect(mockReservoir.topValues).not.toHaveBeenCalled();
    });

    it('still reports zeros and empty arrays when the sections are enabled but empty', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.logVolume).toEqual({ current: 0, previous: 0, trend: 'no change' });
      expect(report.topErrorServices).toEqual([]);
      expect(report.newErrorGroups).toEqual([]);
      expect(report.security).toEqual({ totalDetections: 0, topRules: [], openIncidents: 0 });
      expect(report.uptime).toBeNull();
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

  describe('traces and metrics sections', () => {
    /**
     * Both sections talk to the reservoir only, so they never move the shared
     * fluent db mock's call cursor.
     */
    it('computes traces section when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }, { id: 'project_2' }]); // projects

      mockReservoir.getSpanTimeseries.mockResolvedValueOnce([
        {
          time: new Date('2026-08-15T10:00:00.000Z'),
          spanCount: 300,
          errorCount: 15,
          p50: 10,
          p95: 100,
          p99: 200,
        },
        {
          time: new Date('2026-08-15T11:00:00.000Z'),
          spanCount: 200,
          errorCount: 10,
          p50: 12,
          p95: 110,
          p99: 210,
        },
      ]); // current window
      mockReservoir.getSpanTimeseries.mockResolvedValueOnce([
        {
          time: new Date('2026-08-14T10:00:00.000Z'),
          spanCount: 400,
          errorCount: 40,
          p50: 11,
          p95: 105,
          p99: 205,
        },
      ]); // previous window

      // Same service seen in both projects: calls and errors sum, p95 is the max
      mockReservoir.getServiceHealthStats.mockResolvedValueOnce([
        { serviceName: 'api', totalCalls: 300, totalErrors: 16, avgLatencyMs: 20, p95LatencyMs: 120 },
      ]); // project_1
      mockReservoir.getServiceHealthStats.mockResolvedValueOnce([
        { serviceName: 'api', totalCalls: 200, totalErrors: 5, avgLatencyMs: 30, p95LatencyMs: 180 },
        { serviceName: 'web', totalCalls: 100, totalErrors: 3, avgLatencyMs: 5, p95LatencyMs: 40 },
      ]); // project_2

      mockReservoir.querySpans.mockResolvedValueOnce({
        spans: [
          { serviceName: 'api', operationName: 'GET /users', durationMs: 900 },
          { serviceName: 'web', operationName: 'render', durationMs: 500 },
        ],
        total: 2,
        hasMore: false,
        limit: 5,
        offset: 0,
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        traces: true,
      });

      expect(report.traces).toEqual({
        spanCount: 500,
        previousSpanCount: 400,
        trend: '+100 (+25.0%)',
        errorSpanCount: 25,
        services: [
          { service: 'api', calls: 500, errorRatePct: 4.2, p95Ms: 180 },
          { service: 'web', calls: 100, errorRatePct: 3, p95Ms: 40 },
        ],
        slowestSpans: [
          { service: 'api', operation: 'GET /users', durationMs: 900 },
          { service: 'web', operation: 'render', durationMs: 500 },
        ],
      });

      const timeseriesCall = mockReservoir.getSpanTimeseries.mock.calls[0][0];
      expect(timeseriesCall.projectIds).toEqual(['project_1', 'project_2']);
      expect(timeseriesCall.bucket).toBe('hour');

      // getServiceHealthStats is single-project: one call per project
      expect(mockReservoir.getServiceHealthStats).toHaveBeenCalledTimes(2);
      expect(mockReservoir.getServiceHealthStats.mock.calls[0][0]).toBe('project_1');
      expect(mockReservoir.getServiceHealthStats.mock.calls[1][0]).toBe('project_2');

      const spanCall = mockReservoir.querySpans.mock.calls[0][0];
      expect(spanCall.projectId).toEqual(['project_1', 'project_2']);
      expect(spanCall.sortBy).toBe('duration_ms');
      expect(spanCall.sortOrder).toBe('desc');
      expect(spanCall.limit).toBe(5);
    });

    it('buckets weekly span volume by day', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.getSpanTimeseries.mockResolvedValue([
        {
          time: new Date('2026-08-15T00:00:00.000Z'),
          spanCount: 10,
          errorCount: 1,
          p50: null,
          p95: null,
          p99: null,
        },
      ]);

      await generator.buildReportData('org_1', 'Test Org', 'weekly', {
        ...DIGEST_SECTION_DEFAULTS,
        traces: true,
      });

      expect(mockReservoir.getSpanTimeseries.mock.calls[0][0].bucket).toBe('day');
      expect(mockReservoir.getSpanTimeseries.mock.calls[1][0].bucket).toBe('day');
    });

    it('keeps only the top 5 services by calls', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.getSpanTimeseries.mockResolvedValueOnce([
        {
          time: new Date('2026-08-15T10:00:00.000Z'),
          spanCount: 60,
          errorCount: 0,
          p50: null,
          p95: null,
          p99: null,
        },
      ]);

      mockReservoir.getServiceHealthStats.mockResolvedValueOnce(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i) => ({
          serviceName: name,
          totalCalls: (i + 1) * 10,
          totalErrors: 0,
          avgLatencyMs: 1,
          p95LatencyMs: null,
        }))
      );

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        traces: true,
      });

      expect(report.traces?.services.map((s) => s.service)).toEqual(['f', 'e', 'd', 'c', 'b']);
      expect(report.traces?.services[0]).toEqual({
        service: 'f',
        calls: 60,
        errorRatePct: 0,
        p95Ms: null,
      });
    });

    it('returns undefined traces when no spans in either window', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        traces: true,
      });

      expect(report.traces).toBeUndefined();
      // Nothing to rank: the follow-up queries never run
      expect(mockReservoir.getServiceHealthStats).not.toHaveBeenCalled();
      expect(mockReservoir.querySpans).not.toHaveBeenCalled();
    });

    it('returns undefined traces when the org has no projects', async () => {
      mockDb.execute.mockResolvedValueOnce([]); // no projects

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        traces: true,
        metrics: true,
      });

      expect(report.traces).toBeUndefined();
      expect(report.metrics).toBeUndefined();
      expect(mockReservoir.getSpanTimeseries).not.toHaveBeenCalled();
      expect(mockReservoir.queryMetrics).not.toHaveBeenCalled();
    });

    it('traces disabled by default issues no span queries', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.traces).toBeUndefined();
      expect(mockReservoir.getSpanTimeseries).not.toHaveBeenCalled();
      expect(mockReservoir.getServiceHealthStats).not.toHaveBeenCalled();
      expect(mockReservoir.querySpans).not.toHaveBeenCalled();
    });

    it('computes metrics section when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockReservoir.queryMetrics.mockResolvedValueOnce({
        metrics: [],
        total: 1200,
        hasMore: true,
        limit: 1,
        offset: 0,
      });
      mockReservoir.queryMetrics.mockResolvedValueOnce({
        metrics: [],
        total: 1000,
        hasMore: true,
        limit: 1,
        offset: 0,
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        metrics: true,
      });

      expect(report.metrics).toEqual({
        datapoints: 1200,
        previousDatapoints: 1000,
        trend: '+200 (+20.0%)',
      });

      const metricCall = mockReservoir.queryMetrics.mock.calls[0][0];
      expect(metricCall.projectId).toEqual(['project_1']);
      expect(metricCall.limit).toBe(1);
      expect(mockReservoir.queryMetrics).toHaveBeenCalledTimes(2);
    });

    it('returns undefined metrics when both windows are empty', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        metrics: true,
      });

      expect(report.metrics).toBeUndefined();
    });

    it('metrics disabled by default issues no queryMetrics call', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.metrics).toBeUndefined();
      expect(mockReservoir.queryMetrics).not.toHaveBeenCalled();
    });
  });

  describe('security activity, monitors, usage, webhooks and team sections', () => {
    /**
     * These five sections are computed last, after metrics, in the order
     * securityActivity -> monitorPerformance -> usage -> webhooks -> teamActivity.
     * With every one of them disabled the shared fluent db mock only sees the
     * five original sections, so the mocks below queue behind:
     *   execute:          projects, error_groups, security top rules, monitors
     *   executeTakeFirst: detection total, open incidents
     */
    it('issues no queries at all when the five sections are disabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily');

      expect(report.securityActivity).toBeUndefined();
      expect(report.monitorPerformance).toBeUndefined();
      expect(report.usage).toBeUndefined();
      expect(report.webhooks).toBeUndefined();
      expect(report.teamActivity).toBeUndefined();

      // Only the five original sections queried
      expect(mockDb.execute).toHaveBeenCalledTimes(4);
      expect(mockDb.executeTakeFirst).toHaveBeenCalledTimes(2);
      expect(mockGetUsageBreakdown).not.toHaveBeenCalled();
      expect(mockGetCapabilityUsage).not.toHaveBeenCalled();
    });

    it('pins the window column and bounds of every new query', async () => {
      // Frozen clock so period.from/period.to are exact values rather than
      // "whatever new Date() returned", which is what makes the bounds
      // assertable at all.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));

      try {
        const from = new Date('2026-08-15T12:00:00.000Z');
        const to = new Date('2026-08-16T12:00:00.000Z');

        mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
        // every later list query falls through to the [] default, and every
        // count to { count: 0 }: this test asserts the SQL windows, not the data

        await generator.buildReportData('org_1', 'Test Org', 'daily', {
          ...DIGEST_SECTION_DEFAULTS,
          securityActivity: true,
          monitorPerformance: true,
          usage: true,
          webhooks: true,
          teamActivity: true,
        });

        const windowCalls = mockDb.where.mock.calls.filter(
          (c: unknown[]) => c[1] === '>=' || c[1] === '<'
        );

        // Ordered, exhaustive: pins the column each query windows on AND that
        // every one of them uses the CURRENT period, never previousFrom/previousTo.
        expect(windowCalls).toEqual([
          ['first_seen', '>=', from], // error_groups (existing section)
          ['first_seen', '<', to],
          ['time', '>=', from], // detection_events total, security section (existing)
          ['time', '<', to],
          ['time', '>=', from], // detection_events top rules (existing)
          ['time', '<', to],
          ['created_at', '>=', from], // incidents opened in the period
          ['created_at', '<', to],
          ['resolved_at', '>=', from], // incidents resolved in the period
          ['resolved_at', '<', to],
          ['time', '>=', from], // detection_events, unnested techniques
          ['time', '<', to],
          ['monitor_results.time', '>=', from],
          ['monitor_results.time', '<', to],
          ['created_at', '>=', from], // webhook_deliveries
          ['created_at', '<', to],
          ['time', '>=', from], // audit_log
          ['time', '<', to],
        ]);

        expect(mockGetUsageBreakdown).toHaveBeenCalledWith({
          organizationId: 'org_1',
          from,
          to,
          limit: 5,
          includeValueBreakdowns: false,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('computes securityActivity when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([]); // security top rules
      mockDb.execute.mockResolvedValueOnce([]); // monitors (uptime null)
      mockDb.execute.mockResolvedValueOnce([
        { severity: 'high', count: 4 },
        { severity: 'critical', count: 2 },
        { severity: 'low', count: 0 },
      ]); // incidents opened by severity
      mockDb.execute.mockResolvedValueOnce([
        { technique: 'T1078', count: 9 },
        { technique: null, count: 5 },
        { technique: 'T1059', count: 2 },
      ]); // unnested mitre techniques

      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // detections total
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // open incidents
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 3 }); // incidents resolved

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        securityActivity: true,
      });

      expect(report.securityActivity).toEqual({
        // severity order critical..informational, zero-count severities dropped
        openedBySeverity: [
          { severity: 'critical', count: 2 },
          { severity: 'high', count: 4 },
        ],
        resolvedCount: 3,
        // null techniques (NULL-padded rows) are never emitted
        topTechniques: [
          { technique: 'T1078', count: 9 },
          { technique: 'T1059', count: 2 },
        ],
      });

      expect(mockDb.where).toHaveBeenCalledWith('organization_id', '=', 'org_1');
    });

    it('returns undefined securityActivity when nothing happened', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        securityActivity: true,
      });

      expect(report.securityActivity).toBeUndefined();
    });

    it('computes monitorPerformance when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([]); // security top rules
      mockDb.execute.mockResolvedValueOnce([]); // monitors (uptime null)
      mockDb.execute.mockResolvedValueOnce([
        { name: 'm1', avg_ms: 10.4, p95_ms: 20.6, failed_checks: 0 },
        { name: 'm2', avg_ms: 20, p95_ms: 40, failed_checks: 1 },
        { name: 'm3', avg_ms: 30, p95_ms: 60, failed_checks: 2 },
        { name: 'm4', avg_ms: 40, p95_ms: 80, failed_checks: 3 },
        { name: 'm5', avg_ms: 50, p95_ms: 100, failed_checks: 4 },
        { name: 'm6', avg_ms: null, p95_ms: null, failed_checks: 5 },
      ]); // monitor_results aggregate

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        monitorPerformance: true,
      });

      // Top 5 by p95 desc; m6 (no timed checks) sorts last and falls off
      expect(report.monitorPerformance).toEqual([
        { name: 'm5', avgMs: 50, p95Ms: 100, failedChecks: 4 },
        { name: 'm4', avgMs: 40, p95Ms: 80, failedChecks: 3 },
        { name: 'm3', avgMs: 30, p95Ms: 60, failedChecks: 2 },
        { name: 'm2', avgMs: 20, p95Ms: 40, failedChecks: 1 },
        { name: 'm1', avgMs: 10, p95Ms: 21, failedChecks: 0 },
      ]);

      expect(mockDb.innerJoin).toHaveBeenCalledWith(
        'monitors',
        'monitors.id',
        'monitor_results.monitor_id'
      );
      expect(mockDb.where).toHaveBeenCalledWith(
        'monitor_results.organization_id',
        '=',
        'org_1'
      );
      // monitor_id has no foreign key (migration 034 declares it without one,
      // for hypertable performance) and deleted monitors leave orphan results,
      // so the joined side must be scoped too
      expect(mockDb.where).toHaveBeenCalledWith('monitors.organization_id', '=', 'org_1');
    });

    it('returns undefined monitorPerformance when no monitor was checked', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        monitorPerformance: true,
      });

      expect(report.monitorPerformance).toBeUndefined();
    });

    it('computes usage from the metering module when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockGetUsageBreakdown.mockResolvedValueOnce({
        byType: [
          { type: 'logs.ingested.bytes', quantity: 4500000 },
          { type: 'logs.ingested.events', quantity: 12000 },
        ],
        byProject: [
          { projectId: 'p1', projectName: 'Prod', events: 9000, bytes: 900 },
          { projectId: 'p2', projectName: 'Staging', events: 1500, bytes: 150 },
          { projectId: 'p3', projectName: 'Dev', events: 800, bytes: 80 },
          { projectId: 'p4', projectName: 'QA', events: 400, bytes: 40 },
          { projectId: 'p5', projectName: 'Sandbox', events: 200, bytes: 20 },
          { projectId: 'p6', projectName: 'Scratch', events: 100, bytes: 10 },
        ],
        byService: [],
        byLevel: [],
      });

      mockGetCapabilityUsage.mockResolvedValueOnce([
        {
          capability: 'ingestion.max_events_month',
          kind: 'quota',
          current: 900,
          limit: 1000,
          description: '',
        },
        { capability: 'alerts.max_rules', kind: 'limit', current: 1, limit: 10, description: '' },
        // unlimited: never a warning, and never a division by null
        { capability: 'apikeys.max', kind: 'limit', current: 5, limit: null, description: '' },
        // limit 0: excluded so it cannot produce an Infinity percentage
        {
          capability: 'dashboards.max_custom',
          kind: 'limit',
          current: 3,
          limit: 0,
          description: '',
        },
      ]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        usage: true,
      });

      expect(report.usage).toEqual({
        logEvents: 12000,
        logBytes: 4500000,
        spans: 0,
        topProjects: [
          { name: 'Prod', events: 9000 },
          { name: 'Staging', events: 1500 },
          { name: 'Dev', events: 800 },
          { name: 'QA', events: 400 },
          { name: 'Sandbox', events: 200 },
        ],
        quotaWarnings: [{ capability: 'ingestion.max_events_month', usedPct: 90 }],
      });

      const breakdownCall = mockGetUsageBreakdown.mock.calls[0][0];
      expect(breakdownCall.organizationId).toBe('org_1');
      expect(breakdownCall.limit).toBe(5);
      // the digest never reads byService/byLevel, so it opts out of those scans
      expect(breakdownCall.includeValueBreakdowns).toBe(false);
      expect(mockGetCapabilityUsage).toHaveBeenCalledWith('org_1');
    });

    it('returns undefined usage when nothing was ingested and no quota is close', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        usage: true,
      });

      expect(report.usage).toBeUndefined();
      expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(1);
    });

    it('computes webhooks delivery counts when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]); // projects
      mockDb.execute.mockResolvedValueOnce([]); // error_groups
      mockDb.execute.mockResolvedValueOnce([]); // security top rules
      mockDb.execute.mockResolvedValueOnce([]); // monitors (uptime null)
      mockDb.execute.mockResolvedValueOnce([
        { status: 'delivered', count: 10 },
        { status: 'failed', count: 2 },
        { status: 'dead', count: 1 },
        { status: 'pending', count: 7 },
      ]); // webhook_deliveries by status

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        webhooks: true,
      });

      // pending is in-flight state, not an outcome: never reported
      expect(report.webhooks).toEqual({ delivered: 10, failed: 2, dead: 1 });
    });

    it('returns undefined webhooks when only pending deliveries exist', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([{ status: 'pending', count: 5 }]);

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        webhooks: true,
      });

      expect(report.webhooks).toBeUndefined();
    });

    it('computes teamActivity counters when enabled', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // detections total
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 }); // open incidents
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        members_added: 2,
        members_removed: 1,
        config_changes: 5,
        failed_logins: 9,
      }); // audit_log counters

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        teamActivity: true,
      });

      expect(report.teamActivity).toEqual({
        membersAdded: 2,
        membersRemoved: 1,
        configChanges: 5,
        failedLogins: 9,
      });

      expect(mockDb.where).toHaveBeenCalledWith('organization_id', '=', 'org_1');
    });

    it('returns undefined teamActivity when every counter is zero', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'project_1' }]);

      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 });
      mockDb.executeTakeFirst.mockResolvedValueOnce({ count: 0 });
      mockDb.executeTakeFirst.mockResolvedValueOnce({
        members_added: 0,
        members_removed: 0,
        config_changes: 0,
        failed_logins: 0,
      });

      const report = await generator.buildReportData('org_1', 'Test Org', 'daily', {
        ...DIGEST_SECTION_DEFAULTS,
        teamActivity: true,
      });

      expect(report.teamActivity).toBeUndefined();
    });
  });
});
