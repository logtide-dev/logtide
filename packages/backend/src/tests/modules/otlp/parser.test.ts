import { describe, it, expect } from 'vitest';
import {
  parseOtlpJson,
  parseOtlpProtobuf,
  detectContentType,
  parseOtlpRequest,
} from '../../../modules/otlp/parser.js';

describe('OTLP Parser', () => {
  // ==========================================================================
  // parseOtlpJson
  // ==========================================================================
  describe('parseOtlpJson', () => {
    it('should return empty resourceLogs for null body', () => {
      const result = parseOtlpJson(null);

      expect(result.resourceLogs).toEqual([]);
    });

    it('should return empty resourceLogs for undefined body', () => {
      const result = parseOtlpJson(undefined);

      expect(result.resourceLogs).toEqual([]);
    });

    it('should parse object body directly', () => {
      const body = {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  { body: { stringValue: 'test' } },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should parse JSON string body', () => {
      const body = JSON.stringify({
        resourceLogs: [
          {
            resource: {},
            scopeLogs: [
              {
                logRecords: [{ severityNumber: 9 }],
              },
            ],
          },
        ],
      });

      const result = parseOtlpJson(body);

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should throw error for invalid JSON string', () => {
      expect(() => parseOtlpJson('not valid json')).toThrow('Invalid OTLP JSON');
    });

    it('should throw error for invalid body type', () => {
      expect(() => parseOtlpJson(12345 as unknown)).toThrow('Invalid OTLP request body type');
    });

    it('should handle missing resourceLogs gracefully', () => {
      const result = parseOtlpJson({ someOther: 'field' });

      expect(result.resourceLogs).toEqual([]);
    });

    it('should normalize snake_case to camelCase for resourceLogs', () => {
      const body = {
        resource_logs: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-svc' } }] },
            scope_logs: [
              {
                log_records: [
                  {
                    time_unix_nano: '1234567890000000000',
                    severity_number: 9,
                    severity_text: 'INFO',
                    trace_id: 'abc123',
                    span_id: 'def456',
                    observed_time_unix_nano: '1234567890000000000',
                    dropped_attributes_count: 0,
                  },
                ],
                schema_url: 'https://example.com/schema',
              },
            ],
            schema_url: 'https://example.com/schema',
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect(result.resourceLogs).toHaveLength(1);
      expect(result.resourceLogs[0]).toHaveProperty('scopeLogs');
      expect((result.resourceLogs[0] as any).scopeLogs[0]).toHaveProperty('logRecords');
      expect((result.resourceLogs[0] as any).scopeLogs[0]).toHaveProperty('schemaUrl');
    });

    it('should handle empty scopeLogs', () => {
      const body = {
        resourceLogs: [
          {
            resource: {},
            scopeLogs: [],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect(result.resourceLogs).toHaveLength(1);
      expect((result.resourceLogs[0] as any).scopeLogs).toEqual([]);
    });

    it('should handle null scopeLogs', () => {
      const body = {
        resourceLogs: [
          {
            resource: {},
            scopeLogs: null,
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect(result.resourceLogs).toHaveLength(1);
      expect((result.resourceLogs[0] as any).scopeLogs).toEqual([]);
    });

    it('should handle empty logRecords', () => {
      const body = {
        resourceLogs: [
          {
            resource: {},
            scopeLogs: [{ logRecords: [] }],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect((result.resourceLogs[0] as any).scopeLogs[0].logRecords).toEqual([]);
    });

    it('should handle null logRecords', () => {
      const body = {
        resourceLogs: [
          {
            resource: {},
            scopeLogs: [{ logRecords: null }],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect((result.resourceLogs[0] as any).scopeLogs[0].logRecords).toEqual([]);
    });

    it('should normalize all log record fields', () => {
      const body = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    time_unix_nano: '1000',
                    observed_time_unix_nano: '2000',
                    severity_number: 17,
                    severity_text: 'ERROR',
                    body: { stringValue: 'error message' },
                    attributes: [{ key: 'foo', value: { stringValue: 'bar' } }],
                    dropped_attributes_count: 5,
                    flags: 1,
                    trace_id: 'trace123',
                    span_id: 'span456',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpJson(body);
      const logRecord = (result.resourceLogs[0] as any).scopeLogs[0].logRecords[0];

      expect(logRecord.timeUnixNano).toBe('1000');
      expect(logRecord.observedTimeUnixNano).toBe('2000');
      expect(logRecord.severityNumber).toBe(17);
      expect(logRecord.severityText).toBe('ERROR');
      expect(logRecord.body).toEqual({ stringValue: 'error message' });
      expect(logRecord.traceId).toBe('trace123');
      expect(logRecord.spanId).toBe('span456');
      expect(logRecord.droppedAttributesCount).toBe(5);
      expect(logRecord.flags).toBe(1);
    });

    it('should handle invalid resource logs item', () => {
      const body = {
        resourceLogs: [null, undefined, 'invalid'],
      };

      const result = parseOtlpJson(body);

      // Should return empty objects for invalid items
      expect(result.resourceLogs).toHaveLength(3);
    });

    it('should handle invalid scope logs item', () => {
      const body = {
        resourceLogs: [
          {
            scopeLogs: [null, 'invalid'],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect((result.resourceLogs[0] as any).scopeLogs).toHaveLength(2);
    });

    it('should handle invalid log records item', () => {
      const body = {
        resourceLogs: [
          {
            scopeLogs: [{ logRecords: [null, 'invalid'] }],
          },
        ],
      };

      const result = parseOtlpJson(body);

      expect((result.resourceLogs[0] as any).scopeLogs[0].logRecords).toHaveLength(2);
    });
  });

  // ==========================================================================
  // parseOtlpProtobuf
  // ==========================================================================
  describe('parseOtlpProtobuf', () => {
    it('should parse JSON disguised as protobuf', async () => {
      const jsonData = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [{ severityNumber: 9 }],
              },
            ],
          },
        ],
      };
      const buffer = Buffer.from(JSON.stringify(jsonData));

      const result = await parseOtlpProtobuf(buffer);

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should throw error for actual protobuf data', async () => {
      // Binary data that isn't JSON
      const buffer = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);

      await expect(parseOtlpProtobuf(buffer)).rejects.toThrow(
        'Protobuf parsing requires proto definitions'
      );
    });

    it('should handle array JSON format', async () => {
      const jsonData = [{ test: 'data' }];
      const buffer = Buffer.from(JSON.stringify(jsonData));

      // This will parse but return empty resourceLogs
      const result = await parseOtlpProtobuf(buffer);
      expect(result.resourceLogs).toEqual([]);
    });
  });

  // ==========================================================================
  // detectContentType
  // ==========================================================================
  describe('detectContentType', () => {
    it('should return unknown for undefined content type', () => {
      expect(detectContentType(undefined)).toBe('unknown');
    });

    it('should return unknown for empty content type', () => {
      expect(detectContentType('')).toBe('unknown');
    });

    it('should detect application/json', () => {
      expect(detectContentType('application/json')).toBe('json');
    });

    it('should detect application/json with charset', () => {
      expect(detectContentType('application/json; charset=utf-8')).toBe('json');
    });

    it('should detect application/json case insensitively', () => {
      expect(detectContentType('Application/JSON')).toBe('json');
    });

    it('should detect application/x-protobuf', () => {
      expect(detectContentType('application/x-protobuf')).toBe('protobuf');
    });

    it('should detect application/protobuf', () => {
      expect(detectContentType('application/protobuf')).toBe('protobuf');
    });

    it('should detect protobuf case insensitively', () => {
      expect(detectContentType('Application/X-PROTOBUF')).toBe('protobuf');
    });

    it('should return unknown for other content types', () => {
      expect(detectContentType('text/plain')).toBe('unknown');
      expect(detectContentType('text/html')).toBe('unknown');
      expect(detectContentType('application/xml')).toBe('unknown');
    });
  });

  // ==========================================================================
  // parseOtlpRequest
  // ==========================================================================
  describe('parseOtlpRequest', () => {
    it('should parse JSON content type', async () => {
      const body = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [] }] }],
      };

      const result = await parseOtlpRequest(body, 'application/json');

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should parse protobuf content type with JSON body', async () => {
      const body = Buffer.from(
        JSON.stringify({
          resourceLogs: [{ scopeLogs: [{ logRecords: [] }] }],
        })
      );

      const result = await parseOtlpRequest(body, 'application/x-protobuf');

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should throw error for protobuf content type with non-buffer body', async () => {
      const body = { resourceLogs: [] };

      await expect(
        parseOtlpRequest(body, 'application/x-protobuf')
      ).rejects.toThrow('Protobuf content-type requires Buffer body');
    });

    it('should fallback to JSON for unknown content type', async () => {
      const body = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [] }] }],
      };

      const result = await parseOtlpRequest(body, 'text/plain');

      expect(result.resourceLogs).toHaveLength(1);
    });

    it('should fallback to JSON when content type is undefined', async () => {
      const body = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [] }] }],
      };

      const result = await parseOtlpRequest(body, undefined);

      expect(result.resourceLogs).toHaveLength(1);
    });
  });
});
