import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DigestGeneratorService } from '../../../modules/digests/generator.js';
import { db } from '../../../database/connection.js';
import { reservoir } from '../../../database/reservoir.js';
import { DIGEST_SECTION_KEYS } from '@logtide/shared';
import type { DigestSections } from '@logtide/shared';

// Hoisted: other modules in the generator's import graph build a transporter at
// module-init time, so the factory must not close over a plain const.
const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

describe('DigestGeneratorService Integration', () => {
  let generator: DigestGeneratorService;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    generator = new DigestGeneratorService();
  });

  /**
   * Integration test that validates the digest generation flow using the reservoir abstract engine to count logs from the database.
   */
  it('should correctly count log volume using reservoir abstract engine on database', async () => {
    // Create a user first (required for organization owner_id)
    const user = await db
      .insertInto('users')
      .values({
        email: 'test@example.com',
        password_hash: 'test_hash',
        name: 'Test User',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const org = await db
      .insertInto('organizations')
      .values({
        name: 'Test Org',
        slug: 'test-org',
        owner_id: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    
    const project = await db
      .insertInto('projects')
      .values({
        organization_id: org.id,
        name: 'Test Project',
        slug: 'test-project',
        user_id: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const config = await db
      .insertInto('digest_configs')
      .values({
        organization_id: org.id,
        frequency: 'daily',
        delivery_hour: 8,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('digest_recipients')
      .values({
        organization_id: org.id,
        digest_config_id: config.id,
        email: 'digest@example.com',
        unsubscribe_token: 'test_token',
      })
      .execute();

    const now = new Date();

    // Insert logs via reservoir.ingest() to test the production path
    
    const logsToIngest = [];
    for (let i = 0; i < 150; i++) {
        const isCurrentPeriod = i < 100;
        const baseTime = isCurrentPeriod 
          ? now.getTime() - (12 * 60 * 60 * 1000)  // Start 12 hours ago
          : now.getTime() - (36 * 60 * 60 * 1000); // Start 36 hours ago
        
        // Spread logs over 10 hours with 6-minute intervals
        const logTime = new Date(baseTime + (i % 100) * 6 * 60 * 1000);
        
        logsToIngest.push({
            organizationId: org.id,  // Required for digest queries to find the logs
            projectId: project.id,
            service: 'test-service',
            level: 'info' as const,
            message: `test log ${i}`,
            time: logTime
        });
    }

    await reservoir.ingest(logsToIngest);

    await generator.generateAndSendDigest({
      organizationId: org.id,
      digestConfigId: config.id,
      frequency: 'daily',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);

    const emailCall = mockSendMail.mock.calls[0][0];
    const emailText = emailCall.text;

    // More robust assertions that check for exact metric lines
    const currentLogCount = 100;
    const previousLogCount = 50;
    const expectedDelta = currentLogCount - previousLogCount;
    const expectedPercentChange = ((expectedDelta / previousLogCount) * 100).toFixed(1);
    
    // Extract the metrics from the email to avoid fragile substring matching
    const totalLogsMatch = emailText.match(/Total logs:\s+(\d+)/);
    const previousPeriodMatch = emailText.match(/Previous period:\s+(\d+)/);
    const trendMatch = emailText.match(/Trend:\s+([+-]\d+)\s+\(([+-][\d.]+)%\)/);
    
    expect(totalLogsMatch, 'Email should contain "Total logs" metric').toBeTruthy();
    expect(totalLogsMatch![1]).toBe(String(currentLogCount));
    
    expect(previousPeriodMatch, 'Email should contain "Previous period" metric').toBeTruthy();
    expect(previousPeriodMatch![1]).toBe(String(previousLogCount));
    
    expect(trendMatch, 'Email should contain "Trend" metric').toBeTruthy();
    expect(trendMatch![1]).toBe(`+${expectedDelta}`);

    expect(trendMatch![2]).toBe(`+${expectedPercentChange}`);
  });

  it('should include error groups, security and uptime sections in the digest', async () => {
    const user = await db
      .insertInto('users')
      .values({
        email: 'sections@example.com',
        password_hash: 'test_hash',
        name: 'Sections User',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const org = await db
      .insertInto('organizations')
      .values({
        name: 'Sections Org',
        slug: 'sections-org',
        owner_id: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const project = await db
      .insertInto('projects')
      .values({
        organization_id: org.id,
        name: 'Sections Project',
        slug: 'sections-project',
        user_id: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const config = await db
      .insertInto('digest_configs')
      .values({
        organization_id: org.id,
        frequency: 'daily',
        delivery_hour: 8,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('digest_recipients')
      .values({
        organization_id: org.id,
        digest_config_id: config.id,
        email: 'sections-digest@example.com',
        unsubscribe_token: 'sections_token',
      })
      .execute();

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // New error group first seen inside the period
    await db
      .insertInto('error_groups')
      .values({
        organization_id: org.id,
        project_id: project.id,
        fingerprint: 'fp_sections_1',
        exception_type: 'TypeError',
        exception_message: 'Cannot read properties of undefined',
        language: 'nodejs',
        occurrence_count: 42,
        first_seen: twoHoursAgo,
        last_seen: now,
      })
      .execute();

    // Sigma rule + detections inside the period
    const rule = await db
      .insertInto('sigma_rules')
      .values({
        organization_id: org.id,
        title: 'Suspicious Login Burst',
        level: 'high',
        status: 'stable',
        logsource: JSON.stringify({ product: 'test' }),
        detection: JSON.stringify({ condition: 'selection' }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('detection_events')
      .values([1, 2, 3].map(() => ({
        time: twoHoursAgo,
        organization_id: org.id,
        project_id: project.id,
        sigma_rule_id: rule.id,
        log_id: crypto.randomUUID(),
        severity: 'high',
        rule_title: 'Suspicious Login Burst',
        service: 'auth-service',
        log_level: 'warn',
        log_message: 'failed login',
      })))
      .execute();

    // Open incident
    await db
      .insertInto('incidents')
      .values({
        organization_id: org.id,
        project_id: project.id,
        title: 'Brute force attempt',
        severity: 'high',
        status: 'open',
      })
      .execute();

    // Monitor with mixed up/down results in the period
    const monitor = await db
      .insertInto('monitors')
      .values({
        organization_id: org.id,
        project_id: project.id,
        name: 'API Health',
        type: 'http',
        target: 'https://example.com/health',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push({
        time: new Date(twoHoursAgo.getTime() + i * 60 * 1000),
        monitor_id: monitor.id,
        organization_id: org.id,
        project_id: project.id,
        status: i === 0 ? ('down' as const) : ('up' as const),
      });
    }
    await db.insertInto('monitor_results').values(results).execute();

    await generator.generateAndSendDigest({
      organizationId: org.id,
      digestConfigId: config.id,
      frequency: 'daily',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendMail.mock.calls[0][0];
    const text = emailCall.text as string;
    const html = emailCall.html as string;

    // New error group section
    expect(text).toContain('TypeError');
    expect(text).toContain('Cannot read properties of undefined');
    expect(text).toContain('42');

    // Security section (3 detections, top rule, 1 open incident)
    expect(text).toContain('Detections: 3');
    expect(text).toContain('Suspicious Login Burst');
    expect(text).toContain('Open incidents: 1');

    // Uptime section (9 up / 10 checks = 90%)
    expect(text).toContain('UPTIME');
    expect(text).toContain('API Health');
    expect(text).toContain('90%');

    // HTML version carries the same content and the unsubscribe link
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('TypeError');
    expect(html).toContain('Suspicious Login Burst');
    expect(html).toContain('unsubscribe?token=sections_token');
  });

  it('renders only the expanded sections that carry data when every section is enabled', async () => {
    const user = await db
      .insertInto('users')
      .values({
        email: 'expanded@example.com',
        password_hash: 'test_hash',
        name: 'Expanded User',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const org = await db
      .insertInto('organizations')
      .values({
        name: 'Expanded Org',
        slug: 'expanded-org',
        owner_id: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const project = await db
      .insertInto('projects')
      .values({
        organization_id: org.id,
        name: 'Expanded Project',
        slug: 'expanded-project',
        user_id: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const config = await db
      .insertInto('digest_configs')
      .values({
        organization_id: org.id,
        frequency: 'daily',
        delivery_hour: 8,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('digest_recipients')
      .values({
        organization_id: org.id,
        digest_config_id: config.id,
        email: 'expanded-digest@example.com',
        unsubscribe_token: 'expanded_token',
      })
      .execute();

    const now = new Date();
    // Every seeded row is aged explicitly: the digest window ends at the node
    // clock's "now", so rows written with the Postgres default created_at can
    // land after the window when the two clocks drift.
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Logs: feeds logVolume, logBreakdown and topErrorMessages
    await reservoir.ingest(
      Array.from({ length: 10 }, (_, i) => ({
        organizationId: org.id,
        projectId: project.id,
        service: 'expanded-service',
        level: (i < 2 ? 'error' : 'info') as 'error' | 'info',
        message: i < 2 ? 'db connection refused' : `expanded log ${i}`,
        time: oneHourAgo,
      }))
    );

    // Alert rule + one trigger inside the period
    const rule = await db
      .insertInto('alert_rules')
      .values({
        organization_id: org.id,
        project_id: project.id,
        name: 'Expanded Error Spike',
        level: ['error'],
        time_window: 5,
        threshold: 10,
        enabled: true,
        alert_type: 'threshold',
        email_recipients: [],
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('alert_history')
      .values({
        rule_id: rule.id,
        triggered_at: oneHourAgo,
        log_count: 25,
        notified: true,
      })
      .execute();

    // Incident opened inside the period: feeds securityActivity
    await db
      .insertInto('incidents')
      .values({
        organization_id: org.id,
        project_id: project.id,
        title: 'Expanded incident',
        severity: 'high',
        status: 'open',
        created_at: oneHourAgo,
      })
      .execute();

    // Webhook delivery created inside the period
    await db
      .insertInto('webhook_deliveries')
      .values({
        organization_id: org.id,
        event_type: 'alert.triggered',
        event_id: 'expanded-event-1',
        url: 'https://example.com/hook',
        status: 'delivered',
        attempt_count: 1,
        max_attempts: 5,
        metadata: null,
        created_at: oneHourAgo,
      })
      .execute();

    // Audit row: feeds teamActivity (config_change category)
    await db
      .insertInto('audit_log')
      .values({
        time: oneHourAgo,
        organization_id: org.id,
        user_id: user.id,
        user_email: 'expanded@example.com',
        action: 'digest.config_updated',
        category: 'config_change',
        resource_type: 'digest_config',
        resource_id: config.id,
        ip_address: null,
        user_agent: null,
        metadata: null,
      })
      .execute();

    const allSections = Object.fromEntries(
      DIGEST_SECTION_KEYS.map((key) => [key, true])
    ) as DigestSections;

    await generator.generateAndSendDigest({
      organizationId: org.id,
      digestConfigId: config.id,
      frequency: 'daily',
      sections: allSections,
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendMail.mock.calls[0][0];
    const html = emailCall.html as string;
    const text = emailCall.text as string;

    // Sections with seeded data render
    for (const title of [
      'Log Breakdown',
      'Top Error Messages',
      'Alerts',
      'Security Activity',
      'Webhooks',
      'Team Activity',
    ]) {
      expect(html, `html should contain the ${title} section`).toContain(title);
    }

    expect(text).toContain('error: 2');
    expect(text).toContain('db connection refused');
    expect(text).toContain('Triggers: 1');
    expect(text).toContain('Expanded Error Spike: 1 triggers');
    expect(text).toContain('Incidents opened: 1');
    expect(text).toContain('Delivered: 1');
    expect(text).toContain('Config changes: 1');

    // Nothing was seeded for these verticals, so they are skipped entirely
    for (const title of ['Traces', 'Metrics', 'Monitor Performance', 'Usage']) {
      expect(html, `html should omit the ${title} section`).not.toContain(title);
    }
  });
});
