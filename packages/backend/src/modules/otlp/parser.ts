/**
 * OTLP Parser
 *
 * Parses OpenTelemetry Protocol messages in both JSON and Protobuf formats.
 *
 * JSON format: Standard JSON encoding of OTLP messages
 * Protobuf format: Binary protocol buffer encoding using OpenTelemetry proto definitions
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import type { OtlpExportLogsRequest } from './transformer.js';
import { createRequire } from 'module';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';

// Import the generated protobuf definitions from @opentelemetry/otlp-transformer
// The module exports a protobufjs Root object with all OpenTelemetry proto definitions
const require = createRequire(import.meta.url);
const $root = require('@opentelemetry/otlp-transformer/build/esm/generated/root.js');

// Get the ExportLogsServiceRequest message type for decoding protobuf messages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExportLogsServiceRequest: any = $root.opentelemetry?.proto?.collector?.logs?.v1?.ExportLogsServiceRequest;

// ============================================================================
// Gzip Decompression
// ============================================================================

/**
 * Check if buffer is gzip compressed by checking magic bytes.
 * Gzip files start with 0x1f 0x8b.
 */
export function isGzipCompressed(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/**
 * Decompress gzip data.
 */
export async function decompressGzip(buffer: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const gunzip = createGunzip();
  const input = Readable.from(buffer);
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });

  await pipeline(input, gunzip, output);
  return Buffer.concat(chunks);
}

// ============================================================================
// JSON Parser
// ============================================================================

/**
 * Parse OTLP JSON request body.
 * OTLP JSON uses camelCase field names per the specification.
 *
 * @param body - Raw request body (string or object)
 * @returns Parsed OTLP request
 * @throws Error if parsing fails
 */
export function parseOtlpJson(body: unknown): OtlpExportLogsRequest {
  if (!body) {
    return { resourceLogs: [] };
  }

  // If already an object, use directly
  if (typeof body === 'object') {
    return normalizeOtlpRequest(body as Record<string, unknown>);
  }

  // If string, parse as JSON
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return normalizeOtlpRequest(parsed);
    } catch (error) {
      throw new Error(`Invalid OTLP JSON: ${(error as Error).message}`);
    }
  }

  throw new Error('Invalid OTLP request body type');
}

/**
 * Normalize OTLP request to handle both camelCase and snake_case field names.
 * Some OTLP exporters use snake_case instead of camelCase.
 */
function normalizeOtlpRequest(data: Record<string, unknown>): OtlpExportLogsRequest {
  // Handle both resourceLogs and resource_logs
  const resourceLogs = (data.resourceLogs ?? data.resource_logs) as unknown[];

  if (!Array.isArray(resourceLogs)) {
    return { resourceLogs: [] };
  }

  return {
    resourceLogs: resourceLogs.map(normalizeResourceLogs),
  };
}

function normalizeResourceLogs(rl: unknown): Record<string, unknown> {
  if (!rl || typeof rl !== 'object') return {};

  const data = rl as Record<string, unknown>;

  return {
    resource: data.resource,
    scopeLogs: normalizeScopeLogs(data.scopeLogs ?? data.scope_logs),
    schemaUrl: data.schemaUrl ?? data.schema_url,
  };
}

function normalizeScopeLogs(sl: unknown): unknown[] {
  if (!Array.isArray(sl)) return [];

  return sl.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope,
      logRecords: normalizeLogRecords(data.logRecords ?? data.log_records),
      schemaUrl: data.schemaUrl ?? data.schema_url,
    };
  });
}

function normalizeLogRecords(lr: unknown): unknown[] {
  if (!Array.isArray(lr)) return [];

  return lr.map((l) => {
    if (!l || typeof l !== 'object') return {};
    const data = l as Record<string, unknown>;

    return {
      timeUnixNano: data.timeUnixNano ?? data.time_unix_nano,
      observedTimeUnixNano: data.observedTimeUnixNano ?? data.observed_time_unix_nano,
      severityNumber: data.severityNumber ?? data.severity_number,
      severityText: data.severityText ?? data.severity_text,
      body: data.body,
      attributes: data.attributes,
      droppedAttributesCount: data.droppedAttributesCount ?? data.dropped_attributes_count,
      flags: data.flags,
      traceId: data.traceId ?? data.trace_id,
      spanId: data.spanId ?? data.span_id,
    };
  });
}

// ============================================================================
// Protobuf Parser
// ============================================================================

/**
 * Parse OTLP Protobuf request body.
 *
 * Uses the OpenTelemetry proto definitions from @opentelemetry/otlp-transformer
 * to properly decode binary protobuf messages.
 *
 * Automatically detects and decompresses gzip-compressed data by checking
 * for gzip magic bytes (0x1f 0x8b), regardless of Content-Encoding header.
 * This handles cases where OTLP clients (like OpenTelemetry Collector) send
 * compressed data without setting the Content-Encoding header.
 *
 * @param buffer - Raw protobuf buffer (may be gzip compressed)
 * @returns Parsed OTLP request
 * @throws Error if parsing fails
 */
export async function parseOtlpProtobuf(buffer: Buffer): Promise<OtlpExportLogsRequest> {
  // Auto-detect gzip compression by magic bytes (0x1f 0x8b)
  // This handles cases where Content-Encoding header is not set
  if (isGzipCompressed(buffer)) {
    console.log('[OTLP] Auto-detected gzip compression by magic bytes, decompressing...');
    try {
      buffer = await decompressGzip(buffer);
      console.log(`[OTLP] Decompressed protobuf data to ${buffer.length} bytes`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[OTLP] Gzip decompression failed:', errMsg);
      throw new Error(`Failed to decompress gzip data: ${errMsg}`);
    }
  }

  // First, try to parse as JSON (some clients send JSON with protobuf content-type)
  try {
    const jsonString = buffer.toString('utf-8');
    if (jsonString.startsWith('{') || jsonString.startsWith('[')) {
      console.log('[OTLP] Protobuf content-type but JSON payload detected, parsing as JSON');
      return parseOtlpJson(jsonString);
    }
  } catch {
    // Not JSON, continue to protobuf parsing
  }

  // Verify ExportLogsServiceRequest is available
  if (!ExportLogsServiceRequest) {
    throw new Error(
      'OTLP protobuf support not available. The OpenTelemetry proto definitions could not be loaded. ' +
      'Please use application/json content-type.'
    );
  }

  // Decode the protobuf message using OpenTelemetry proto definitions
  try {
    const decoded = ExportLogsServiceRequest.decode(buffer);

    // Convert to plain JavaScript object for processing
    const message = ExportLogsServiceRequest.toObject(decoded, {
      longs: String,  // Convert Long to string for JSON compatibility
      bytes: String,  // Convert bytes to base64 string
      defaults: false, // Don't include default values
      arrays: true,   // Always return arrays even if empty
      objects: true,  // Always return nested objects
    });

    console.log('[OTLP] Successfully decoded protobuf message with',
      message.resourceLogs?.length || 0, 'resourceLogs');

    // Normalize the decoded message to match our OtlpExportLogsRequest interface
    return normalizeDecodedProtobuf(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OTLP] Failed to decode protobuf:', errorMessage);
    throw new Error(`Failed to decode OTLP protobuf: ${errorMessage}`);
  }
}

/**
 * Normalize decoded protobuf message to OtlpExportLogsRequest format.
 * The protobuf decoder uses different field names than our interface.
 */
function normalizeDecodedProtobuf(message: Record<string, unknown>): OtlpExportLogsRequest {
  const resourceLogs = message.resourceLogs as unknown[] | undefined;

  if (!Array.isArray(resourceLogs)) {
    return { resourceLogs: [] };
  }

  return {
    resourceLogs: resourceLogs.map(normalizeResourceLogsFromProtobuf),
  };
}

/**
 * Normalize ResourceLogs from protobuf format.
 */
function normalizeResourceLogsFromProtobuf(rl: unknown): Record<string, unknown> {
  if (!rl || typeof rl !== 'object') return {};

  const data = rl as Record<string, unknown>;

  return {
    resource: data.resource,
    scopeLogs: normalizeScopeLogsFromProtobuf(data.scopeLogs),
    schemaUrl: data.schemaUrl,
  };
}

/**
 * Normalize ScopeLogs from protobuf format.
 */
function normalizeScopeLogsFromProtobuf(sl: unknown): unknown[] {
  if (!Array.isArray(sl)) return [];

  return sl.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope,
      logRecords: normalizeLogRecordsFromProtobuf(data.logRecords),
      schemaUrl: data.schemaUrl,
    };
  });
}

/**
 * Normalize LogRecords from protobuf format.
 * Handles the conversion of protobuf field types to our expected format.
 */
function normalizeLogRecordsFromProtobuf(lr: unknown): unknown[] {
  if (!Array.isArray(lr)) return [];

  return lr.map((l) => {
    if (!l || typeof l !== 'object') return {};
    const data = l as Record<string, unknown>;

    // Debug log to see actual protobuf structure
    if (process.env.OTLP_DEBUG === 'true') {
      console.log('[OTLP Debug] Raw log record from protobuf:', JSON.stringify(data, null, 2));
    }

    // Normalize the body - protobuf decoder may use different structure
    const normalizedBody = normalizeBodyFromProtobuf(data.body);

    return {
      timeUnixNano: data.timeUnixNano,
      observedTimeUnixNano: data.observedTimeUnixNano,
      severityNumber: data.severityNumber,
      severityText: data.severityText,
      body: normalizedBody,
      attributes: normalizeAttributesFromProtobuf(data.attributes),
      droppedAttributesCount: data.droppedAttributesCount,
      flags: data.flags,
      // Convert Uint8Array trace/span IDs to hex strings
      traceId: normalizeTraceSpanId(data.traceId),
      spanId: normalizeTraceSpanId(data.spanId),
    };
  });
}

/**
 * Normalize body (AnyValue) from protobuf format.
 * The protobuf decoder may encode values differently.
 */
function normalizeBodyFromProtobuf(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const data = body as Record<string, unknown>;

  // If it already has our expected structure, return as-is
  if (data.stringValue !== undefined ||
      data.boolValue !== undefined ||
      data.intValue !== undefined ||
      data.doubleValue !== undefined ||
      data.arrayValue !== undefined ||
      data.kvlistValue !== undefined ||
      data.bytesValue !== undefined) {
    return data as Record<string, unknown>;
  }

  // Check for protobuf snake_case variants
  if ((data as Record<string, unknown>).string_value !== undefined) {
    return { stringValue: (data as Record<string, unknown>).string_value };
  }
  if ((data as Record<string, unknown>).bool_value !== undefined) {
    return { boolValue: (data as Record<string, unknown>).bool_value };
  }
  if ((data as Record<string, unknown>).int_value !== undefined) {
    return { intValue: (data as Record<string, unknown>).int_value };
  }
  if ((data as Record<string, unknown>).double_value !== undefined) {
    return { doubleValue: (data as Record<string, unknown>).double_value };
  }
  if ((data as Record<string, unknown>).array_value !== undefined) {
    return { arrayValue: (data as Record<string, unknown>).array_value };
  }
  if ((data as Record<string, unknown>).kvlist_value !== undefined) {
    return { kvlistValue: (data as Record<string, unknown>).kvlist_value };
  }
  if ((data as Record<string, unknown>).bytes_value !== undefined) {
    return { bytesValue: (data as Record<string, unknown>).bytes_value };
  }

  // If the body is something else, try to extract the value
  // Some protobuf decoders might use 'value' as a wrapper
  if ((data as Record<string, unknown>).value !== undefined) {
    return normalizeBodyFromProtobuf((data as Record<string, unknown>).value);
  }

  // Return as-is and let the transformer handle it
  return data as Record<string, unknown>;
}

/**
 * Normalize attributes from protobuf format.
 */
function normalizeAttributesFromProtobuf(attrs: unknown): unknown[] | undefined {
  if (!Array.isArray(attrs)) return undefined;

  return attrs.map((attr) => {
    if (!attr || typeof attr !== 'object') return attr;
    const data = attr as Record<string, unknown>;

    return {
      key: data.key,
      value: normalizeBodyFromProtobuf(data.value),
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

// ============================================================================
// Content-Type Detection
// ============================================================================

export type OtlpContentType = 'json' | 'protobuf' | 'unknown';

/**
 * Detect OTLP content type from Content-Type header.
 *
 * @param contentType - Content-Type header value
 * @returns Detected content type
 */
export function detectContentType(contentType?: string): OtlpContentType {
  if (!contentType) return 'unknown';

  const normalized = contentType.toLowerCase();

  if (normalized.includes('application/json')) {
    return 'json';
  }

  if (
    normalized.includes('application/x-protobuf') ||
    normalized.includes('application/protobuf')
  ) {
    return 'protobuf';
  }

  return 'unknown';
}

/**
 * Parse OTLP request based on content type.
 *
 * @param body - Request body (Buffer for protobuf, object/string for JSON)
 * @param contentType - Content-Type header value
 * @returns Parsed OTLP request
 */
export async function parseOtlpRequest(
  body: unknown,
  contentType?: string
): Promise<OtlpExportLogsRequest> {
  const type = detectContentType(contentType);

  switch (type) {
    case 'json':
      return parseOtlpJson(body);

    case 'protobuf':
      if (!Buffer.isBuffer(body)) {
        throw new Error('Protobuf content-type requires Buffer body');
      }
      return parseOtlpProtobuf(body);

    default:
      // Try JSON as fallback
      return parseOtlpJson(body);
  }
}
