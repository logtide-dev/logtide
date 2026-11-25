// Zod validation of the metrics query model (limits from @logtide/shared
// query.ts). This module is THE schema of a MetricExplorerQuery: the query
// routes, the `metrics` dashboard panel (custom-dashboards/panel-registry.ts)
// and metric alert rules (alerts/metric-config.ts) all validate with it, so a
// query saved from the explorer is accepted everywhere with the same rules.
//
// Rules in one place:
// - attribute keys: METRIC_ATTR_KEY_RE (dots, dashes, slashes and colons are
//   part of real OTel / Kubernetes keys; quotes, spaces and control characters
//   are not). Keys always travel as bound parameters in the engines; the
//   charset is a second barrier.
// - filter values: up to 1024 characters, the empty string is a value (an
//   attribute present with empty text); "$name" is a variable only when it
//   matches the variable name rule (variables.ts), so "$5" is a literal.
// - unknown object keys are stripped (stored panels and alert rules keep only
//   the known fields).

import { z } from 'zod';
import {
  METRIC_ATTR_FILTER_OPS,
  METRIC_MAX_FILTERS,
  METRIC_MAX_FORMULAS,
  METRIC_MAX_GROUP_BY,
  METRIC_MAX_QUERIES,
  METRIC_MAX_SERIES_LIMIT,
  METRIC_QUERY_IDS,
  METRIC_SPACE_AGGREGATIONS,
  METRIC_TIME_AGGREGATIONS,
  DASHBOARD_VARIABLE_NAME_RE,
} from '@logtide/shared';
import type { MetricAttrFilterOp, MetricSpaceAggregation, MetricTimeAggregation } from '@logtide/shared';
import { isVariableRef } from './variables.js';

export const METRIC_ATTR_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.\-/:]{0,255}$/;
export const METRIC_NAME_MAX = 512;
export const METRIC_FILTER_VALUE_MAX = 1024;
export const METRIC_MAX_FILTER_VALUES = 100;
export const METRIC_MAX_PROJECTS = 200;
export const METRIC_LABEL_MAX = 200;
export const METRIC_FORMULA_MAX = 500;
export const METRIC_UNIT_MAX = 32;
export const METRIC_MAX_VARIABLES = 20;
const MAX_PANELS = 50;

/** Longest window a metrics query may read (from < to, at most 90 days). */
export const MAX_QUERY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Numeric text the engines compare with gte/lt (same grammar as the engines). */
export const METRIC_NUMERIC_RE = /^[-+]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$/;

export const metricAttrRefSchema = z.object({
  scope: z.enum(['metric', 'resource']),
  key: z.string().regex(METRIC_ATTR_KEY_RE, 'Invalid attribute key'),
});

export const metricAttrFilterSchema = metricAttrRefSchema
  .extend({
    op: z.enum(METRIC_ATTR_FILTER_OPS as unknown as [MetricAttrFilterOp, ...MetricAttrFilterOp[]]),
    values: z.array(z.string().max(METRIC_FILTER_VALUE_MAX)).max(METRIC_MAX_FILTER_VALUES).optional(),
  })
  .superRefine((f, ctx) => {
    const n = f.values?.length ?? 0;
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['values'] });
    switch (f.op) {
      case 'eq':
      case 'neq':
        if (n !== 1) bad(`${f.op} takes exactly one value`);
        break;
      case 'in':
      case 'nin':
        if (n < 1) bad(`${f.op} takes at least one value`);
        break;
      case 'exists':
      case 'notExists':
        if (n > 0) bad(`${f.op} takes no values`);
        break;
      case 'gte':
      case 'lt': {
        if (n !== 1) {
          bad(`${f.op} takes exactly one value`);
          break;
        }
        const v = f.values![0];
        if (!METRIC_NUMERIC_RE.test(v) && !isVariableRef(v)) bad(`${f.op} takes a numeric value`);
        break;
      }
    }
  });

export const metricQuerySpecSchema = z.object({
  id: z.enum(METRIC_QUERY_IDS),
  metricName: z.string().min(1).max(METRIC_NAME_MAX),
  aggregation: z.enum(METRIC_TIME_AGGREGATIONS as unknown as [MetricTimeAggregation, ...MetricTimeAggregation[]]),
  spaceAggregation: z.enum(METRIC_SPACE_AGGREGATIONS as unknown as [MetricSpaceAggregation, ...MetricSpaceAggregation[]]).optional(),
  filters: z.array(metricAttrFilterSchema).max(METRIC_MAX_FILTERS).default([]),
  groupBy: z.array(metricAttrRefSchema).max(METRIC_MAX_GROUP_BY).default([]),
  limit: z.number().int().min(1).max(METRIC_MAX_SERIES_LIMIT).optional(),
  hidden: z.boolean().optional(),
  label: z.string().max(METRIC_LABEL_MAX).optional(),
});

export const metricFormulaSpecSchema = z.object({
  id: z.enum(['F1', 'F2', 'F3', 'F4']),
  expression: z.string().min(1).max(METRIC_FORMULA_MAX),
  label: z.string().max(METRIC_LABEL_MAX).optional(),
  hidden: z.boolean().optional(),
  missingAsZero: z.boolean().optional(),
});

const explorerQueryShape = {
  projectIds: z.array(z.string().guid()).min(1).max(METRIC_MAX_PROJECTS).nullable(),
  queries: z.array(metricQuerySpecSchema).min(1).max(METRIC_MAX_QUERIES),
  formulas: z.array(metricFormulaSpecSchema).max(METRIC_MAX_FORMULAS).default([]),
  interval: z.enum(['auto', '1m', '5m', '15m', '1h', '6h', '1d']).default('auto'),
  compareTo: z.enum(['none', '1h', '1d', '1w']).default('none'),
  display: z.enum(['lines', 'area', 'bars', 'split', 'stat', 'table']).default('lines'),
  unitOverride: z.string().max(METRIC_UNIT_MAX).nullable().optional(),
};

function refineUniqueIds(q: { queries: Array<{ id: string }>; formulas: Array<{ id: string }> }, ctx: z.RefinementCtx) {
  const dupes = (ids: string[], path: 'queries' | 'formulas') => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${id}"`, path: [path, i, 'id'] });
      seen.add(id);
    });
  };
  dupes(q.queries.map((x) => x.id), 'queries');
  dupes(q.formulas.map((x) => x.id), 'formulas');
}

/** The persisted / shareable explorer query (MetricExplorerQuery). */
export const metricExplorerQuerySchema = z.object(explorerQueryShape).superRefine(refineUniqueIds);

/** Variable values by name; null = All (filters using it are dropped). */
export const metricVariablesSchema = z
  .record(z.string().regex(DASHBOARD_VARIABLE_NAME_RE), z.string().max(METRIC_FILTER_VALUE_MAX).nullable())
  .refine((v) => Object.keys(v).length <= METRIC_MAX_VARIABLES, 'Too many variables');

const windowShape = {
  organizationId: z.string().guid(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  variables: metricVariablesSchema.optional(),
};

/** from < to and the window is at most MAX_QUERY_WINDOW_MS long. */
export function windowError(fromMs: number, toMs: number): string | null {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return '"from" must be before "to"';
  if (toMs - fromMs > MAX_QUERY_WINDOW_MS) return 'The time range can be at most 90 days';
  return null;
}

function refineWindow(v: { from: string; to: string }, ctx: z.RefinementCtx) {
  const message = windowError(new Date(v.from).getTime(), new Date(v.to).getTime());
  if (message) ctx.addIssue({ code: 'custom', message, path: ['from'] });
}

export const metricQueryRequestSchema = z
  .object({ ...windowShape, ...explorerQueryShape })
  .superRefine((v, ctx) => {
    refineWindow(v, ctx);
    refineUniqueIds(v, ctx);
  });

/**
 * Variables a template declares, so a request that leaves one out still gets
 * its default (any other DashboardVariable field is accepted and ignored).
 */
export const declaredVariablesSchema = z
  .array(
    z.object({
      name: z.string().regex(DASHBOARD_VARIABLE_NAME_RE),
      default: z.string().max(METRIC_FILTER_VALUE_MAX).nullable().optional(),
    }),
  )
  .max(METRIC_MAX_VARIABLES);

export const metricPanelsDataSchema = z
  .object({
    ...windowShape,
    declaredVariables: declaredVariablesSchema.optional(),
    panels: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          // Validated per panel type in the handler, so one bad panel only fails itself.
          config: z.object({ type: z.string() }).passthrough(),
        }),
      )
      .min(1)
      .max(MAX_PANELS),
  })
  .superRefine(refineWindow);

/**
 * Variables for a panel batch: every declared variable starts at its default,
 * the values sent in the request win (null included: All).
 */
export function effectiveVariables(
  sent: Record<string, string | null> | undefined,
  declared: Array<{ name: string; default?: string | null }> | undefined,
): Record<string, string | null> | undefined {
  if (!declared || declared.length === 0) return sent;
  const out: Record<string, string | null> = {};
  for (const v of declared) out[v.name] = v.default ?? null;
  for (const [name, value] of Object.entries(sent ?? {})) out[name] = value;
  return out;
}
