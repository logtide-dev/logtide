import { describe, it, expect } from 'vitest';
import {
  transformOtlpToLogTide,
  transformLogRecord,
  extractServiceName,
  sanitizeServiceName,
  MAX_SERVICE_NAME_LENGTH,
  nanosToIso,
  normalizeTraceId,
  extractMessage,
  attributesToRecord,
  anyValueToJs,
  type OtlpExportLogsRequest,
  type OtlpLogRecord,
  type OtlpKeyValue,
  type OtlpAnyValue,
} from '../../../modules/otlp/transformer.js';

describe('OTLP Transformer', () => {
  describe('transformOtlpToLogTide', () => {
    it('should transform empty request', () => {
      const result = transformOtlpToLogTide({});
      expect(result).toEqual([]);
    });

    it('should transform empty resourceLogs', () => {
      const result = transformOtlpToLogTide({ resourceLogs: [] });
      expect(result).toEqual([]);
    });

    it('should transform a basic log record', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-service' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000', // 2023-11-14T22:13:20.000Z
                    severityNumber: 17, // ERROR
                    severityText: 'ERROR',
                    body: { stringValue: 'Test error message' },
                    traceId: '0af7651916cd43dd8448eb211c80319c',
                    spanId: 'b7ad6b7169203331',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        service: 'test-service',
        level: 'error',
        message: 'Test error message',
        trace_id: '0af7651916cd43dd8448eb211c80319c',
        span_id: 'b7ad6b7169203331',
      });
      expect(result[0].metadata).toMatchObject({
        'otel.severity_number': 17,
        'otel.severity_text': 'ERROR',
      });
    });

    it('should transform multiple logs from multiple resources', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'service-a' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  { body: { stringValue: 'Log 1' }, severityNumber: 9 },
                  { body: { stringValue: 'Log 2' }, severityNumber: 9 },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'service-b' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  { body: { stringValue: 'Log 3' }, severityNumber: 13 },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);

      expect(result).toHaveLength(3);
      expect(result[0].service).toBe('service-a');
      expect(result[0].message).toBe('Log 1');
      expect(result[1].service).toBe('service-a');
      expect(result[1].message).toBe('Log 2');
      expect(result[2].service).toBe('service-b');
      expect(result[2].message).toBe('Log 3');
    });

    it('should include scope metadata', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: {
                  name: 'my-library',
                  version: '1.0.0',
                },
                logRecords: [
                  { body: { stringValue: 'Test' } },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);

      expect(result[0].metadata).toMatchObject({
        'otel.scope.name': 'my-library',
        'otel.scope.version': '1.0.0',
      });
    });

    it('should include resource attributes namespaced under metadata.resource', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'my-service' } },
                { key: 'service.version', value: { stringValue: '2.0.0' } },
                { key: 'host.name', value: { stringValue: 'server-1' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [{ body: { stringValue: 'Test' } }],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);

      // resource attrs go under metadata.resource, not flat at top level
      expect(result[0].metadata?.resource).toMatchObject({
        'service.name': 'my-service',
        'service.version': '2.0.0',
        'host.name': 'server-1',
      });
      // must NOT be flat at top level
      expect(result[0].metadata).not.toHaveProperty('service.version');
      expect(result[0].metadata).not.toHaveProperty('host.name');
    });

    // --- new tests for structured body preservation ---

    it('should preserve kvlist body structure under metadata[otel.body]', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: {
                      kvlistValue: {
                        values: [
                          { key: 'user', value: { stringValue: 'a' } },
                          { key: 'count', value: { intValue: 3 } },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const log = result[0];

      // message is still the JSON string (existing behavior unchanged)
      expect(log.message).toBe('{"user":"a","count":3}');
      // structured body also preserved as decoded object
      expect(log.metadata?.['otel.body']).toEqual({ user: 'a', count: 3 });
    });

    it('should preserve array body structure under metadata[otel.body]', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: {
                      arrayValue: {
                        values: [
                          { stringValue: 'x' },
                          { intValue: 1 },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const log = result[0];

      // metadata['otel.body'] should be the decoded array
      expect(log.metadata?.['otel.body']).toEqual(['x', 1]);
    });

    it('should NOT add otel.body for string bodies', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: { stringValue: 'just a string' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const log = result[0];

      expect(log.message).toBe('just a string');
      expect(log.metadata).not.toHaveProperty('otel.body');
    });

    it('should namespace resource attrs and keep log attrs flat', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
                { key: 'host.name', value: { stringValue: 'h1' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: { stringValue: 'msg' },
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const meta = result[0].metadata!;

      expect(meta.resource).toMatchObject({ 'service.name': 'svc', 'host.name': 'h1' });
      expect(meta['http.method']).toBe('GET');
      // resource keys must NOT be flat at top level
      expect(meta).not.toHaveProperty('host.name');
    });

    it('should handle collision: log attr wins flat space, resource attr preserved under resource', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
                { key: 'env', value: { stringValue: 'prod' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: { stringValue: 'msg' },
                    attributes: [
                      { key: 'env', value: { stringValue: 'dev' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const meta = result[0].metadata!;

      // log attr wins the flat space
      expect(meta['env']).toBe('dev');
      // resource attr preserved under resource
      expect((meta.resource as Record<string, unknown>)['env']).toBe('prod');
    });

    it('should keep otel.scope.* keys flat in metadata', () => {
      const request: OtlpExportLogsRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
              ],
            },
            scopeLogs: [
              {
                scope: {
                  name: 'my-lib',
                  version: '1.2.3',
                },
                logRecords: [
                  { body: { stringValue: 'msg' } },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToLogTide(request);
      const meta = result[0].metadata!;

      expect(meta['otel.scope.name']).toBe('my-lib');
      expect(meta['otel.scope.version']).toBe('1.2.3');
    });
  });

  describe('transformLogRecord', () => {
    it('should transform log record with all fields', () => {
      const record: OtlpLogRecord = {
        timeUnixNano: '1700000000000000000',
        severityNumber: 17,
        severityText: 'ERROR',
        body: { stringValue: 'Error message' },
        attributes: [
          { key: 'user.id', value: { stringValue: '123' } },
        ],
        traceId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
        spanId: '1234567890abcdef',
      };

      const result = transformLogRecord(record, 'test-service', {});

      expect(result.service).toBe('test-service');
      expect(result.level).toBe('error');
      expect(result.message).toBe('Error message');
      expect(result.trace_id).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
      expect(result.span_id).toBe('1234567890abcdef');
      expect(result.metadata).toMatchObject({
        'user.id': '123',
        'otel.severity_number': 17,
        'otel.severity_text': 'ERROR',
      });
    });

    it('should merge base metadata with log attributes', () => {
      const record: OtlpLogRecord = {
        body: { stringValue: 'Test' },
        attributes: [
          { key: 'log.attr', value: { stringValue: 'value1' } },
        ],
      };

      const baseMetadata = {
        'resource.attr': 'value2',
      };

      const result = transformLogRecord(record, 'service', baseMetadata);

      expect(result.metadata).toMatchObject({
        'resource.attr': 'value2',
        'log.attr': 'value1',
      });
    });
  });

  describe('extractServiceName', () => {
    it('should extract service.name from attributes', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { stringValue: 'my-service' } },
        { key: 'other.attr', value: { stringValue: 'value' } },
      ];

      expect(extractServiceName(attrs)).toBe('my-service');
    });

    it('should return "unknown" if service.name not found', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'other.attr', value: { stringValue: 'value' } },
      ];

      expect(extractServiceName(attrs)).toBe('unknown');
    });

    it('should return "unknown" for empty attributes', () => {
      expect(extractServiceName([])).toBe('unknown');
    });

    it('should return "unknown" for undefined attributes', () => {
      expect(extractServiceName(undefined)).toBe('unknown');
    });

    it('should return "unknown" if service.name is not a string', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { intValue: 123 } },
      ];

      expect(extractServiceName(attrs)).toBe('unknown');
    });

    it('strips control characters from service.name (defense-in-depth)', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { stringValue: 'api\x00-svc\x07\x1bx' } },
      ];

      expect(extractServiceName(attrs)).toBe('api-svcx');
    });

    it('caps an over-long service.name', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { stringValue: 'a'.repeat(1000) } },
      ];

      expect(extractServiceName(attrs)).toHaveLength(MAX_SERVICE_NAME_LENGTH);
    });

    it('preserves legitimate punctuation (escaping happens at the sink)', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { stringValue: '<img src=x>' } },
      ];

      // Not stripped here: the value stays raw and is HTML-escaped at render time.
      expect(extractServiceName(attrs)).toBe('<img src=x>');
    });

    it('falls back to "unknown" when only control characters remain', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'service.name', value: { stringValue: '\x00\x01\x02' } },
      ];

      expect(extractServiceName(attrs)).toBe('unknown');
    });
  });

  describe('sanitizeServiceName', () => {
    it('passes through a normal name', () => {
      expect(sanitizeServiceName('payment-service')).toBe('payment-service');
    });

    it('removes null bytes and other control characters', () => {
      expect(sanitizeServiceName('a\x00b\x1fc\x7fd')).toBe('abcd');
    });

    it('caps length at MAX_SERVICE_NAME_LENGTH', () => {
      expect(sanitizeServiceName('x'.repeat(MAX_SERVICE_NAME_LENGTH + 50))).toHaveLength(
        MAX_SERVICE_NAME_LENGTH,
      );
    });

    it('returns "unknown" when empty after cleaning', () => {
      expect(sanitizeServiceName('\x00\x01')).toBe('unknown');
      expect(sanitizeServiceName('')).toBe('unknown');
    });
  });

  describe('nanosToIso', () => {
    it('should convert nanoseconds string to ISO', () => {
      // 1700000000000000000 ns = 2023-11-14T22:13:20.000Z
      const result = nanosToIso('1700000000000000000');
      expect(result).toBe('2023-11-14T22:13:20.000Z');
    });

    it('should convert bigint nanoseconds to ISO', () => {
      const result = nanosToIso(1700000000000000000n);
      expect(result).toBe('2023-11-14T22:13:20.000Z');
    });

    it('should handle undefined', () => {
      const result = nanosToIso(undefined);
      // Should be current time, just check it's a valid ISO string
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle empty string', () => {
      const result = nanosToIso('');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle millisecond precision', () => {
      // 1700000000123456789 ns should preserve ms precision
      const result = nanosToIso('1700000000123456789');
      expect(result).toBe('2023-11-14T22:13:20.123Z');
    });
  });

  describe('normalizeTraceId', () => {
    it('should return trace_id as-is', () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const result = normalizeTraceId(traceId);
      expect(result).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('should accept any string format', () => {
      expect(normalizeTraceId('short-trace')).toBe('short-trace');
      expect(normalizeTraceId('very-long-trace-id-string-12345')).toBe('very-long-trace-id-string-12345');
      expect(normalizeTraceId('custom-format-123')).toBe('custom-format-123');
    });

    it('should return undefined for empty string', () => {
      expect(normalizeTraceId('')).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(normalizeTraceId(undefined)).toBeUndefined();
    });

    it('should return undefined for all zeros', () => {
      expect(normalizeTraceId('00000000000000000000000000000000')).toBeUndefined();
      expect(normalizeTraceId('0000')).toBeUndefined();
    });

    it('should handle lowercase hex', () => {
      const traceId = 'abcdef0123456789abcdef0123456789';
      const result = normalizeTraceId(traceId);
      expect(result).toBe('abcdef0123456789abcdef0123456789');
    });
  });

  describe('extractMessage', () => {
    it('should extract string value', () => {
      expect(extractMessage({ stringValue: 'Hello world' })).toBe('Hello world');
    });

    it('should extract integer value', () => {
      expect(extractMessage({ intValue: 42 })).toBe('42');
      expect(extractMessage({ intValue: '9007199254740993' })).toBe('9007199254740993');
    });

    it('should extract double value', () => {
      expect(extractMessage({ doubleValue: 3.14 })).toBe('3.14');
    });

    it('should extract boolean value', () => {
      expect(extractMessage({ boolValue: true })).toBe('true');
      expect(extractMessage({ boolValue: false })).toBe('false');
    });

    it('should extract array value as JSON', () => {
      const body: OtlpAnyValue = {
        arrayValue: {
          values: [
            { stringValue: 'a' },
            { stringValue: 'b' },
          ],
        },
      };
      expect(extractMessage(body)).toBe('["a","b"]');
    });

    it('should extract kvlist value as JSON', () => {
      const body: OtlpAnyValue = {
        kvlistValue: {
          values: [
            { key: 'name', value: { stringValue: 'test' } },
            { key: 'count', value: { intValue: 5 } },
          ],
        },
      };
      expect(extractMessage(body)).toBe('{"name":"test","count":5}');
    });

    it('should handle bytes value', () => {
      expect(extractMessage({ bytesValue: 'SGVsbG8=' })).toBe('[bytes: SGVsbG8=]');
    });

    it('should return empty string for undefined', () => {
      expect(extractMessage(undefined)).toBe('');
    });

    it('should return empty string for empty body', () => {
      expect(extractMessage({})).toBe('');
    });
  });

  describe('attributesToRecord', () => {
    it('should convert attributes to record', () => {
      const attrs: OtlpKeyValue[] = [
        { key: 'string.attr', value: { stringValue: 'value' } },
        { key: 'int.attr', value: { intValue: 42 } },
        { key: 'bool.attr', value: { boolValue: true } },
      ];

      const result = attributesToRecord(attrs);

      expect(result).toEqual({
        'string.attr': 'value',
        'int.attr': 42,
        'bool.attr': true,
      });
    });

    it('should handle empty attributes', () => {
      expect(attributesToRecord([])).toEqual({});
    });

    it('should handle undefined attributes', () => {
      expect(attributesToRecord(undefined)).toEqual({});
    });

    it('should handle nested kvlist', () => {
      const attrs: OtlpKeyValue[] = [
        {
          key: 'nested',
          value: {
            kvlistValue: {
              values: [
                { key: 'inner', value: { stringValue: 'value' } },
              ],
            },
          },
        },
      ];

      const result = attributesToRecord(attrs);

      expect(result).toEqual({
        nested: { inner: 'value' },
      });
    });
  });

  describe('anyValueToJs', () => {
    it('should convert string value', () => {
      expect(anyValueToJs({ stringValue: 'test' })).toBe('test');
    });

    it('should convert int value', () => {
      expect(anyValueToJs({ intValue: 42 })).toBe(42);
      expect(anyValueToJs({ intValue: '123' })).toBe(123);
    });

    it('should convert double value', () => {
      expect(anyValueToJs({ doubleValue: 3.14 })).toBe(3.14);
    });

    it('should convert bool value', () => {
      expect(anyValueToJs({ boolValue: true })).toBe(true);
      expect(anyValueToJs({ boolValue: false })).toBe(false);
    });

    it('should convert bytes value', () => {
      expect(anyValueToJs({ bytesValue: 'SGVsbG8=' })).toBe('SGVsbG8=');
    });

    it('should convert array value', () => {
      const value: OtlpAnyValue = {
        arrayValue: {
          values: [
            { stringValue: 'a' },
            { intValue: 1 },
          ],
        },
      };
      expect(anyValueToJs(value)).toEqual(['a', 1]);
    });

    it('should convert kvlist value', () => {
      const value: OtlpAnyValue = {
        kvlistValue: {
          values: [
            { key: 'a', value: { stringValue: 'b' } },
          ],
        },
      };
      expect(anyValueToJs(value)).toEqual({ a: 'b' });
    });

    it('should return null for undefined', () => {
      expect(anyValueToJs(undefined)).toBeNull();
    });

    it('should return null for empty value', () => {
      expect(anyValueToJs({})).toBeNull();
    });
  });
});
