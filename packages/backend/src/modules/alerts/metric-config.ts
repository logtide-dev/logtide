import { z } from 'zod';
import {
  METRIC_ALERT_CONDITIONS,
  METRIC_ALERT_MAX_EVALUATIONS,
  METRIC_ALERT_MIN_EVALUATIONS,
  METRIC_ALERT_WINDOWS,
  SEVERITIES,
  metricAlertTarget,
  type MetricAlertConfig,
  type MetricExplorerQuery,
} from '@logtide/shared';
import { metricExplorerQuerySchema } from '../metrics/query/schema.js';
import { formulaRefs, parseFormula } from '../metrics/query/formula.js';
import { variableName } from '../metrics/query/variables.js';
import { AlertRuleInputError } from './validation.js';

/**
 * Zod shape of a metric alert rule definition (`alert_rules.metric_config`).
 * The explorer query is the shared one; the cross-field rules (exactly one
 * visible query or formula, formula operands exist, no dashboard variables)
 * live in assertValidMetricConfig so they answer 400 with a plain message.
 */
export const metricAlertConfigSchema = z.object({
  query: metricExplorerQuerySchema,
  condition: z.enum(METRIC_ALERT_CONDITIONS as unknown as [string, ...string[]]),
  threshold: z.number().finite(),
  window: z.enum(METRIC_ALERT_WINDOWS as unknown as [string, ...string[]]),
  forEvaluations: z.number().int().min(METRIC_ALERT_MIN_EVALUATIONS).max(METRIC_ALERT_MAX_EVALUATIONS),
  severity: z.enum(SEVERITIES).default('high'),
});

/**
 * Cross-field checks of a metric alert definition. Throws AlertRuleInputError
 * (routes answer 400).
 */
export function assertValidMetricConfig(config: MetricAlertConfig): void {
  const query = config.query;
  const target = metricAlertTarget(query);
  if (!target) {
    throw new AlertRuleInputError(
      'A metric alert watches exactly one visible query or formula: hide the other queries'
    );
  }

  const queryIds = new Set(query.queries.map((q) => q.id));
  for (const f of query.formulas ?? []) {
    // Hidden formulas are useless to the rule but harmless; every formula must still parse.
    let refs: string[];
    try {
      refs = formulaRefs(parseFormula(f.expression));
    } catch (err) {
      throw new AlertRuleInputError(`Formula ${f.id}: ${err instanceof Error ? err.message : 'invalid expression'}`);
    }
    for (const ref of refs) {
      if (!queryIds.has(ref)) throw new AlertRuleInputError(`Formula ${f.id} references unknown query ${ref}`);
    }
  }

  for (const q of query.queries) {
    for (const filter of q.filters ?? []) {
      if ((filter.values ?? []).some((v) => variableName(v) !== null)) {
        throw new AlertRuleInputError('Dashboard variables are not supported in alert queries');
      }
    }
  }
}

/**
 * Parse and validate a metric alert definition from a request body. Zod
 * errors propagate as ZodError, cross-field errors as AlertRuleInputError.
 */
export function parseMetricAlertConfig(raw: unknown): MetricAlertConfig {
  const parsed = metricAlertConfigSchema.parse(raw) as unknown as MetricAlertConfig;
  assertValidMetricConfig(parsed);
  return parsed;
}

/** The query the evaluator runs: the stored one without display-only parts. */
export function evaluationQuery(query: MetricExplorerQuery): MetricExplorerQuery {
  return { ...query, compareTo: 'none', interval: '1m', display: 'lines' };
}
