import { describe, it, expect } from 'vitest';
import {
  transformOtlpToSpans,
  transformSpan,
  extractServiceName,
  nanosToIso,
  calculateDurationMs,
  mapSpanKind,
  mapStatusCode,
  transformEvents,
  transformLinks,
  parseOtlpTracesJson,
  OTLP_SPAN_KIND,
  OTLP_STATUS_CODE,
  type OtlpSpan,
} from '../../../modules/otlp/trace-transformer.js';

describe('OTLP Trace Transformer', () => {
  // ==========================================================================
  // transformOtlpToSpans
  // ==========================================================================
  describe('transformOtlpToSpans', () => {
    it('should return empty spans for empty request', () => {
      const result = transformOtlpToSpans({});

      expect(result.spans).toEqual([]);
      expect(result.traces.size).toBe(0);
    });

    it('should return empty spans for null resourceSpans', () => {
      const result = transformOtlpToSpans({ resourceSpans: undefined });

      expect(result.spans).toEqual([]);
    });

    it('should transform a basic span', () => {
      const now = BigInt(Date.now() * 1000000);
      const end = now + 100000000n;

      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'span1',
                    name: 'test-op',
                    startTimeUnixNano: now.toString(),
                    endTimeUnixNano: end.toString(),
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0].trace_id).toBe('abc123');
      expect(result.spans[0].span_id).toBe('span1');
      expect(result.spans[0].service_name).toBe('test-svc');
      expect(result.spans[0].operation_name).toBe('test-op');
    });

    it('should handle empty scopeSpans', () => {
      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            resource: {},
            scopeSpans: [],
          },
        ],
      });

      expect(result.spans).toEqual([]);
    });

    it('should handle null scopeSpans', () => {
      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            resource: {},
            scopeSpans: undefined,
          },
        ],
      });

      expect(result.spans).toEqual([]);
    });

    it('should handle empty spans array', () => {
      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            resource: {},
            scopeSpans: [{ spans: [] }],
          },
        ],
      });

      expect(result.spans).toEqual([]);
    });

    it('should aggregate trace information', () => {
      const now = BigInt(Date.now() * 1000000);

      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'root',
                    name: 'root-op',
                    startTimeUnixNano: now.toString(),
                    endTimeUnixNano: (now + 100000000n).toString(),
                  },
                  {
                    traceId: 'trace1',
                    spanId: 'child',
                    parentSpanId: 'root',
                    name: 'child-op',
                    startTimeUnixNano: (now + 10000000n).toString(),
                    endTimeUnixNano: (now + 50000000n).toString(),
                    status: { code: OTLP_STATUS_CODE.ERROR },
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(result.spans).toHaveLength(2);
      expect(result.traces.size).toBe(1);

      const trace = result.traces.get('trace1');
      expect(trace).toBeDefined();
      expect(trace?.span_count).toBe(2);
      expect(trace?.root_operation_name).toBe('root-op');
      expect(trace?.error).toBe(true);
    });

    it('should skip invalid spans (missing traceId)', () => {
      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span1',
                    name: 'test',
                  } as OtlpSpan,
                ],
              },
            ],
          },
        ],
      });

      expect(result.spans).toEqual([]);
    });

    it('should skip spans with all-zero trace IDs', () => {
      const result = transformOtlpToSpans({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: '00000000000000000000000000000000',
                    spanId: 'span1',
                    name: 'test',
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(result.spans).toEqual([]);
    });
  });

  // ==========================================================================
  // transformSpan
  // ==========================================================================
  describe('transformSpan', () => {
    it('should return null for span without traceId', () => {
      const result = transformSpan({ spanId: 'span1' } as OtlpSpan, 'svc', {});

      expect(result).toBeNull();
    });

    it('should return null for span without spanId', () => {
      const result = transformSpan({ traceId: 'trace1' } as OtlpSpan, 'svc', {});

      expect(result).toBeNull();
    });

    it('should return null for all-zero traceId', () => {
      const result = transformSpan(
        { traceId: '0000000000000000', spanId: 'span1' },
        'svc',
        {}
      );

      expect(result).toBeNull();
    });

    it('should transform a complete span', () => {
      const now = BigInt(Date.now() * 1000000);
      const end = now + 100000000n;

      const span: OtlpSpan = {
        traceId: 'trace123',
        spanId: 'span456',
        parentSpanId: 'parent789',
        name: 'my-operation',
        kind: OTLP_SPAN_KIND.SERVER,
        startTimeUnixNano: now.toString(),
        endTimeUnixNano: end.toString(),
        status: { code: OTLP_STATUS_CODE.OK, message: 'success' },
        attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
        events: [{ name: 'event1', timeUnixNano: now.toString() }],
        links: [{ traceId: 'linked', spanId: 'linkedSpan' }],
      };

      const result = transformSpan(span, 'my-service', { host: 'server1' });

      expect(result).not.toBeNull();
      expect(result?.trace_id).toBe('trace123');
      expect(result?.span_id).toBe('span456');
      expect(result?.parent_span_id).toBe('parent789');
      expect(result?.service_name).toBe('my-service');
      expect(result?.operation_name).toBe('my-operation');
      expect(result?.kind).toBe('SERVER');
      expect(result?.status_code).toBe('OK');
      expect(result?.status_message).toBe('success');
      expect(result?.attributes).toEqual({ 'http.method': 'GET' });
      expect(result?.resource_attributes).toEqual({ host: 'server1' });
    });

    it('should use "unknown" for missing operation name', () => {
      const result = transformSpan(
        { traceId: 'trace1', spanId: 'span1' },
        'svc',
        {}
      );

      expect(result?.operation_name).toBe('unknown');
    });

    it('should handle empty parentSpanId', () => {
      const result = transformSpan(
        { traceId: 'trace1', spanId: 'span1', parentSpanId: '' },
        'svc',
        {}
      );

      expect(result?.parent_span_id).toBeUndefined();
    });

    it('should handle missing status', () => {
      const result = transformSpan(
        { traceId: 'trace1', spanId: 'span1' },
        'svc',
        {}
      );

      expect(result?.status_code).toBeUndefined();
      expect(result?.status_message).toBeUndefined();
    });
  });

  // ==========================================================================
  // extractServiceName
  // ==========================================================================
  describe('extractServiceName', () => {
    it('should return "unknown" for undefined attributes', () => {
      expect(extractServiceName(undefined)).toBe('unknown');
    });

    it('should return "unknown" for empty attributes', () => {
      expect(extractServiceName([])).toBe('unknown');
    });

    it('should extract service.name from attributes', () => {
      const attrs = [
        { key: 'other.attr', value: { stringValue: 'foo' } },
        { key: 'service.name', value: { stringValue: 'my-service' } },
      ];

      expect(extractServiceName(attrs)).toBe('my-service');
    });

    it('should return "unknown" if service.name value is not stringValue', () => {
      const attrs = [{ key: 'service.name', value: { intValue: 123 } }];

      expect(extractServiceName(attrs)).toBe('unknown');
    });

    it('should return "unknown" if service.name has no value', () => {
      const attrs = [{ key: 'service.name' }] as any;

      expect(extractServiceName(attrs)).toBe('unknown');
    });
  });

  // ==========================================================================
  // nanosToIso
  // ==========================================================================
  describe('nanosToIso', () => {
    it('should return current time for undefined input', () => {
      const before = new Date().toISOString();
      const result = nanosToIso(undefined);
      const after = new Date().toISOString();

      // Result should be between before and after
      expect(result >= before).toBe(true);
      expect(result <= after).toBe(true);
    });

    it('should convert string nanoseconds to ISO', () => {
      // 1609459200000 ms = 2021-01-01T00:00:00.000Z
      const nanos = '1609459200000000000';
      const result = nanosToIso(nanos);

      expect(result).toBe('2021-01-01T00:00:00.000Z');
    });

    it('should convert bigint nanoseconds to ISO', () => {
      const nanos = 1609459200000000000n;
      const result = nanosToIso(nanos);

      expect(result).toBe('2021-01-01T00:00:00.000Z');
    });

    it('should handle invalid string gracefully', () => {
      const before = new Date().toISOString();
      const result = nanosToIso('not-a-number');
      const after = new Date().toISOString();

      expect(result >= before).toBe(true);
      expect(result <= after).toBe(true);
    });
  });

  // ==========================================================================
  // calculateDurationMs
  // ==========================================================================
  describe('calculateDurationMs', () => {
    it('should return 0 for undefined start', () => {
      expect(calculateDurationMs(undefined, '1000000000')).toBe(0);
    });

    it('should return 0 for undefined end', () => {
      expect(calculateDurationMs('1000000000', undefined)).toBe(0);
    });

    it('should calculate duration from string nanoseconds', () => {
      const start = '1000000000'; // 1 second = 1000 ms
      const end = '101000000000'; // 101 seconds = 101000 ms
      expect(calculateDurationMs(start, end)).toBe(100000); // 100 seconds = 100000 ms
    });

    it('should calculate duration from bigint nanoseconds', () => {
      const start = 1000000000n; // 1 second
      const end = 201000000000n; // 201 seconds
      expect(calculateDurationMs(start, end)).toBe(200000); // 200 seconds = 200000 ms
    });

    it('should handle mixed string and bigint', () => {
      // 51000000000n - 1000000000 = 50000000000 ns = 50000 ms
      expect(calculateDurationMs('1000000000', 51000000000n)).toBe(50000);
    });

    it('should handle invalid values gracefully', () => {
      expect(calculateDurationMs('invalid', '1000')).toBe(0);
    });
  });

  // ==========================================================================
  // mapSpanKind
  // ==========================================================================
  describe('mapSpanKind', () => {
    it('should return undefined for undefined kind', () => {
      expect(mapSpanKind(undefined)).toBeUndefined();
    });

    it('should return undefined for UNSPECIFIED (0)', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.UNSPECIFIED)).toBeUndefined();
    });

    it('should map INTERNAL', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.INTERNAL)).toBe('INTERNAL');
    });

    it('should map SERVER', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.SERVER)).toBe('SERVER');
    });

    it('should map CLIENT', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.CLIENT)).toBe('CLIENT');
    });

    it('should map PRODUCER', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.PRODUCER)).toBe('PRODUCER');
    });

    it('should map CONSUMER', () => {
      expect(mapSpanKind(OTLP_SPAN_KIND.CONSUMER)).toBe('CONSUMER');
    });

    it('should return undefined for unknown kind', () => {
      expect(mapSpanKind(99)).toBeUndefined();
    });
  });

  // ==========================================================================
  // mapStatusCode
  // ==========================================================================
  describe('mapStatusCode', () => {
    it('should return undefined for undefined code', () => {
      expect(mapStatusCode(undefined)).toBeUndefined();
    });

    it('should map UNSET', () => {
      expect(mapStatusCode(OTLP_STATUS_CODE.UNSET)).toBe('UNSET');
    });

    it('should map OK', () => {
      expect(mapStatusCode(OTLP_STATUS_CODE.OK)).toBe('OK');
    });

    it('should map ERROR', () => {
      expect(mapStatusCode(OTLP_STATUS_CODE.ERROR)).toBe('ERROR');
    });

    it('should return undefined for unknown code', () => {
      expect(mapStatusCode(99)).toBeUndefined();
    });
  });

  // ==========================================================================
  // transformEvents
  // ==========================================================================
  describe('transformEvents', () => {
    it('should return undefined for undefined events', () => {
      expect(transformEvents(undefined)).toBeUndefined();
    });

    it('should return undefined for empty events', () => {
      expect(transformEvents([])).toBeUndefined();
    });

    it('should transform events', () => {
      const now = BigInt(Date.now() * 1000000);
      const events = [
        {
          name: 'event1',
          timeUnixNano: now.toString(),
          attributes: [{ key: 'foo', value: { stringValue: 'bar' } }],
        },
        { name: 'event2' },
      ];

      const result = transformEvents(events);

      expect(result).toHaveLength(2);
      expect(result?.[0].name).toBe('event1');
      expect(result?.[0].attributes).toEqual({ foo: 'bar' });
      expect(result?.[1].name).toBe('event2');
    });

    it('should use "event" as default name', () => {
      const result = transformEvents([{}]);

      expect(result?.[0].name).toBe('event');
    });

    it('should handle events without attributes', () => {
      const result = transformEvents([{ name: 'test' }]);

      expect(result?.[0].attributes).toBeUndefined();
    });
  });

  // ==========================================================================
  // transformLinks
  // ==========================================================================
  describe('transformLinks', () => {
    it('should return undefined for undefined links', () => {
      expect(transformLinks(undefined)).toBeUndefined();
    });

    it('should return undefined for empty links', () => {
      expect(transformLinks([])).toBeUndefined();
    });

    it('should transform links', () => {
      const links = [
        {
          traceId: 'trace1',
          spanId: 'span1',
          attributes: [{ key: 'rel', value: { stringValue: 'cause' } }],
        },
        { traceId: 'trace2', spanId: 'span2' },
      ];

      const result = transformLinks(links);

      expect(result).toHaveLength(2);
      expect(result?.[0].trace_id).toBe('trace1');
      expect(result?.[0].span_id).toBe('span1');
      expect(result?.[0].attributes).toEqual({ rel: 'cause' });
      expect(result?.[1].trace_id).toBe('trace2');
      expect(result?.[1].span_id).toBe('span2');
    });

    it('should filter out links without traceId', () => {
      const links = [{ spanId: 'span1' }] as any;

      const result = transformLinks(links);

      expect(result).toEqual([]);
    });

    it('should filter out links without spanId', () => {
      const links = [{ traceId: 'trace1' }] as any;

      const result = transformLinks(links);

      expect(result).toEqual([]);
    });

    it('should handle links without attributes', () => {
      const result = transformLinks([{ traceId: 't', spanId: 's' }]);

      expect(result?.[0].attributes).toBeUndefined();
    });
  });

  // ==========================================================================
  // parseOtlpTracesJson
  // ==========================================================================
  describe('parseOtlpTracesJson', () => {
    it('should return empty resourceSpans for null body', () => {
      const result = parseOtlpTracesJson(null);

      expect(result.resourceSpans).toEqual([]);
    });

    it('should return empty resourceSpans for undefined body', () => {
      const result = parseOtlpTracesJson(undefined);

      expect(result.resourceSpans).toEqual([]);
    });

    it('should parse object body directly', () => {
      const body = {
        resourceSpans: [
          {
            resource: {},
            scopeSpans: [{ spans: [] }],
          },
        ],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans).toHaveLength(1);
    });

    it('should parse JSON string body', () => {
      const body = JSON.stringify({
        resourceSpans: [{ scopeSpans: [{ spans: [] }] }],
      });

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans).toHaveLength(1);
    });

    it('should throw error for invalid JSON string', () => {
      expect(() => parseOtlpTracesJson('not valid json')).toThrow('Invalid OTLP Traces JSON');
    });

    it('should throw error for invalid body type', () => {
      expect(() => parseOtlpTracesJson(12345 as any)).toThrow(
        'Invalid OTLP traces request body type'
      );
    });

    it('should normalize snake_case to camelCase', () => {
      const body = {
        resource_spans: [
          {
            resource: {},
            scope_spans: [
              {
                spans: [
                  {
                    trace_id: 'trace1',
                    span_id: 'span1',
                    parent_span_id: 'parent1',
                    trace_state: 'state',
                    start_time_unix_nano: '1000',
                    end_time_unix_nano: '2000',
                  },
                ],
                schema_url: 'https://example.com',
              },
            ],
            schema_url: 'https://example.com/resource',
          },
        ],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans).toHaveLength(1);
      expect(result.resourceSpans?.[0]?.scopeSpans).toBeDefined();

      const span = result.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
      expect(span?.traceId).toBe('trace1');
      expect(span?.spanId).toBe('span1');
      expect(span?.parentSpanId).toBe('parent1');
      expect(span?.traceState).toBe('state');
      expect(span?.startTimeUnixNano).toBe('1000');
      expect(span?.endTimeUnixNano).toBe('2000');
    });

    it('should handle missing resourceSpans', () => {
      const result = parseOtlpTracesJson({});

      expect(result.resourceSpans).toEqual([]);
    });

    it('should handle invalid resourceSpans item', () => {
      const body = {
        resourceSpans: [null, undefined, 'invalid'],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans).toHaveLength(3);
    });

    it('should handle null scopeSpans', () => {
      const body = {
        resourceSpans: [{ scopeSpans: null }],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans?.[0]?.scopeSpans).toBeUndefined();
    });

    it('should handle invalid scope spans item', () => {
      const body = {
        resourceSpans: [{ scopeSpans: [null, 'invalid'] }],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans?.[0]?.scopeSpans).toHaveLength(2);
    });

    it('should handle null spans', () => {
      const body = {
        resourceSpans: [{ scopeSpans: [{ spans: null }] }],
      };

      const result = parseOtlpTracesJson(body);

      expect(result.resourceSpans?.[0]?.scopeSpans?.[0]?.spans).toBeUndefined();
    });

    it('should handle invalid span item', () => {
      const body = {
        resourceSpans: [{ scopeSpans: [{ spans: [null, 'invalid'] }] }],
      };

      const result = parseOtlpTracesJson(body);

      const spans = result.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
      expect(spans).toHaveLength(2);
    });
  });
});
