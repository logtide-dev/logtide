import type { LogInput, LogLevel } from '@logtide/shared';
import type { ReceiverAdapter } from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Uptime monitoring adapter (#155). Shape-detects two providers:
 *  - Uptime Robot: flat payload with alertType (1=down, 2=up, 3=ssl expiry)
 *  - Better Stack: { data: { type: 'incident', attributes: {...} } }
 */
export const uptimeAdapter: ReceiverAdapter = (payload, receiver) => {
  // Uptime Robot
  if ('alertType' in payload || 'monitorFriendlyName' in payload) {
    const alertType = Number(payload.alertType);
    const monitor = str(payload.monitorFriendlyName) ?? str(payload.monitorURL) ?? 'monitor';
    const details = str(payload.alertDetails);
    let level: LogLevel;
    let message: string;
    if (alertType === 1) {
      level = 'error';
      message = `Monitor ${monitor} is DOWN${details ? `: ${details}` : ''}`;
    } else if (alertType === 2) {
      level = 'info';
      message = `Monitor ${monitor} is UP${details ? `: ${details}` : ''}`;
    } else if (alertType === 3) {
      level = 'warn';
      message = `Monitor ${monitor} SSL certificate expiry${details ? `: ${details}` : ''}`;
    } else {
      return { kind: 'skipped', reason: `unknown uptime robot alertType "${String(payload.alertType)}"` };
    }
    const log: LogInput = {
      time: new Date().toISOString(),
      service: monitor.slice(0, 100),
      level,
      message,
      metadata: {
        receiver: { id: receiver.id, name: receiver.name, adapter: 'uptime' },
        provider: 'uptimerobot',
        monitor_id: payload.monitorID,
        monitor_url: payload.monitorURL,
        alert_type: str(payload.alertTypeFriendlyName) ?? alertType,
        details,
      },
    };
    return { kind: 'logs', logs: [log] };
  }

  // Better Stack
  const attributes = asRecord(asRecord(payload.data)?.attributes);
  if (attributes) {
    const status = (str(attributes.status) ?? '').toLowerCase();
    const monitor = str(attributes.name) ?? str(attributes.url) ?? 'monitor';
    const cause = str(attributes.cause) ?? 'unknown cause';
    let level: LogLevel;
    let message: string;
    if (status === 'started') {
      level = 'error';
      message = `Incident started: ${cause}`;
    } else if (status === 'resolved') {
      level = 'info';
      message = `Incident resolved: ${cause}`;
    } else if (status === 'acknowledged') {
      level = 'info';
      message = `Incident acknowledged: ${cause}`;
    } else {
      return { kind: 'skipped', reason: `unknown better stack incident status "${status}"` };
    }
    const log: LogInput = {
      time: new Date().toISOString(),
      service: monitor.slice(0, 100),
      level,
      message,
      metadata: {
        receiver: { id: receiver.id, name: receiver.name, adapter: 'uptime' },
        provider: 'betterstack',
        incident_id: asRecord(payload.data)?.id,
        status,
        cause,
        monitor_url: attributes.url,
        started_at: attributes.started_at,
        resolved_at: attributes.resolved_at,
      },
    };
    return { kind: 'logs', logs: [log] };
  }

  return { kind: 'skipped', reason: 'unrecognized uptime payload shape' };
};
