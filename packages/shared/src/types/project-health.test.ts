import { describe, it, expect } from 'vitest';
import {
  PROJECT_HEALTH_CHECKS,
  PROJECT_HEALTH_SILENT_DEFAULT_MINUTES,
  PROJECT_HEALTH_SILENT_MIN_MINUTES,
  PROJECT_HEALTH_SILENT_MAX_MINUTES,
  type ProjectHealthCheckKey,
} from './project-health.js';
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_EVENT_LABELS } from './notification-channel.js';
import { NOTIFICATION_ROUTING_EVENT_TYPES } from './notification-routing.js';
import { parseWebhookEvent } from '../schemas/webhook-events.js';

describe('project health catalog', () => {
  const keys = Object.keys(PROJECT_HEALTH_CHECKS) as ProjectHealthCheckKey[];

  it('has all six checks with a title', () => {
    expect(keys.sort()).toEqual(
      ['pii_rejected', 'revoked_key', 'silent', 'timestamp_skew_logs', 'timestamp_skew_metrics', 'timestamp_skew_spans'].sort()
    );
    for (const k of keys) expect(PROJECT_HEALTH_CHECKS[k].title.length).toBeGreaterThan(0);
  });

  it('silent and pii_rejected are critical, the rest warning', () => {
    expect(PROJECT_HEALTH_CHECKS.silent.severity).toBe('critical');
    expect(PROJECT_HEALTH_CHECKS.pii_rejected.severity).toBe('critical');
    for (const k of keys.filter((x) => x !== 'silent' && x !== 'pii_rejected')) {
      expect(PROJECT_HEALTH_CHECKS[k].severity).toBe('warning');
    }
  });

  it('exposes silent threshold bounds', () => {
    expect(PROJECT_HEALTH_SILENT_MIN_MINUTES).toBe(10);
    expect(PROJECT_HEALTH_SILENT_DEFAULT_MINUTES).toBe(60);
    expect(PROJECT_HEALTH_SILENT_MAX_MINUTES).toBe(1440);
  });

  it('registers project_health as a notification event type', () => {
    expect(NOTIFICATION_EVENT_TYPES).toContain('project_health');
    expect(NOTIFICATION_ROUTING_EVENT_TYPES).toContain('project_health');
    expect(NOTIFICATION_EVENT_LABELS.project_health).toBe('Project health');
  });

  it('parses project.health webhook events', () => {
    const data = {
      project_id: '11111111-1111-4111-8111-111111111111',
      project_name: 'p',
      check_key: 'silent',
      severity: 'critical',
      title: 't',
      message: 'm',
      opened_at: '2026-10-28T10:00:00.000Z',
      resolved_at: null,
      details: {},
      link: 'https://x/y',
    };
    for (const type of ['project.health.opened', 'project.health.resolved']) {
      expect(
        parseWebhookEvent({
          id: 'evt_11111111-1111-4111-8111-111111111111',
          type,
          version: 1,
          occurredAt: '2026-10-28T10:00:00.000Z',
          organizationId: '11111111-1111-4111-8111-111111111111',
          projectId: '11111111-1111-4111-8111-111111111111',
          data,
        }).type
      ).toBe(type);
    }
  });
});
