// 1.8 metrics query service: the one evaluator behind the explorer
// (POST /api/v1/metrics/query), the `metrics` dashboard panel, the source
// views (POST /api/v1/metrics/panels/data) and the sources headline signals.
//
// CONTRACT (fixed by the lead; the implementation replaces the bodies):
// - resolveProjectScope: projectIds null -> every non-deleted project of the
//   organization; explicit ids must all belong to it and the user must be a
//   member of the organization, else MetricScopeError (routes map it to 403).
// - metricQueryService.run: evaluates an already-authorized query, semantics
//   in docs/superpowers/specs/2026-11-25-metrics-1.8-design.md ("Query service").

import type { MetricQueryRequest, MetricQueryResponse } from '@logtide/shared';

export class MetricScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricScopeError';
  }
}

/** Thrown for invalid queries (unknown variable, bad formula syntax at the request level); routes map it to 400. */
export class MetricQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricQueryValidationError';
  }
}

/** A query whose project scope is already resolved and authorized. */
export interface ResolvedMetricQuery extends Omit<MetricQueryRequest, 'projectIds'> {
  projectIds: string[];
}

export async function resolveProjectScope(
  _organizationId: string,
  _userId: string,
  _projectIds: string[] | null,
): Promise<string[]> {
  throw new Error('resolveProjectScope is not implemented yet');
}

export const metricQueryService = {
  async run(_query: ResolvedMetricQuery): Promise<MetricQueryResponse> {
    throw new Error('metricQueryService.run is not implemented yet');
  },
};
