/**
 * Vendor neutral view of an outbound event envelope.
 *
 * Every vendor formatter (Discord, Slack, Teams) renders the same title,
 * description, tone, fields and link; only the wire shape differs. Keeping the
 * per-event-type switch here means a new event type is described once.
 */

export type Tone = 'critical' | 'high' | 'medium' | 'low' | 'neutral' | 'success';

export interface EventViewField {
  name: string;
  value: string;
}

export interface EventView {
  title: string;
  description?: string;
  tone: Tone;
  fields: EventViewField[];
  link?: string;
  occurredAt?: string;
  orgName?: string;
}

interface Envelope {
  type: string;
  occurredAt?: string;
  data: Record<string, unknown>;
}

/** Most fields any vendor renders (Discord and Slack both cap at 10). */
const MAX_FIELDS = 10;

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function field(name: string, value: unknown): EventViewField | null {
  const rendered = str(value);
  if (rendered === undefined) return null;
  return { name, value: rendered };
}

function push(fields: EventViewField[], candidate: EventViewField | null): void {
  if (candidate && fields.length < MAX_FIELDS) fields.push(candidate);
}

function isEnvelope(body: unknown): body is Envelope {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Envelope;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null
  );
}

/** Humanize an event type for the fallback title: monitor.status_changed -> Monitor status changed. */
function humanizeType(type: string): string {
  const words = type.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function severityTone(severity: unknown): Tone {
  const key = typeof severity === 'string' ? severity.toLowerCase() : '';
  if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low') return key;
  return 'neutral';
}

/** Pretty JSON for bodies that are not an envelope; never throws. */
export function rawJsonFallback(body: unknown): string {
  try {
    return JSON.stringify(body, null, 2) ?? String(body);
  } catch {
    return 'LogTide event (payload could not be rendered)';
  }
}

function describe(envelope: Envelope): EventView {
  const data = envelope.data;
  const organization = data.organization as { name?: unknown } | null | undefined;
  const fields: EventViewField[] = [];

  let title = str(data.title) ?? humanizeType(envelope.type);
  let description = str(data.message);
  let tone = severityTone(data.severity);

  switch (envelope.type) {
    case 'monitor.status_changed': {
      if (str(data.status) !== 'down') tone = 'success';
      push(fields, field('Status', data.status));
      push(fields, field('Target', data.target));
      push(fields, field('Error code', data.error_code));
      push(
        fields,
        field(
          'Response time',
          typeof data.response_time_ms === 'number' ? `${data.response_time_ms} ms` : null
        )
      );
      push(fields, field('Consecutive failures', data.consecutive_failures));
      push(fields, field('Downtime', data.downtime_duration));
      break;
    }
    case 'alert.triggered': {
      // This event carries no title/message/severity (alertTriggeredDataSchema).
      title = `Alert triggered: ${str(data.alert_name) ?? 'unnamed rule'}`;
      description = `${str(data.log_count) ?? '0'} logs in ${str(data.time_window) ?? '0'}s (threshold: ${str(data.threshold) ?? '0'})`;
      tone = 'high';
      const baseline = data.baseline_metadata as Record<string, unknown> | null;
      if (baseline) {
        push(fields, field('Baseline', baseline.baseline_value));
        push(fields, field('Current', baseline.current_value));
        push(fields, field('Deviation', baseline.deviation_ratio));
      }
      push(fields, field('Log count', data.log_count));
      push(fields, field('Threshold', data.threshold));
      push(
        fields,
        field('Time window', typeof data.time_window === 'number' ? `${data.time_window}s` : null)
      );
      break;
    }
    case 'alert.resolved': {
      title = `Alert resolved: ${str(data.alert_name) ?? 'unnamed rule'}`;
      description = str(data.message);
      tone = 'success';
      break;
    }
    case 'incident.created': {
      push(fields, field('Incident', data.incident_id));
      const services = data.affected_services;
      if (Array.isArray(services) && services.length > 0) {
        push(fields, field('Affected services', services.join(', ')));
      }
      break;
    }
    case 'error.detected': {
      const project = data.project as { name?: string } | undefined;
      push(fields, field('Project', project?.name));
      push(fields, field('Service', data.service));
      push(fields, field('Exception', data.exception_type));
      push(fields, field('Language', data.language));
      if (data.is_new === true) push(fields, field('New', 'yes'));
      break;
    }
    default: {
      const metadata = data.metadata;
      if (typeof metadata === 'object' && metadata !== null) {
        for (const [key, value] of Object.entries(metadata as Record<string, unknown>).slice(0, 5)) {
          push(fields, field(key, value));
        }
      }
      break;
    }
  }

  const view: EventView = { title, tone, fields };
  if (description) view.description = description;
  const link = str(data.link);
  if (link) view.link = link;
  if (typeof envelope.occurredAt === 'string') view.occurredAt = envelope.occurredAt;
  if (typeof organization?.name === 'string' && organization.name) view.orgName = organization.name;
  return view;
}

/** Describe an envelope; null when the body is not one. */
export function describeEvent(envelope: unknown): EventView | null {
  if (!isEnvelope(envelope)) return null;
  return describe(envelope);
}
