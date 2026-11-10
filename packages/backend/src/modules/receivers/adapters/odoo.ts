import type { LogInput, LogLevel } from '@logtide/shared';
import type { ReceiverAdapter } from './types.js';

// State values that read as a problem in Odoo workflows. Everything else is info.
const WARN_STATES = new Set(['cancel', 'cancelled', 'error', 'failed', 'exception']);

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Odoo adapter (#155). Odoo 17+ Automated Actions with "Send Webhook
 * Notification" POST the selected record fields plus _id, _model, _name
 * (display name) and _action. Many2one values arrive as [id, "Name"] and are
 * kept as-is.
 *
 * Level: the receiver's fieldMapping.levelMap is matched against `state`
 * first; otherwise a state in WARN_STATES gives `warn`, else
 * fieldMapping.defaults.level, else `info`.
 * Service: fieldMapping.defaults.service, else `odoo`.
 */
export const odooAdapter: ReceiverAdapter = (payload, receiver) => {
  const model = str(payload._model);
  if (!model) {
    return { kind: 'skipped', reason: 'odoo payload is missing _model' };
  }

  const mapping = receiver.fieldMapping ?? {};
  const id = payload._id;
  const displayName = str(payload._name);
  const state = str(payload.state);

  const label = displayName ?? (id !== undefined && id !== null ? `#${String(id)}` : '');
  const message = `${model}${label ? ` ${label}` : ''}${state ? ` → ${state}` : ''}`;

  let level: LogLevel = mapping.defaults?.level ?? 'info';
  if (state) {
    const raw = state.toLowerCase();
    const mapped = mapping.levelMap
      ? Object.entries(mapping.levelMap).find(([key]) => key.toLowerCase() === raw)?.[1]
      : undefined;
    if (mapped) level = mapped;
    else if (WARN_STATES.has(raw)) level = 'warn';
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('_')) fields[key] = value;
  }

  const log: LogInput = {
    time: new Date().toISOString(),
    service: (mapping.defaults?.service ?? 'odoo').slice(0, 100),
    level,
    message,
    metadata: {
      receiver: { id: receiver.id, name: receiver.name, adapter: 'odoo' },
      odoo: {
        model,
        id,
        display_name: displayName,
        action: str(payload._action),
        fields,
      },
    },
  };
  return { kind: 'logs', logs: [log] };
};
