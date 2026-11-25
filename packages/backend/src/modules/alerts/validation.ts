import type { LogLevel, MetadataFilter } from '@logtide/shared';
import type { AlertType } from '../../database/types.js';
import { compileAlertQuery, normalizeAlertQuery } from './alert-query.js';

/**
 * Invalid alert rule criteria. Routes answer `400 { error }`, plus
 * `position` when the message comes from the query parser.
 */
export class AlertRuleInputError extends Error {
  readonly position?: number;

  constructor(message: string, position?: number) {
    super(message);
    this.name = 'AlertRuleInputError';
    if (position !== undefined) this.position = position;
  }
}

export interface RuleCriteriaInput {
  alertType: AlertType;
  query: string | null;
  renotifyMinutes: number | null;
  level: LogLevel[];
  service: string | null;
  metadataFilters: MetadataFilter[];
}

/**
 * Lifecycle rules on top of the Zod schemas: `query` exists on threshold
 * rules only and `renotify_minutes` on threshold and metric rules (mirrors
 * chk_alert_rules_threshold_only), and
 * a query must parse. The grammar is the shared one; W8 adds no rejection of
 * its own, so a query contradicting the rule filters is accepted (it merges
 * to "match nothing").
 */
export function assertValidRuleCriteria(input: RuleCriteriaInput): void {
  const query = normalizeAlertQuery(input.query);

  if (input.alertType !== 'threshold') {
    if (query !== null) {
      throw new AlertRuleInputError('Text queries are only supported on threshold rules');
    }
    if (input.alertType !== 'metric' && input.renotifyMinutes !== null && input.renotifyMinutes !== undefined) {
      throw new AlertRuleInputError('Re-notify interval is only supported on threshold and metric rules');
    }
    return;
  }

  if (query === null) return;
  const compiled = compileAlertQuery({
    query,
    level: input.level,
    service: input.service,
    metadataFilters: input.metadataFilters,
  });
  if (!compiled.ok) {
    throw new AlertRuleInputError(compiled.error.message, compiled.error.position);
  }
}
