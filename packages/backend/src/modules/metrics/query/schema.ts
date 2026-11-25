// Zod validation of the metrics query API (limits from @logtide/shared query.ts).

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
} from '@logtide/shared';
import { variableName } from './variables.js';

const MAX_FILTER_VALUES = 100;
const MAX_PROJECTS = 200;
const MAX_PANELS = 50;

const attrRefSchema = z.object({
  scope: z.enum(['metric', 'resource']),
  key: z.string().min(1).max(256),
});

const NUMERIC_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export const metricAttrFilterSchema = attrRefSchema
  .extend({
    op: z.enum(METRIC_ATTR_FILTER_OPS as unknown as [string, ...string[]]),
    values: z.array(z.string().max(1024)).max(MAX_FILTER_VALUES).optional(),
  })
  .superRefine((f, ctx) => {
    const n = f.values?.length ?? 0;
    switch (f.op) {
      case 'eq':
      case 'neq':
        if (n !== 1) ctx.addIssue({ code: 'custom', message: `${f.op} takes exactly one value`, path: ['values'] });
        break;
      case 'in':
      case 'nin':
        if (n < 1) ctx.addIssue({ code: 'custom', message: `${f.op} takes at least one value`, path: ['values'] });
        break;
      case 'exists':
      case 'notExists':
        if (n > 0) ctx.addIssue({ code: 'custom', message: `${f.op} takes no values`, path: ['values'] });
        break;
      case 'gte':
      case 'lt': {
        if (n !== 1) {
          ctx.addIssue({ code: 'custom', message: `${f.op} takes exactly one value`, path: ['values'] });
          break;
        }
        const v = f.values![0];
        if (!NUMERIC_RE.test(v) && variableName(v) === null) {
          ctx.addIssue({ code: 'custom', message: `${f.op} takes a numeric value`, path: ['values'] });
        }
        break;
      }
    }
  });

export const metricQuerySpecSchema = z.object({
  id: z.enum(METRIC_QUERY_IDS),
  metricName: z.string().min(1).max(512),
  aggregation: z.enum(METRIC_TIME_AGGREGATIONS as unknown as [string, ...string[]]),
  spaceAggregation: z.enum(METRIC_SPACE_AGGREGATIONS as unknown as [string, ...string[]]).optional(),
  filters: z.array(metricAttrFilterSchema).max(METRIC_MAX_FILTERS).default([]),
  groupBy: z.array(attrRefSchema).max(METRIC_MAX_GROUP_BY).default([]),
  limit: z.number().int().min(1).max(METRIC_MAX_SERIES_LIMIT).optional(),
  hidden: z.boolean().optional(),
  label: z.string().max(200).optional(),
});

export const metricFormulaSpecSchema = z.object({
  id: z.string().regex(/^F[1-4]$/),
  expression: z.string().min(1).max(500),
  label: z.string().max(200).optional(),
  hidden: z.boolean().optional(),
});

const variablesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.string().max(1024).nullable())
  .refine((v) => Object.keys(v).length <= 20, 'Too many variables');

export const metricExplorerQuerySchema = z
  .object({
    projectIds: z.array(z.string().guid()).min(1).max(MAX_PROJECTS).nullable(),
    queries: z.array(metricQuerySpecSchema).min(1).max(METRIC_MAX_QUERIES),
    formulas: z.array(metricFormulaSpecSchema).max(METRIC_MAX_FORMULAS).default([]),
    interval: z.enum(['auto', '1m', '5m', '15m', '1h', '6h', '1d']).default('auto'),
    compareTo: z.enum(['none', '1h', '1d', '1w']).default('none'),
    display: z.enum(['lines', 'area', 'bars', 'split', 'stat', 'table']).default('lines'),
    unitOverride: z.string().max(32).nullable().optional(),
  })
  .superRefine((q, ctx) => {
    const ids = q.queries.map((x) => x.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Query ids must be unique', path: ['queries'] });
    }
    const fids = q.formulas.map((x) => x.id);
    if (new Set(fids).size !== fids.length) {
      ctx.addIssue({ code: 'custom', message: 'Formula ids must be unique', path: ['formulas'] });
    }
  });

const windowSchema = z
  .object({
    organizationId: z.string().guid(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    variables: variablesSchema.optional(),
  });

function refineWindow(v: { from: string; to: string }, ctx: z.RefinementCtx) {
  if (new Date(v.from).getTime() >= new Date(v.to).getTime()) {
    ctx.addIssue({ code: 'custom', message: '"from" must be before "to"', path: ['from'] });
  }
}

export const metricQueryRequestSchema = z
  .intersection(windowSchema, metricExplorerQuerySchema)
  .superRefine(refineWindow);

export const metricPanelsDataSchema = windowSchema
  .extend({
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
