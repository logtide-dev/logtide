import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import { parseOtlpProtobuf } from '../../../modules/otlp/parser.js';

// Same CJS module instance the parser loads, so spies on it are visible there.
const require = createRequire(import.meta.url);
const $root = require('@opentelemetry/otlp-transformer/build/esm/generated/root.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExportLogsServiceRequest: any = $root.opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest;

/**
 * Feed a crafted decoded object through parseOtlpProtobuf by stubbing the
 * protobuf toObject step. An empty buffer decodes to an empty message, so the
 * stub controls the shape the normalizers see.
 */
async function parseDecoded(decoded: Record<string, unknown>) {
  vi.spyOn(ExportLogsServiceRequest, 'toObject').mockReturnValue(decoded);
  return parseOtlpProtobuf(Buffer.alloc(0));
}

async function parseSingleRecord(record: Record<string, unknown>) {
  const result = await parseDecoded({
    resourceLogs: [{ scopeLogs: [{ logRecords: [record] }] }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result.resourceLogs[0] as any).scopeLogs[0].logRecords[0];
}

describe('OTLP Parser - protobuf normalization edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OTLP_DEBUG;
  });

  describe('structure', () => {
    it('should return empty resourceLogs when the decoded message has no array', async () => {
      const result = await parseDecoded({});
      expect(result).toEqual({ resourceLogs: [] });
    });

    it('should replace malformed entries with empty values at every level', async () => {
      const result = await parseDecoded({
        resourceLogs: [
          null,
          { scopeLogs: 'not-an-array', schemaUrl: 'u1' },
          {
            scopeLogs: [
              null,
              { logRecords: 'not-an-array' },
              { logRecords: [null, 7] },
            ],
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rls = result.resourceLogs as any[];
      expect(rls[0]).toEqual({});
      expect(rls[1]).toEqual({ resource: undefined, scopeLogs: [], schemaUrl: 'u1' });
      expect(rls[2].scopeLogs[0]).toEqual({});
      expect(rls[2].scopeLogs[1].logRecords).toEqual([]);
      expect(rls[2].scopeLogs[2].logRecords).toEqual([{}, {}]);
    });

    it('should dump raw records when OTLP_DEBUG is enabled', async () => {
      process.env.OTLP_DEBUG = 'true';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const record = await parseSingleRecord({ severityNumber: 9 });
      expect(record.severityNumber).toBe(9);
      expect(logSpy).toHaveBeenCalledWith(
        '[OTLP Debug] Raw log record from protobuf:',
        expect.stringContaining('"severityNumber": 9')
      );
    });

    it('should report "Unknown error" when decoding throws a non-Error value', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ExportLogsServiceRequest, 'toObject').mockImplementation(() => {
        throw 'boom';
      });
      await expect(parseOtlpProtobuf(Buffer.alloc(0))).rejects.toThrow(
        'Failed to decode OTLP protobuf: Unknown error'
      );
    });
  });

  describe('body normalization', () => {
    it('should drop a non-object body', async () => {
      const record = await parseSingleRecord({ body: 'plain string' });
      expect(record.body).toBeUndefined();
    });

    it.each([
      ['arrayValue', { values: [] }],
      ['kvlistValue', { values: [] }],
      ['bytesValue', 'AQID'],
    ])('should pass through a camelCase %s body unchanged', async (key, value) => {
      const record = await parseSingleRecord({ body: { [key]: value } });
      expect(record.body).toEqual({ [key]: value });
    });

    it.each([
      ['string_value', 'stringValue', 'hello'],
      ['bool_value', 'boolValue', false],
      ['int_value', 'intValue', '42'],
      ['double_value', 'doubleValue', 1.5],
      ['array_value', 'arrayValue', { values: [] }],
      ['kvlist_value', 'kvlistValue', { values: [] }],
      ['bytes_value', 'bytesValue', 'AQID'],
    ])('should convert a snake_case %s body to %s', async (snake, camel, value) => {
      const record = await parseSingleRecord({ body: { [snake]: value } });
      expect(record.body).toEqual({ [camel]: value });
    });

    it('should unwrap a body nested under a value wrapper', async () => {
      const record = await parseSingleRecord({ body: { value: { string_value: 'wrapped' } } });
      expect(record.body).toEqual({ stringValue: 'wrapped' });
    });

    it('should return an unrecognized body object as-is', async () => {
      const record = await parseSingleRecord({ body: { somethingElse: 1 } });
      expect(record.body).toEqual({ somethingElse: 1 });
    });
  });

  describe('attribute normalization', () => {
    it('should keep non-object attributes and normalize object attribute values', async () => {
      const record = await parseSingleRecord({
        attributes: [null, 'raw', { key: 'k', value: { int_value: '5' } }],
      });
      expect(record.attributes).toEqual([null, 'raw', { key: 'k', value: { intValue: '5' } }]);
    });

    it('should leave attributes undefined when they are not an array', async () => {
      const record = await parseSingleRecord({ attributes: { key: 'k' } });
      expect(record.attributes).toBeUndefined();
    });
  });

  describe('trace/span id normalization', () => {
    it('should lowercase canonical-length hex ids', async () => {
      const record = await parseSingleRecord({
        traceId: 'ABCDEF0123456789ABCDEF0123456789',
        spanId: 'ABCDEF0123456789',
      });
      expect(record.traceId).toBe('abcdef0123456789abcdef0123456789');
      expect(record.spanId).toBe('abcdef0123456789');
    });

    it('should drop hex ids with a non-canonical length', async () => {
      const record = await parseSingleRecord({ traceId: 'abcd', spanId: '0123456789abcdef01' });
      expect(record.traceId).toBeUndefined();
      expect(record.spanId).toBeUndefined();
    });

    it('should convert base64 ids to hex', async () => {
      const spanBytes = Buffer.from('0102030405060708', 'hex');
      const record = await parseSingleRecord({ spanId: spanBytes.toString('base64') });
      expect(record.spanId).toBe('0102030405060708');
    });

    it('should convert Uint8Array and Buffer ids to hex', async () => {
      const record = await parseSingleRecord({
        traceId: new Uint8Array(Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex')),
        spanId: Buffer.from('a1b2c3d4e5f60718', 'hex'),
      });
      expect(record.traceId).toBe('0102030405060708090a0b0c0d0e0f10');
      expect(record.spanId).toBe('a1b2c3d4e5f60718');
    });

    it('should drop ids of unsupported types', async () => {
      const record = await parseSingleRecord({ traceId: 12345, spanId: { bytes: [1] } });
      expect(record.traceId).toBeUndefined();
      expect(record.spanId).toBeUndefined();
    });
  });
});
