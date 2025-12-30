/**
 * OTLP Trace Transformer
 *
 * Transforms OpenTelemetry Span messages to LogWard format.
 *
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/
 */

import type { SpanKind, SpanStatusCode } from '../../database/types.js';
import { attributesToRecord, sanitizeForPostgres, type OtlpKeyValue } from './transformer.js';
import { isGzipCompressed, decompressGzip } from './parser.js';
import { createRequire } from 'module';

// Import the generated protobuf definitions from @opentelemetry/otlp-transformer
const require = createRequire(import.meta.url);
const $root = require('@opentelemetry/otlp-transformer/build/esm/generated/root.js');

// Get the ExportTraceServiceRequest message type for decoding protobuf messages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExportTraceServiceRequest: any = $root.opentelemetry?.proto?.collector?.trace?.v1?.ExportTraceServiceRequest;

// ============================================================================
// OTLP Trace Type Definitions
// ============================================================================

/**
 * OTLP SpanKind enum values
 */
export const OTLP_SPAN_KIND = {
  UNSPECIFIED: 0,
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
} as const;

/**
 * OTLP Status Code enum values
 */
export const OTLP_STATUS_CODE = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/**
 * OTLP Status
 */
export interface OtlpStatus {
  code?: number;
  message?: string;
}

/**
 * OTLP SpanEvent
 */
export interface OtlpSpanEvent {
  timeUnixNano?: string | bigint;
  name?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

/**
 * OTLP SpanLink
 */
export interface OtlpSpanLink {
  traceId?: string;
  spanId?: string;
  traceState?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

/**
 * OTLP Span
 */
export interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  traceState?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string | bigint;
  endTimeUnixNano?: string | bigint;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  events?: OtlpSpanEvent[];
  droppedEventsCount?: number;
  links?: OtlpSpanLink[];
  droppedLinksCount?: number;
  status?: OtlpStatus;
}

/**
 * OTLP Resource (same as logs)
 */
export interface OtlpResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

/**
 * OTLP InstrumentationScope
 */
export interface OtlpInstrumentationScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
}

/**
 * OTLP ScopeSpans
 */
export interface OtlpScopeSpans {
  scope?: OtlpInstrumentationScope;
  spans?: OtlpSpan[];
  schemaUrl?: string;
}

/**
 * OTLP ResourceSpans
 */
export interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
  schemaUrl?: string;
}

/**
 * OTLP ExportTraceServiceRequest
 */
export interface OtlpExportTracesRequest {
  resourceSpans?: OtlpResourceSpans[];
}

// ============================================================================
// LogWard Output Types
// ============================================================================

/**
 * Transformed span ready for LogWard ingestion
 */
export interface TransformedSpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  service_name: string;
  operation_name: string;
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
  duration_ms: number;
  kind?: SpanKind;
  status_code?: SpanStatusCode;
  status_message?: string;
  attributes?: Record<string, unknown>;
  events?: TransformedSpanEvent[];
  links?: TransformedSpanLink[];
  resource_attributes?: Record<string, unknown>;
}

export interface TransformedSpanEvent {
  time: string; // ISO 8601
  name: string;
  attributes?: Record<string, unknown>;
}

export interface TransformedSpanLink {
  trace_id: string;
  span_id: string;
  attributes?: Record<string, unknown>;
}

/**
 * Aggregated trace information
 */
export interface AggregatedTrace {
  trace_id: string;
  service_name: string;
  root_service_name?: string;
  root_operation_name?: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  span_count: number;
  error: boolean;
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transform OTLP ExportTracesRequest to LogWard format.
 *
 * @param request - OTLP export request
 * @returns Object with spans array and aggregated trace info
 */
export function transformOtlpToSpans(
  request: OtlpExportTracesRequest
): { spans: TransformedSpan[]; traces: Map<string, AggregatedTrace> } {
  const spans: TransformedSpan[] = [];
  const traces = new Map<string, AggregatedTrace>();

  for (const resourceSpan of request.resourceSpans ?? []) {
    const serviceName = extractServiceName(resourceSpan.resource?.attributes);
    const resourceAttributes = attributesToRecord(resourceSpan.resource?.attributes);

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const transformed = transformSpan(span, serviceName, resourceAttributes);
        if (transformed) {
          spans.push(transformed);
          updateTraceAggregation(traces, transformed);
        }
      }
    }
  }

  return { spans, traces };
}

/**
 * Transform a single OTLP Span to LogWard format.
 */
export function transformSpan(
  span: OtlpSpan,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): TransformedSpan | null {
  // Skip invalid spans
  if (!span.traceId || !span.spanId) {
    return null;
  }

  // Skip all-zero trace IDs
  if (/^0+$/.test(span.traceId)) {
    return null;
  }

  const startTime = nanosToIso(span.startTimeUnixNano);
  const endTime = nanosToIso(span.endTimeUnixNano);
  const durationMs = calculateDurationMs(span.startTimeUnixNano, span.endTimeUnixNano);

  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId || undefined,
    service_name: serviceName,
    operation_name: sanitizeForPostgres(span.name || 'unknown'),
    start_time: startTime,
    end_time: endTime,
    duration_ms: durationMs,
    kind: mapSpanKind(span.kind),
    status_code: mapStatusCode(span.status?.code),
    status_message: span.status?.message ? sanitizeForPostgres(span.status.message) : undefined,
    attributes: attributesToRecord(span.attributes),
    events: transformEvents(span.events),
    links: transformLinks(span.links),
    resource_attributes: resourceAttributes,
  };
}

/**
 * Update trace aggregation with span data.
 */
function updateTraceAggregation(
  traces: Map<string, AggregatedTrace>,
  span: TransformedSpan
): void {
  const existing = traces.get(span.trace_id);

  if (!existing) {
    // First span for this trace
    traces.set(span.trace_id, {
      trace_id: span.trace_id,
      service_name: span.service_name,
      root_service_name: !span.parent_span_id ? span.service_name : undefined,
      root_operation_name: !span.parent_span_id ? span.operation_name : undefined,
      start_time: span.start_time,
      end_time: span.end_time,
      duration_ms: span.duration_ms,
      span_count: 1,
      error: span.status_code === 'ERROR',
    });
  } else {
    // Update aggregation
    const startTime = new Date(span.start_time);
    const endTime = new Date(span.end_time);
    const existingStart = new Date(existing.start_time);
    const existingEnd = new Date(existing.end_time);

    // Update time bounds
    if (startTime < existingStart) {
      existing.start_time = span.start_time;
    }
    if (endTime > existingEnd) {
      existing.end_time = span.end_time;
    }

    // Recalculate duration
    existing.duration_ms = new Date(existing.end_time).getTime() -
      new Date(existing.start_time).getTime();

    // Increment span count
    existing.span_count++;

    // Track root span info
    if (!span.parent_span_id) {
      existing.root_service_name = span.service_name;
      existing.root_operation_name = span.operation_name;
    }

    // Track error state
    if (span.status_code === 'ERROR') {
      existing.error = true;
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract service name from resource attributes.
 */
export function extractServiceName(attributes?: OtlpKeyValue[]): string {
  if (!attributes) return 'unknown';

  const serviceAttr = attributes.find((attr) => attr.key === 'service.name');
  if (serviceAttr?.value?.stringValue) {
    return sanitizeForPostgres(serviceAttr.value.stringValue);
  }

  return 'unknown';
}

/**
 * Convert nanoseconds to ISO 8601 string.
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
 * Calculate duration in milliseconds from nanosecond timestamps.
 */
export function calculateDurationMs(
  startNanos?: string | bigint,
  endNanos?: string | bigint
): number {
  if (!startNanos || !endNanos) {
    return 0;
  }

  try {
    const start = typeof startNanos === 'string' ? BigInt(startNanos) : startNanos;
    const end = typeof endNanos === 'string' ? BigInt(endNanos) : endNanos;
    return Number((end - start) / 1000000n);
  } catch {
    return 0;
  }
}

/**
 * Map OTLP span kind to LogWard SpanKind.
 */
export function mapSpanKind(kind?: number): SpanKind | undefined {
  switch (kind) {
    case OTLP_SPAN_KIND.INTERNAL:
      return 'INTERNAL';
    case OTLP_SPAN_KIND.SERVER:
      return 'SERVER';
    case OTLP_SPAN_KIND.CLIENT:
      return 'CLIENT';
    case OTLP_SPAN_KIND.PRODUCER:
      return 'PRODUCER';
    case OTLP_SPAN_KIND.CONSUMER:
      return 'CONSUMER';
    default:
      return undefined;
  }
}

/**
 * Map OTLP status code to LogWard SpanStatusCode.
 */
export function mapStatusCode(code?: number): SpanStatusCode | undefined {
  switch (code) {
    case OTLP_STATUS_CODE.UNSET:
      return 'UNSET';
    case OTLP_STATUS_CODE.OK:
      return 'OK';
    case OTLP_STATUS_CODE.ERROR:
      return 'ERROR';
    default:
      return undefined;
  }
}

/**
 * Transform OTLP span events.
 */
export function transformEvents(events?: OtlpSpanEvent[]): TransformedSpanEvent[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    time: nanosToIso(event.timeUnixNano),
    name: sanitizeForPostgres(event.name || 'event'),
    attributes: event.attributes ? attributesToRecord(event.attributes) : undefined,
  }));
}

/**
 * Transform OTLP span links.
 */
export function transformLinks(links?: OtlpSpanLink[]): TransformedSpanLink[] | undefined {
  if (!links || links.length === 0) {
    return undefined;
  }

  return links
    .filter((link) => link.traceId && link.spanId)
    .map((link) => ({
      trace_id: link.traceId!,
      span_id: link.spanId!,
      attributes: link.attributes ? attributesToRecord(link.attributes) : undefined,
    }));
}

// ============================================================================
// JSON Parser for Traces
// ============================================================================

/**
 * Parse OTLP JSON trace request body.
 */
export function parseOtlpTracesJson(body: unknown): OtlpExportTracesRequest {
  if (!body) {
    return { resourceSpans: [] };
  }

  if (typeof body === 'object') {
    return normalizeTracesRequest(body as Record<string, unknown>);
  }

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return normalizeTracesRequest(parsed);
    } catch (error) {
      throw new Error(`Invalid OTLP Traces JSON: ${(error as Error).message}`);
    }
  }

  throw new Error('Invalid OTLP traces request body type');
}

/**
 * Normalize traces request to handle both camelCase and snake_case.
 */
function normalizeTracesRequest(data: Record<string, unknown>): OtlpExportTracesRequest {
  const resourceSpans = (data.resourceSpans ?? data.resource_spans) as unknown[];

  if (!Array.isArray(resourceSpans)) {
    return { resourceSpans: [] };
  }

  return {
    resourceSpans: resourceSpans.map(normalizeResourceSpans),
  };
}

function normalizeResourceSpans(rs: unknown): OtlpResourceSpans {
  if (!rs || typeof rs !== 'object') return {};

  const data = rs as Record<string, unknown>;

  return {
    resource: data.resource as OtlpResource | undefined,
    scopeSpans: normalizeScopeSpans(data.scopeSpans ?? data.scope_spans),
    schemaUrl: (data.schemaUrl ?? data.schema_url) as string | undefined,
  };
}

function normalizeScopeSpans(ss: unknown): OtlpScopeSpans[] | undefined {
  if (!Array.isArray(ss)) return undefined;

  return ss.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope as OtlpInstrumentationScope | undefined,
      spans: normalizeSpans(data.spans),
      schemaUrl: (data.schemaUrl ?? data.schema_url) as string | undefined,
    };
  });
}

function normalizeSpans(spans: unknown): OtlpSpan[] | undefined {
  if (!Array.isArray(spans)) return undefined;

  return spans.map((span) => {
    if (!span || typeof span !== 'object') return {};
    const data = span as Record<string, unknown>;

    return {
      traceId: (data.traceId ?? data.trace_id) as string | undefined,
      spanId: (data.spanId ?? data.span_id) as string | undefined,
      traceState: (data.traceState ?? data.trace_state) as string | undefined,
      parentSpanId: (data.parentSpanId ?? data.parent_span_id) as string | undefined,
      name: data.name as string | undefined,
      kind: data.kind as number | undefined,
      startTimeUnixNano: (data.startTimeUnixNano ?? data.start_time_unix_nano) as string | bigint | undefined,
      endTimeUnixNano: (data.endTimeUnixNano ?? data.end_time_unix_nano) as string | bigint | undefined,
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      events: data.events as OtlpSpanEvent[] | undefined,
      links: data.links as OtlpSpanLink[] | undefined,
      status: data.status as OtlpStatus | undefined,
    };
  });
}

// ============================================================================
// Protobuf Parser for Traces
// ============================================================================

/**
 * Parse OTLP Protobuf trace request body.
 *
 * Uses the OpenTelemetry proto definitions from @opentelemetry/otlp-transformer
 * to properly decode binary protobuf messages.
 *
 * Automatically detects and decompresses gzip-compressed data by checking
 * for gzip magic bytes (0x1f 0x8b), regardless of Content-Encoding header.
 *
 * @param buffer - Raw protobuf buffer (may be gzip compressed)
 * @returns Parsed OTLP traces request
 * @throws Error if parsing fails
 */
export async function parseOtlpTracesProtobuf(buffer: Buffer): Promise<OtlpExportTracesRequest> {
  // Auto-detect gzip compression by magic bytes (0x1f 0x8b)
  if (isGzipCompressed(buffer)) {
    console.log('[OTLP Traces] Auto-detected gzip compression by magic bytes, decompressing...');
    try {
      buffer = await decompressGzip(buffer);
      console.log(`[OTLP Traces] Decompressed protobuf data to ${buffer.length} bytes`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[OTLP Traces] Gzip decompression failed:', errMsg);
      throw new Error(`Failed to decompress gzip data: ${errMsg}`);
    }
  }

  // First, try to parse as JSON (some clients send JSON with protobuf content-type)
  try {
    const jsonString = buffer.toString('utf-8');
    if (jsonString.startsWith('{') || jsonString.startsWith('[')) {
      console.log('[OTLP Traces] Protobuf content-type but JSON payload detected, parsing as JSON');
      return parseOtlpTracesJson(jsonString);
    }
  } catch {
    // Not JSON, continue to protobuf parsing
  }

  // Verify ExportTraceServiceRequest is available
  if (!ExportTraceServiceRequest) {
    throw new Error(
      'OTLP protobuf support not available. The OpenTelemetry proto definitions could not be loaded. ' +
      'Please use application/json content-type.'
    );
  }

  // Decode the protobuf message using OpenTelemetry proto definitions
  try {
    const decoded = ExportTraceServiceRequest.decode(buffer);

    // Convert to plain JavaScript object for processing
    const message = ExportTraceServiceRequest.toObject(decoded, {
      longs: String,  // Convert Long to string for JSON compatibility
      bytes: String,  // Convert bytes to base64 string
      defaults: false, // Don't include default values
      arrays: true,   // Always return arrays even if empty
      objects: true,  // Always return nested objects
    });

    console.log('[OTLP Traces] Successfully decoded protobuf message with',
      message.resourceSpans?.length || 0, 'resourceSpans');

    // Normalize the decoded message to match our OtlpExportTracesRequest interface
    return normalizeDecodedTracesProtobuf(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OTLP Traces] Failed to decode protobuf:', errorMessage);
    throw new Error(`Failed to decode OTLP traces protobuf: ${errorMessage}`);
  }
}

/**
 * Normalize decoded protobuf message to OtlpExportTracesRequest format.
 */
function normalizeDecodedTracesProtobuf(message: Record<string, unknown>): OtlpExportTracesRequest {
  const resourceSpans = message.resourceSpans as unknown[] | undefined;

  if (!Array.isArray(resourceSpans)) {
    return { resourceSpans: [] };
  }

  return {
    resourceSpans: resourceSpans.map(normalizeResourceSpansFromProtobuf),
  };
}

/**
 * Normalize ResourceSpans from protobuf format.
 */
function normalizeResourceSpansFromProtobuf(rs: unknown): OtlpResourceSpans {
  if (!rs || typeof rs !== 'object') return {};

  const data = rs as Record<string, unknown>;

  return {
    resource: data.resource as OtlpResource | undefined,
    scopeSpans: normalizeScopeSpansFromProtobuf(data.scopeSpans),
    schemaUrl: data.schemaUrl as string | undefined,
  };
}

/**
 * Normalize ScopeSpans from protobuf format.
 */
function normalizeScopeSpansFromProtobuf(ss: unknown): OtlpScopeSpans[] | undefined {
  if (!Array.isArray(ss)) return undefined;

  return ss.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope as OtlpInstrumentationScope | undefined,
      spans: normalizeSpansFromProtobuf(data.spans),
      schemaUrl: data.schemaUrl as string | undefined,
    };
  });
}

/**
 * Normalize Spans from protobuf format.
 * Handles the conversion of protobuf field types to our expected format.
 */
function normalizeSpansFromProtobuf(spans: unknown): OtlpSpan[] | undefined {
  if (!Array.isArray(spans)) return undefined;

  return spans.map((span) => {
    if (!span || typeof span !== 'object') return {};
    const data = span as Record<string, unknown>;

    return {
      traceId: normalizeTraceSpanId(data.traceId),
      spanId: normalizeTraceSpanId(data.spanId),
      traceState: data.traceState as string | undefined,
      parentSpanId: normalizeTraceSpanId(data.parentSpanId),
      name: data.name as string | undefined,
      kind: data.kind as number | undefined,
      startTimeUnixNano: data.startTimeUnixNano as string | bigint | undefined,
      endTimeUnixNano: data.endTimeUnixNano as string | bigint | undefined,
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      events: data.events as OtlpSpanEvent[] | undefined,
      links: normalizeLinksFromProtobuf(data.links),
      status: data.status as OtlpStatus | undefined,
    };
  });
}

/**
 * Normalize links from protobuf format.
 */
function normalizeLinksFromProtobuf(links: unknown): OtlpSpanLink[] | undefined {
  if (!Array.isArray(links)) return undefined;

  return links.map((link) => {
    if (!link || typeof link !== 'object') return {};
    const data = link as Record<string, unknown>;

    return {
      traceId: normalizeTraceSpanId(data.traceId),
      spanId: normalizeTraceSpanId(data.spanId),
      traceState: data.traceState as string | undefined,
      attributes: data.attributes as OtlpKeyValue[] | undefined,
    };
  });
}

/**
 * Convert trace/span ID from protobuf format (Uint8Array or base64 string) to hex string.
 */
function normalizeTraceSpanId(id: unknown): string | undefined {
  if (!id) return undefined;

  // If already a hex string, return as-is
  if (typeof id === 'string') {
    // Check if it's base64 encoded (from protobuf toObject with bytes: String)
    if (id.length > 0 && !/^[0-9a-fA-F]+$/.test(id)) {
      // It's base64, convert to hex
      try {
        const buffer = Buffer.from(id, 'base64');
        return buffer.toString('hex');
      } catch {
        return id; // Return as-is if conversion fails
      }
    }
    return id;
  }

  // If Uint8Array, convert to hex
  if (id instanceof Uint8Array || Buffer.isBuffer(id)) {
    return Buffer.from(id).toString('hex');
  }

  return undefined;
}
