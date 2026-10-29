import type { DetectionEvent, ExceptionCondition } from '@logtide/shared';

const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MAX_VALUE_LENGTH = 200;
const MAX_EXTRA_CONDITIONS = 2;

/**
 * Starting point for the "mark as false positive" flow: the service of the
 * detection plus up to two scalar matched fields, all with `equals`.
 */
export function exceptionPrefillFromDetection(
  d: Pick<DetectionEvent, 'service' | 'matchedFields' | 'projectId'>
): { conditions: ExceptionCondition[]; reason: string } {
  const conditions: ExceptionCondition[] = [];

  if (d.service) {
    conditions.push({ field: 'service', operator: 'equals', values: [d.service] });
  }

  let extra = 0;
  for (const [field, value] of Object.entries(d.matchedFields ?? {})) {
    if (extra >= MAX_EXTRA_CONDITIONS) break;
    if (field === 'service' || !FIELD_PATTERN.test(field)) continue;
    if (typeof value !== 'string') continue;
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH) continue;
    conditions.push({ field, operator: 'equals', values: [value] });
    extra++;
  }

  return { conditions, reason: 'Marked as false positive' };
}
