// Error types of the metrics query service. Kept apart from service.ts so the
// helpers (scope, variables, formulas) can throw them without import cycles.

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
