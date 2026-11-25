// Dashboard panels evaluated by the metrics query service: the `metrics`
// panel fetcher (wired into custom-dashboards by its owner) and the panel
// batch behind POST /api/v1/metrics/panels/data, which renders source view
// templates (metrics panels plus trace_volume / trace_latency) without a saved
// dashboard.

import type {
  MetricQueryResponse,
  MetricsPanelConfig,
  PanelConfig,
  PanelTimeRange,
  TraceLatencyConfig,
  TraceVolumeConfig,
} from '@logtide/shared';
import { PANEL_TIME_RANGES, PANEL_TIME_RANGE_MS } from '@logtide/shared';
import { resolveOrgProjectScope, resolveProjectScopeDetailed } from './scope.js';
import { metricQueryService } from './service.js';
import { resolveVariableValue } from './variables.js';
import { MetricQueryValidationError } from './errors.js';
import { metricExplorerQuerySchema } from './schema.js';

export interface MetricsPanelContext {
  organizationId: string;
  /** When set, the user must be a member of the organization. */
  userId?: string;
  from: Date;
  to: Date;
  variables?: Record<string, string | null>;
}

export async function fetchMetricsPanelData(
  config: MetricsPanelConfig,
  ctx: MetricsPanelContext,
): Promise<MetricQueryResponse> {
  const { query } = config;
  // A panel saved earlier in 1.8 may carry [] for "every project" (the
  // schema now normalizes it to null on save).
  const projectIds = query.projectIds && query.projectIds.length > 0 ? query.projectIds : null;
  // Projects deleted since the panel was saved are skipped with a warning.
  const scope = ctx.userId
    ? await resolveProjectScopeDetailed(ctx.organizationId, ctx.userId, projectIds)
    : await resolveOrgProjectScope(ctx.organizationId, projectIds);
  const response = await metricQueryService.run({
    ...query,
    projectIds: scope.projectIds,
    organizationId: ctx.organizationId,
    from: ctx.from.toISOString(),
    to: ctx.to.toISOString(),
    variables: ctx.variables,
    // A stored panel never carries internal options.
    internal: undefined,
  });
  if (scope.warnings.length === 0) return response;
  return { ...response, warnings: [...scope.warnings, ...response.warnings] };
}

/**
 * The trace fetchers read a lookback window ending now: pick the smallest
 * panel range that covers the requested window (the largest one otherwise).
 */
export function panelRangeFor(from: Date, to: Date): PanelTimeRange {
  const ms = to.getTime() - from.getTime();
  for (const range of PANEL_TIME_RANGES) {
    if (PANEL_TIME_RANGE_MS[range] >= ms) return range;
  }
  return PANEL_TIME_RANGES[PANEL_TIME_RANGES.length - 1];
}

/** Evaluate one panel of a source view template. */
export async function fetchTemplatePanelData(
  config: PanelConfig,
  ctx: MetricsPanelContext & { userId: string },
): Promise<unknown> {
  switch (config.type) {
    case 'metrics': {
      const parsed = metricExplorerQuerySchema.safeParse(config.query);
      if (!parsed.success) {
        throw new MetricQueryValidationError(`Invalid metrics panel: ${parsed.error.issues[0]?.message ?? 'bad query'}`);
      }
      return fetchMetricsPanelData({ ...config, query: parsed.data as MetricsPanelConfig['query'] }, ctx);
    }
    case 'trace_volume':
    case 'trace_latency': {
      const traceConfig = config as TraceVolumeConfig | TraceLatencyConfig;
      const serviceName =
        typeof traceConfig.serviceName === 'string' && traceConfig.serviceName.length > 0
          ? resolveVariableValue(traceConfig.serviceName, ctx.variables)
          : null;
      // Lazy import: panel-data-service imports this module for the metrics panel.
      const { fetchPanelData, applyTimeRangeOverride } = await import('../../custom-dashboards/panel-data-service.js');
      const resolved = applyTimeRangeOverride(
        { ...traceConfig, serviceName },
        panelRangeFor(ctx.from, ctx.to),
      );
      return fetchPanelData(resolved, { organizationId: ctx.organizationId, userId: ctx.userId });
    }
    default:
      throw new MetricQueryValidationError(`Panel type "${config.type}" is not supported here`);
  }
}
