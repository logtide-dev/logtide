// ============================================================================
// Dashboard variables (1.8): validation and "$name" reference checks
// ============================================================================

import { z } from 'zod';
import { DASHBOARD_MAX_VARIABLES, DASHBOARD_VARIABLE_NAME_RE } from '@logtide/shared';
import type { DashboardVariable, PanelInstance } from '@logtide/shared';

// Attribute refs and the "$name" rule are the metrics query ones, shared with
// the query routes and metric alerts.
import { METRIC_ATTR_KEY_RE, metricAttrRefSchema } from '../metrics/query/schema.js';
import { isVariableRef } from '../metrics/query/variables.js';

export { METRIC_ATTR_KEY_RE, metricAttrRefSchema, isVariableRef };

export const dashboardVariableSchema = z
  .object({
    name: z.string().regex(DASHBOARD_VARIABLE_NAME_RE),
    label: z.string().min(1).max(60),
    attr: metricAttrRefSchema,
    metricName: z.string().min(1).max(255).nullable().optional(),
    default: z.string().max(200).nullable(),
  })
  .strict()
  .refine((v) => v.attr.scope !== 'metric' || !!v.metricName, {
    message: 'A metric-scope variable must name a metric (metricName)',
    path: ['metricName'],
  });

export const dashboardVariablesSchema = z
  .array(dashboardVariableSchema)
  .max(DASHBOARD_MAX_VARIABLES)
  .superRefine((vars, ctx) => {
    const seen = new Set<string>();
    vars.forEach((v, i) => {
      if (seen.has(v.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate variable name "${v.name}"`,
          path: [i, 'name'],
        });
      }
      seen.add(v.name);
    });
  });

/** Every "$name" a panel config refers to (metrics filters, trace serviceName). */
export function collectVariableRefs(config: PanelInstance['config']): string[] {
  const refs: string[] = [];
  if (config.type === 'metrics') {
    for (const q of config.query.queries) {
      for (const f of q.filters) {
        for (const v of f.values ?? []) if (isVariableRef(v)) refs.push(v.slice(1));
      }
    }
  } else if (config.type === 'trace_latency' || config.type === 'trace_volume') {
    if (isVariableRef(config.serviceName)) refs.push(config.serviceName.slice(1));
  }
  return refs;
}

/**
 * Throws a ZodError when a panel refers to a variable the dashboard does not
 * declare.
 */
export function assertPanelVariableRefs(
  panels: PanelInstance[],
  variables: DashboardVariable[]
): void {
  const declared = new Set(variables.map((v) => v.name));
  const issues: z.core.$ZodIssue[] = [];
  panels.forEach((panel, i) => {
    for (const name of collectVariableRefs(panel.config)) {
      if (!declared.has(name)) {
        issues.push({
          code: 'custom',
          message: `Unknown variable "$${name}"`,
          path: ['panels', i, 'config'],
          input: undefined,
        } as z.core.$ZodIssue);
      }
    }
  });
  if (issues.length > 0) throw new z.ZodError(issues);
}
