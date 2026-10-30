import { describe, it, expect } from 'vitest';
import {
  webhookEnvelopeSchema,
  alertTriggeredDataSchema,
  errorDetectedDataSchema,
  monitorStatusChangedDataSchema,
  incidentCreatedDataSchema,
  channelNotificationDataSchema,
  alertResolvedDataSchema,
  webhookEventTypeSchema,
  WEBHOOK_EVENT_DATA_SCHEMAS,
  parseWebhookEvent,
} from './webhook-events.js';

const ORG_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const PROJ_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const EVT_ID = `evt_c3d4e5f6-a7b8-9012-cdef-123456789012`;

// shared base envelope fields
const baseEnvelope = {
  id: EVT_ID,
  version: 1 as const,
  occurredAt: '2026-06-11T10:00:00.000Z',
  organizationId: ORG_ID,
  projectId: PROJ_ID,
};

describe('webhookEnvelopeSchema', () => {
  it('round-trips an alert.triggered envelope', () => {
    const obj = {
      ...baseEnvelope,
      type: 'alert.triggered',
      data: {
        alert_name: 'High error rate',
        log_count: 42,
        threshold: 10,
        time_window: 60,
        baseline_metadata: null,
        link: 'https://app.logtide.dev/dashboard/alerts',
      },
    };
    const parsed = webhookEnvelopeSchema.parse(obj);
    expect(parsed.type).toBe('alert.triggered');
    expect(parsed.id).toBe(EVT_ID);
    expect(parsed.version).toBe(1);
    expect(parsed.organizationId).toBe(ORG_ID);
  });

  it('round-trips an incident.created envelope', () => {
    const obj = {
      ...baseEnvelope,
      type: 'incident.created',
      data: {
        title: 'SQL injection attempt',
        message: 'Multiple SQL injection attempts detected',
        severity: 'critical',
        organization: { id: ORG_ID, name: 'Acme Corp' },
        incident_id: 'inc_abc123',
        affected_services: ['api', 'db'],
        link: 'https://app.logtide.dev/dashboard/security/incidents/inc_abc123',
      },
    };
    const parsed = webhookEnvelopeSchema.parse(obj);
    expect(parsed.type).toBe('incident.created');
  });

  it('round-trips an error.detected envelope', () => {
    const obj = {
      ...baseEnvelope,
      type: 'error.detected',
      data: {
        title: 'New Error: TypeError',
        message: 'Cannot read property of undefined',
        severity: 'high',
        organization: { id: ORG_ID, name: 'Acme Corp' },
        project: { id: PROJ_ID, name: 'my-app' },
        error_group_id: 'eg_xyz789',
        exception_type: 'TypeError',
        language: 'javascript',
        service: 'api',
        is_new: true,
        link: 'https://app.logtide.dev/dashboard/errors/eg_xyz789',
      },
    };
    const parsed = webhookEnvelopeSchema.parse(obj);
    expect(parsed.type).toBe('error.detected');
  });

  it('round-trips a monitor.status_changed envelope', () => {
    const obj = {
      ...baseEnvelope,
      type: 'monitor.status_changed',
      data: {
        monitor_id: 'mon_123',
        monitor_name: 'API health check',
        status: 'down',
        severity: 'critical',
        title: 'Monitor down: API health check',
        message: 'API health check is not responding (HTTP 503)',
        organization: { id: ORG_ID, name: 'Acme Corp' },
        target: 'https://api.example.com/health',
        error_code: 'HTTP_503',
        response_time_ms: null,
        consecutive_failures: 3,
        downtime_duration: null,
        link: 'https://app.logtide.dev/dashboard/uptime',
      },
    };
    const parsed = webhookEnvelopeSchema.parse(obj);
    expect(parsed.type).toBe('monitor.status_changed');
  });

  it('round-trips a channel.test envelope', () => {
    const obj = {
      ...baseEnvelope,
      projectId: null,
      type: 'channel.test',
      data: {
        title: 'Test Notification',
        message: 'This is a test notification from LogTide.',
        severity: 'informational',
        organization: { id: ORG_ID, name: 'Test Organization' },
        link: undefined,
        metadata: {},
      },
    };
    const parsed = webhookEnvelopeSchema.parse(obj);
    expect(parsed.type).toBe('channel.test');
    expect(parsed.projectId).toBeNull();
  });

  it('rejects wrong version', () => {
    const obj = { ...baseEnvelope, type: 'alert.triggered', version: 2, data: {} };
    expect(() => webhookEnvelopeSchema.parse(obj)).toThrow();
  });

  it('rejects id missing evt_ prefix', () => {
    const obj = { ...baseEnvelope, id: 'c3d4e5f6-a7b8-9012-cdef-123456789012', type: 'alert.triggered', data: {} };
    expect(() => webhookEnvelopeSchema.parse(obj)).toThrow();
  });

  it('rejects invalid event type string', () => {
    const obj = { ...baseEnvelope, type: 'alert', data: {} };
    expect(() => webhookEnvelopeSchema.parse(obj)).toThrow();
  });

  it('rejects non-uuid organizationId', () => {
    const obj = { ...baseEnvelope, organizationId: 'not-a-uuid', type: 'alert.triggered', data: {} };
    expect(() => webhookEnvelopeSchema.parse(obj)).toThrow();
  });

  it('rejects missing occurredAt', () => {
    const { occurredAt: _omit, ...rest } = baseEnvelope;
    const obj = { ...rest, type: 'alert.triggered', data: {} };
    expect(() => webhookEnvelopeSchema.parse(obj)).toThrow();
  });
});

describe('alertTriggeredDataSchema', () => {
  const valid = {
    alert_name: 'High error rate',
    log_count: 42,
    threshold: 10,
    time_window: 60,
    baseline_metadata: null,
    link: 'https://app.logtide.dev/dashboard/alerts',
  };

  it('parses a valid alert payload', () => {
    const result = alertTriggeredDataSchema.parse(valid);
    expect(result.alert_name).toBe('High error rate');
    expect(result.baseline_metadata).toBeNull();
  });

  it('accepts baseline_metadata object when present', () => {
    const withBaseline = {
      ...valid,
      baseline_metadata: {
        baseline_value: 5,
        current_value: 42,
        deviation_ratio: 8.4,
        baseline_type: 'rolling_avg',
        evaluation_time: '2026-06-11T10:00:00Z',
      },
    };
    const result = alertTriggeredDataSchema.parse(withBaseline);
    expect(result.baseline_metadata?.deviation_ratio).toBe(8.4);
  });

  it('rejects missing alert_name', () => {
    const { alert_name: _omit, ...rest } = valid;
    expect(() => alertTriggeredDataSchema.parse(rest)).toThrow();
  });
});

describe('errorDetectedDataSchema', () => {
  const valid = {
    title: 'New Error: TypeError',
    message: 'Cannot read property of undefined',
    severity: 'high',
    organization: { id: ORG_ID, name: 'Acme Corp' },
    project: { id: PROJ_ID, name: 'my-app' },
    error_group_id: 'eg_xyz789',
    exception_type: 'TypeError',
    language: 'javascript',
    service: 'api',
    is_new: true,
    link: 'https://app.logtide.dev/dashboard/errors/eg_xyz789',
  };

  it('parses a valid error payload', () => {
    const result = errorDetectedDataSchema.parse(valid);
    expect(result.error_group_id).toBe('eg_xyz789');
    expect(result.is_new).toBe(true);
  });

  it('accepts null exception_type and language', () => {
    const result = errorDetectedDataSchema.parse({
      ...valid,
      exception_type: null,
      language: null,
    });
    expect(result.exception_type).toBeNull();
  });

  it('accepts null project id (projectId can be null in job data)', () => {
    const result = errorDetectedDataSchema.parse({
      ...valid,
      project: { id: null, name: 'my-app' },
    });
    expect(result.project?.id).toBeNull();
  });

  it('rejects missing title', () => {
    const { title: _omit, ...rest } = valid;
    expect(() => errorDetectedDataSchema.parse(rest)).toThrow();
  });
});

describe('monitorStatusChangedDataSchema', () => {
  const valid = {
    monitor_id: 'mon_123',
    monitor_name: 'API health check',
    status: 'down',
    severity: 'critical',
    title: 'Monitor down: API health check',
    message: 'API health check is not responding',
    organization: { id: ORG_ID, name: 'Acme Corp' },
    target: 'https://api.example.com/health',
    error_code: 'HTTP_503',
    response_time_ms: null,
    consecutive_failures: 3,
    downtime_duration: null,
    link: 'https://app.logtide.dev/dashboard/uptime',
  };

  it('parses a valid monitor payload', () => {
    const result = monitorStatusChangedDataSchema.parse(valid);
    expect(result.monitor_id).toBe('mon_123');
    expect(result.response_time_ms).toBeNull();
  });

  it('rejects missing monitor_id', () => {
    const { monitor_id: _omit, ...rest } = valid;
    expect(() => monitorStatusChangedDataSchema.parse(rest)).toThrow();
  });
});

describe('incidentCreatedDataSchema', () => {
  const valid = {
    title: 'SQL injection attempt',
    message: 'Multiple SQL injection attempts detected',
    severity: 'critical',
    organization: { id: ORG_ID, name: 'Acme Corp' },
    incident_id: 'inc_abc123',
    affected_services: ['api', 'db'],
    link: 'https://app.logtide.dev/dashboard/security/incidents/inc_abc123',
  };

  it('parses a valid incident payload', () => {
    const result = incidentCreatedDataSchema.parse(valid);
    expect(result.incident_id).toBe('inc_abc123');
    expect(result.affected_services).toEqual(['api', 'db']);
  });

  it('rejects missing title', () => {
    const { title: _omit, ...rest } = valid;
    expect(() => incidentCreatedDataSchema.parse(rest)).toThrow();
  });
});

describe('channelNotificationDataSchema', () => {
  const valid = {
    title: 'Test Notification',
    message: 'This is a test notification.',
    severity: 'informational',
    organization: { id: ORG_ID, name: 'Test Organization' },
    link: 'https://app.logtide.dev',
    metadata: { foo: 'bar' },
  };

  it('parses a valid channel test payload', () => {
    const result = channelNotificationDataSchema.parse(valid);
    expect(result.title).toBe('Test Notification');
  });

  it('accepts minimal payload (title + message required, rest optional)', () => {
    const result = channelNotificationDataSchema.parse({
      title: 'Test',
      message: 'Hello',
    });
    expect(result.title).toBe('Test');
  });

  it('rejects missing message', () => {
    const { message: _omit, ...rest } = valid;
    expect(() => channelNotificationDataSchema.parse(rest)).toThrow();
  });
});

describe('channel.notification round-trip', () => {
  it('parseWebhookEvent accepts a channel.notification envelope', () => {
    const envelope = {
      id: EVT_ID,
      type: 'channel.notification',
      version: 1 as const,
      occurredAt: '2026-06-11T10:00:00.000Z',
      organizationId: ORG_ID,
      projectId: null,
      data: {
        title: 'Alert fired',
        message: 'Error rate exceeded threshold',
        severity: 'high',
        organization: { id: ORG_ID, name: 'Acme Corp' },
        link: 'https://app.logtide.dev/dashboard/alerts',
        metadata: { rule_id: 'abc123' },
      },
    };
    const result = parseWebhookEvent(envelope);
    expect(result.type).toBe('channel.notification');
    expect(result.data).toMatchObject({ title: 'Alert fired', severity: 'high' });
  });

  it('parseWebhookEvent accepts channel.notification with minimal data', () => {
    const envelope = {
      id: EVT_ID,
      type: 'channel.notification',
      version: 1 as const,
      occurredAt: '2026-06-11T10:00:00.000Z',
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      data: {
        title: 'Test',
        message: 'Hello',
      },
    };
    const result = parseWebhookEvent(envelope);
    expect(result.type).toBe('channel.notification');
  });
});

describe('parseWebhookEvent', () => {
  it('narrows data for alert.triggered', () => {
    const envelope = {
      id: EVT_ID,
      type: 'alert.triggered',
      version: 1 as const,
      occurredAt: '2026-06-11T10:00:00.000Z',
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      data: {
        alert_name: 'High error rate',
        log_count: 42,
        threshold: 10,
        time_window: 60,
        baseline_metadata: null,
        link: 'https://app.logtide.dev/dashboard/alerts',
      },
    };
    const result = parseWebhookEvent(envelope);
    expect(result.type).toBe('alert.triggered');
    expect(result.data).toMatchObject({ alert_name: 'High error rate' });
  });

  it('throws when envelope is valid but data fails per-type schema', () => {
    const envelope = {
      id: EVT_ID,
      type: 'alert.triggered',
      version: 1 as const,
      occurredAt: '2026-06-11T10:00:00.000Z',
      organizationId: ORG_ID,
      projectId: null,
      // missing required fields in data
      data: { some_field: 'irrelevant' },
    };
    expect(() => parseWebhookEvent(envelope)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1.6 alert lifecycle: alert.resolved and the new optional alert.triggered fields
// ---------------------------------------------------------------------------

const RULE_ID = 'c3d4e5f6-a7b8-4012-8def-123456789abc';
const INCIDENT_ID = 'd4e5f6a7-b8c9-4123-9ef0-23456789abcd';
const ISO = '2026-10-21T10:00:00.000Z';

const validResolved = {
  alert_rule_id: RULE_ID,
  alert_name: 'High error rate',
  alert_type: 'threshold' as const,
  title: 'Resolved: High error rate',
  message: 'High error rate is back to OK after 6 minutes',
  log_count: 1,
  threshold: 10,
  time_window: 5,
  firing_since: ISO,
  resolved_at: '2026-10-21T10:06:00.000Z',
  duration_seconds: 360,
  incident_id: INCIDENT_ID,
  link: 'https://app.logtide.dev/dashboard/incidents/' + INCIDENT_ID,
};

const legacyTriggered = {
  alert_name: 'High error rate',
  log_count: 42,
  threshold: 10,
  time_window: 60,
  baseline_metadata: null,
  link: 'https://app.logtide.dev/dashboard/alerts',
};

describe('alertResolvedDataSchema', () => {
  it('parses a valid resolved payload', () => {
    expect(alertResolvedDataSchema.parse(validResolved)).toMatchObject({ alert_rule_id: RULE_ID });
  });

  it('rejects a missing alert_rule_id', () => {
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, alert_rule_id: undefined })).toThrow();
  });

  it('rejects a non-uuid alert_rule_id', () => {
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, alert_rule_id: 'rule-1' })).toThrow();
  });

  it('accepts a null incident_id', () => {
    expect(alertResolvedDataSchema.parse({ ...validResolved, incident_id: null }).incident_id).toBeNull();
  });

  it('accepts the rate_of_change alert type and rejects unknown types', () => {
    expect(alertResolvedDataSchema.parse({ ...validResolved, alert_type: 'rate_of_change' }).alert_type).toBe(
      'rate_of_change'
    );
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, alert_type: 'sigma' })).toThrow();
  });

  it('rejects a negative or fractional duration_seconds', () => {
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, duration_seconds: -1 })).toThrow();
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, duration_seconds: 1.5 })).toThrow();
  });

  it('rejects non-datetime firing_since and resolved_at', () => {
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, firing_since: 'yesterday' })).toThrow();
    expect(() => alertResolvedDataSchema.parse({ ...validResolved, resolved_at: 'now' })).toThrow();
  });

  it('keeps unknown fields (passthrough)', () => {
    const parsed = alertResolvedDataSchema.parse({ ...validResolved, extra: 'kept' }) as Record<string, unknown>;
    expect(parsed.extra).toBe('kept');
  });
});

describe('alert.resolved event type', () => {
  it('is part of the event type enum and has a data schema', () => {
    expect(webhookEventTypeSchema.parse('alert.resolved')).toBe('alert.resolved');
    expect(WEBHOOK_EVENT_DATA_SCHEMAS['alert.resolved']).toBe(alertResolvedDataSchema);
  });

  it('parseWebhookEvent accepts an alert.resolved envelope', () => {
    expect(parseWebhookEvent({ ...baseEnvelope, type: 'alert.resolved', data: validResolved }).type).toBe(
      'alert.resolved'
    );
  });

  it('parseWebhookEvent rejects an alert.resolved envelope with triggered data', () => {
    expect(() => parseWebhookEvent({ ...baseEnvelope, type: 'alert.resolved', data: legacyTriggered })).toThrow();
  });
});

describe('alert.triggered 1.6 optional fields', () => {
  it('alert.triggered still parses without the 1.6 fields and with them', () => {
    expect(alertTriggeredDataSchema.parse(legacyTriggered)).toBeTruthy();
    expect(
      alertTriggeredDataSchema.parse({
        ...legacyTriggered,
        alert_rule_id: RULE_ID,
        renotify: true,
        firing_since: ISO,
        incident_id: null,
      })
    ).toBeTruthy();
    expect(alertTriggeredDataSchema.parse({ ...legacyTriggered, incident_id: INCIDENT_ID }).incident_id).toBe(
      INCIDENT_ID
    );
  });

  it('validates the 1.6 fields when present', () => {
    expect(() => alertTriggeredDataSchema.parse({ ...legacyTriggered, alert_rule_id: 'nope' })).toThrow();
    expect(() => alertTriggeredDataSchema.parse({ ...legacyTriggered, renotify: 'yes' })).toThrow();
    expect(() => alertTriggeredDataSchema.parse({ ...legacyTriggered, firing_since: 'soon' })).toThrow();
  });
});
