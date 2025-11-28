export { default as otlpRoutes } from './routes.js';
export { default as otlpTraceRoutes } from './trace-routes.js';
export * from './parser.js';
export * from './transformer.js';
export * from './severity-mapper.js';

export {
  transformOtlpToSpans,
  transformSpan,
  parseOtlpTracesJson,
  mapSpanKind,
  mapStatusCode,
  calculateDurationMs,
  transformEvents,
  transformLinks,
  type OtlpSpan,
  type OtlpScopeSpans,
  type OtlpResourceSpans,
  type OtlpExportTracesRequest,
  type OtlpStatus,
  type OtlpSpanEvent,
  type OtlpSpanLink,
  type TransformedSpan,
  type TransformedSpanEvent,
  type TransformedSpanLink,
  type AggregatedTrace,
  OTLP_SPAN_KIND,
  OTLP_STATUS_CODE,
} from './trace-transformer.js';
