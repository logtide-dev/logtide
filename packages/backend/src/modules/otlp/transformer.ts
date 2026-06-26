/**
 * OTLP Transformer
 *
 * Transforms OpenTelemetry LogRecord messages to LogTide format.
 *
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/
 */

import { mapSeverityToLevel, type LogTideLevel } from './severity-mapper.js';

// ============================================================================
// OTLP Type Definitions (based on OpenTelemetry proto)
// ============================================================================

/**
 * OTLP AnyValue - can be string, bool, int, double, array, or kvlist
 */
export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number; // int64 as string in JSON
  doubleValue?: number;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
  bytesValue?: string; // base64 encoded
}

/**
 * OTLP KeyValue - attribute key-value pair
 */
export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

/**
 * OTLP Resource - represents the entity producing telemetry
 */
export interface OtlpResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

/**
 * OTLP InstrumentationScope - describes the instrumentation library
 */
export interface OtlpInstrumentationScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
}

/**
 * OTLP LogRecord - individual log entry
 */
export interface OtlpLogRecord {
  timeUnixNano?: string | bigint;
  observedTimeUnixNano?: string | bigint;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
  traceId?: string; // hex-encoded 16 bytes (32 chars)
  spanId?: string; // hex-encoded 8 bytes (16 chars)
}

/**
 * OTLP ScopeLogs - logs from a single instrumentation scope
 */
export interface OtlpScopeLogs {
  scope?: OtlpInstrumentationScope;
  logRecords?: OtlpLogRecord[];
  schemaUrl?: string;
}

/**
 * OTLP ResourceLogs - logs from a single resource
 */
export interface OtlpResourceLogs {
  resource?: OtlpResource;
  scopeLogs?: OtlpScopeLogs[];
  schemaUrl?: string;
}

/**
 * OTLP ExportLogsServiceRequest - top-level request message
 */
export interface OtlpExportLogsRequest {
  resourceLogs?: OtlpResourceLogs[];
}

// ============================================================================
// LogTide Output Types
// ============================================================================

/**
 * Transformed log ready for LogTide ingestion
 */
export interface TransformedLog {
  time: string; // ISO 8601 timestamp
  service: string;
  level: LogTideLevel;
  message: string;
  metadata?: Record<string, unknown>;
  trace_id?: string; // Any string format (OTLP uses 32 hex chars)
  span_id?: string; // 16 hex chars
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transform OTLP ExportLogsRequest to LogTide format.
 *
 * @param request - OTLP export request
 * @returns Array of transformed logs
 */
export function transformOtlpToLogTide(
  request: OtlpExportLogsRequest
): TransformedLog[] {
  const logs: TransformedLog[] = [];

  for (const resourceLog of request.resourceLogs ?? []) {
    const serviceName = extractServiceName(resourceLog.resource?.attributes);
    const resourceAttrs = attributesToRecord(resourceLog.resource?.attributes);

    for (const scopeLog of resourceLog.scopeLogs ?? []) {
      const scopeMetadata = scopeLog.scope
        ? {
            'otel.scope.name': scopeLog.scope.name,
            'otel.scope.version': scopeLog.scope.version,
          }
        : {};

      for (const logRecord of scopeLog.logRecords ?? []) {
        const transformed = transformLogRecord(
          logRecord,
          serviceName,
          scopeMetadata,
          resourceAttrs
        );
        logs.push(transformed);
      }
    }
  }

  return logs;
}

/**
 * Transform a single OTLP LogRecord to LogTide format.
 *
 * Metadata assembly order:
 *   1. scope keys  (otel.scope.name / otel.scope.version) - flat
 *   2. log record attributes                              - flat
 *   3. severity fields                                    - flat
 *   4. otel.body (structured bodies only)                - flat key
 *   5. resource attrs under 'resource'                   - always wins
 *
 * Step 5 intentionally overwrites any log attribute also named 'resource'.
 * That edge case is spec-sanctioned: the namespaced resource object must
 * always be reachable at metadata.resource regardless of log attr names.
 *
 * For callers that pre-assemble baseMetadata (e.g. tests), pass an empty
 * resourceAttrs and embed resource data directly in baseMetadata.
 */
export function transformLogRecord(
  record: OtlpLogRecord,
  serviceName: string,
  baseMetadata: Record<string, unknown>,
  resourceAttrs: Record<string, unknown> = {}
): TransformedLog {
  const logMetadata = attributesToRecord(record.attributes);

  // Decode structured body to preserve original structure alongside message.
  // String/int/double/bool bodies use message only (no otel.body noise).
  const structuredBody = extractStructuredBody(record.body);

  return {
    time: nanosToIso(record.timeUnixNano ?? record.observedTimeUnixNano),
    service: serviceName,
    level: mapSeverityToLevel(record.severityNumber, record.severityText),
    message: extractMessage(record.body),
    metadata: {
      ...baseMetadata,
      ...logMetadata,
      // Preserve original severity for debugging
      ...(record.severityNumber !== undefined && {
        'otel.severity_number': record.severityNumber,
      }),
      ...(record.severityText && {
        'otel.severity_text': record.severityText,
      }),
      // Structured body preserved as decoded value (absent for simple types)
      ...(structuredBody !== undefined && { 'otel.body': structuredBody }),
      // Resource attrs namespaced last so metadata.resource is always the
      // resource attrs object even if a log attr was named 'resource'.
      ...(Object.keys(resourceAttrs).length > 0 && { resource: resourceAttrs }),
    },
    trace_id: normalizeTraceId(record.traceId),
    span_id: record.spanId || undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize string for PostgreSQL TEXT columns.
 * PostgreSQL cannot store null bytes (\x00) in TEXT columns.
 */
export function sanitizeForPostgres(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x00/g, '');
}

/**
 * Maximum stored length for an OTLP service name. Service names are short
 * identifiers; anything longer is almost certainly abuse or a bug.
 */
export const MAX_SERVICE_NAME_LENGTH = 255;

/**
 * Defense-in-depth sanitization for OTLP service.name before it is stored and
 * later rendered (dashboards, service map). Strips control characters (C0, DEL,
 * C1) including null bytes, and caps the length. It deliberately does NOT strip
 * otherwise legitimate characters (such as < > " '): those are neutralized by
 * output-encoding at each sink, and stripping them here would corrupt the value
 * for the JSON API and other consumers. Returns 'unknown' if nothing usable
 * remains.
 */
export function sanitizeServiceName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, MAX_SERVICE_NAME_LENGTH);
  return cleaned.trim().length > 0 ? cleaned : 'unknown';
}

/**
 * Extract service name from resource attributes.
 * Falls back to 'unknown' if not found.
 */
export function extractServiceName(attributes?: OtlpKeyValue[]): string {
  if (!attributes) return 'unknown';

  const serviceAttr = attributes.find((attr) => attr.key === 'service.name');
  if (serviceAttr?.value?.stringValue) {
    return sanitizeServiceName(serviceAttr.value.stringValue);
  }

  return 'unknown';
}

/**
 * Convert nanoseconds timestamp to ISO 8601 string.
 *
 * @param nanos - Timestamp in nanoseconds (string or bigint)
 * @returns ISO 8601 string
 */
export function nanosToIso(nanos?: string | bigint): string {
  if (!nanos) {
    return new Date().toISOString();
  }

  try {
    const ns = typeof nanos === 'string' ? BigInt(nanos) : nanos;
    const ms = Number(ns / 1000000n);
    return new Date(ms).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Normalize OTLP trace_id.
 * Returns the trace_id as-is if valid, undefined otherwise.
 * OTLP trace_id is typically 16 bytes = 32 hex chars.
 *
 * @param traceId - Trace ID string
 * @returns Trace ID string or undefined if invalid/empty
 */
export function normalizeTraceId(traceId?: string): string | undefined {
  if (!traceId) {
    return undefined;
  }

  // Check if all zeros (invalid trace_id per OTLP spec)
  if (/^0+$/.test(traceId)) {
    return undefined;
  }

  return traceId;
}

/**
 * Extract message from OTLP body.
 * Body can be string, structured data, or missing.
 */
export function extractMessage(body?: OtlpAnyValue): string {
  if (!body) {
    return '';
  }

  // String value (most common)
  if (body.stringValue !== undefined) {
    return sanitizeForPostgres(body.stringValue);
  }

  // Integer value
  if (body.intValue !== undefined) {
    return String(body.intValue);
  }

  // Double value
  if (body.doubleValue !== undefined) {
    return String(body.doubleValue);
  }

  // Boolean value
  if (body.boolValue !== undefined) {
    return String(body.boolValue);
  }

  // Array value - stringify
  if (body.arrayValue?.values) {
    return JSON.stringify(body.arrayValue.values.map(extractMessage));
  }

  // KVList value - stringify as object
  if (body.kvlistValue?.values) {
    const obj: Record<string, unknown> = {};
    for (const kv of body.kvlistValue.values) {
      obj[kv.key] = anyValueToJs(kv.value);
    }
    return JSON.stringify(obj);
  }

  // Bytes value - return base64
  if (body.bytesValue !== undefined) {
    return `[bytes: ${body.bytesValue}]`;
  }

  return '';
}

/**
 * Decode a structured OTLP body value to a plain JS value.
 *
 * Returns the decoded value only for arrayValue and kvlistValue bodies.
 * Returns undefined for all other body types so callers can skip adding
 * 'otel.body' to metadata when the body is a simple scalar.
 */
export function extractStructuredBody(
  body?: OtlpAnyValue
): unknown[] | Record<string, unknown> | undefined {
  if (!body) return undefined;

  if (body.arrayValue?.values) {
    return body.arrayValue.values.map(anyValueToJs) as unknown[];
  }

  if (body.kvlistValue?.values) {
    const obj: Record<string, unknown> = {};
    for (const kv of body.kvlistValue.values) {
      obj[kv.key] = anyValueToJs(kv.value);
    }
    return obj;
  }

  return undefined;
}

/**
 * Convert OTLP KeyValue array to Record<string, unknown>.
 */
export function attributesToRecord(
  attributes?: OtlpKeyValue[]
): Record<string, unknown> {
  if (!attributes) return {};

  const result: Record<string, unknown> = {};
  for (const attr of attributes) {
    result[attr.key] = anyValueToJs(attr.value);
  }
  return result;
}

/**
 * Convert OTLP AnyValue to JavaScript value.
 */
export function anyValueToJs(value?: OtlpAnyValue): unknown {
  if (!value) return null;

  if (value.stringValue !== undefined) return sanitizeForPostgres(value.stringValue);
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) {
    // int64 may be string in JSON. Values outside the safe-integer range
    // lose precision when converted to Number, so keep them as strings so
    // downstream consumers (metadata) still see the exact value.
    if (typeof value.intValue === 'string') {
      const n = Number(value.intValue);
      return Number.isSafeInteger(n) ? n : value.intValue;
    }
    return value.intValue;
  }
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;

  if (value.arrayValue?.values) {
    return value.arrayValue.values.map(anyValueToJs);
  }

  if (value.kvlistValue?.values) {
    const obj: Record<string, unknown> = {};
    for (const kv of value.kvlistValue.values) {
      obj[kv.key] = anyValueToJs(kv.value);
    }
    return obj;
  }

  return null;
}
