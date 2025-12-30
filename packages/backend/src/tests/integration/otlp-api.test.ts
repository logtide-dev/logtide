import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { gzipSync } from 'zlib';
import { build } from '../../server.js';
import { createTestApiKey, createTestContext } from '../helpers/index.js';
import { db } from '../../database/index.js';

describe('OTLP API', () => {
  let app: any;
  let apiKey: string;
  let projectId: string;

  beforeEach(async () => {
    if (!app) {
      app = await build();
      await app.ready();
    }

    const testKey = await createTestApiKey({ name: 'Test OTLP Key' });
    apiKey = testKey.plainKey;
    projectId = testKey.project_id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ==========================================================================
  // POST /v1/otlp/logs - OTLP Logs Ingestion
  // ==========================================================================
  describe('POST /v1/otlp/logs', () => {
    it('should ingest a basic OTLP log record', async () => {
      const otlpRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'my-otel-service' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 9, // INFO
                    severityText: 'INFO',
                    body: { stringValue: 'OTLP test log message' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body).toHaveProperty('partialSuccess');
      expect(response.body.partialSuccess.rejectedLogRecords).toBe(0);

      // Verify log was stored in DB
      const storedLog = await db
        .selectFrom('logs')
        .selectAll()
        .where('message', '=', 'OTLP test log message')
        .executeTakeFirst();

      expect(storedLog).toBeDefined();
      expect(storedLog?.service).toBe('my-otel-service');
      expect(storedLog?.level).toBe('info');
    });

    it('should handle multiple log records from multiple resources', async () => {
      const otlpRequest = {
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
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 9,
                    body: { stringValue: 'Log from service A' },
                  },
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 17, // ERROR
                    body: { stringValue: 'Error from service A' },
                  },
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
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 13, // WARN
                    body: { stringValue: 'Warning from service B' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedLogRecords).toBe(0);

      // Verify all logs were stored
      const logsA = await db
        .selectFrom('logs')
        .selectAll()
        .where('service', '=', 'service-a')
        .where('project_id', '=', projectId)
        .execute();

      const logsB = await db
        .selectFrom('logs')
        .selectAll()
        .where('service', '=', 'service-b')
        .where('project_id', '=', projectId)
        .execute();

      expect(logsA.length).toBeGreaterThanOrEqual(2);
      expect(logsB.length).toBeGreaterThanOrEqual(1);
    });

    it('should map OTLP severity correctly', async () => {
      const severityTests = [
        { severityNumber: 1, expectedLevel: 'debug' },
        { severityNumber: 5, expectedLevel: 'debug' },
        { severityNumber: 9, expectedLevel: 'info' },
        { severityNumber: 13, expectedLevel: 'warn' },
        { severityNumber: 17, expectedLevel: 'error' },
        { severityNumber: 21, expectedLevel: 'critical' },
      ];

      for (const { severityNumber, expectedLevel } of severityTests) {
        const uniqueMsg = `Severity test ${severityNumber}-${Date.now()}`;
        const otlpRequest = {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'severity-test' } },
                ],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: String(Date.now() * 1000000),
                      severityNumber,
                      body: { stringValue: uniqueMsg },
                    },
                  ],
                },
              ],
            },
          ],
        };

        await request(app.server)
          .post('/v1/otlp/logs')
          .set('x-api-key', apiKey)
          .set('Content-Type', 'application/json')
          .send(otlpRequest)
          .expect(200);

        const storedLog = await db
          .selectFrom('logs')
          .selectAll()
          .where('message', '=', uniqueMsg)
          .executeTakeFirst();

        expect(storedLog?.level).toBe(expectedLevel);
      }
    });

    it('should handle trace_id and span_id', async () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const spanId = 'b7ad6b7169203331';
      const uniqueMsg = `Trace context test ${Date.now()}`;

      const otlpRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'trace-test' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 9,
                    body: { stringValue: uniqueMsg },
                    traceId,
                    spanId,
                  },
                ],
              },
            ],
          },
        ],
      };

      await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      const storedLog = await db
        .selectFrom('logs')
        .selectAll()
        .where('message', '=', uniqueMsg)
        .executeTakeFirst();

      expect(storedLog?.trace_id).toBe(traceId);
      expect(storedLog?.span_id).toBe(spanId);
    });

    it('should store resource attributes in metadata', async () => {
      const uniqueMsg = `Resource attrs test ${Date.now()}`;

      const otlpRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'attrs-test' } },
                { key: 'service.version', value: { stringValue: '1.2.3' } },
                { key: 'host.name', value: { stringValue: 'test-host' } },
                { key: 'deployment.environment', value: { stringValue: 'test' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 9,
                    body: { stringValue: uniqueMsg },
                    attributes: [
                      { key: 'user.id', value: { stringValue: '12345' } },
                      { key: 'request.path', value: { stringValue: '/api/test' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      const storedLog = await db
        .selectFrom('logs')
        .selectAll()
        .where('message', '=', uniqueMsg)
        .executeTakeFirst();

      expect(storedLog?.metadata).toBeDefined();
      const metadata = storedLog?.metadata as Record<string, unknown>;
      expect(metadata['service.version']).toBe('1.2.3');
      expect(metadata['host.name']).toBe('test-host');
      expect(metadata['user.id']).toBe('12345');
    });

    it('should handle empty request (valid per OTLP spec)', async () => {
      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send({ resourceLogs: [] })
        .expect(200);

      expect(response.body.partialSuccess.rejectedLogRecords).toBe(0);
    });

    it('should reject request without API key', async () => {
      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('Content-Type', 'application/json')
        .send({ resourceLogs: [] })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should reject invalid API key', async () => {
      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', 'invalid_key_12345')
        .set('Content-Type', 'application/json')
        .send({ resourceLogs: [] })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should handle malformed JSON', async () => {
      await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(400);
    });

    it('should handle snake_case field names (Python SDK format)', async () => {
      const uniqueMsg = `Snake case test ${Date.now()}`;

      const otlpRequest = {
        resource_logs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'python-service' } },
              ],
            },
            scope_logs: [
              {
                log_records: [
                  {
                    time_unix_nano: String(Date.now() * 1000000),
                    severity_number: 9,
                    body: { stringValue: uniqueMsg },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedLogRecords).toBe(0);
    });

    it('should handle structured body (kvlist)', async () => {
      const uniqueMsg = `Structured body ${Date.now()}`;

      const otlpRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'structured-test' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    severityNumber: 9,
                    body: {
                      kvlistValue: {
                        values: [
                          { key: 'message', value: { stringValue: uniqueMsg } },
                          { key: 'count', value: { intValue: 42 } },
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

      const response = await request(app.server)
        .post('/v1/otlp/logs')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedLogRecords).toBe(0);

      // The message should be JSON stringified
      const storedLog = await db
        .selectFrom('logs')
        .selectAll()
        .where('service', '=', 'structured-test')
        .where('project_id', '=', projectId)
        .orderBy('time', 'desc')
        .executeTakeFirst();

      expect(storedLog?.message).toContain(uniqueMsg);
    });

    describe('GET /v1/otlp/logs (health check)', () => {
      it('should return ok status with valid API key', async () => {
        const response = await request(app.server)
          .get('/v1/otlp/logs')
          .set('x-api-key', apiKey)
          .expect(200);

        expect(response.body).toEqual({ status: 'ok' });
      });
    });

    describe('Gzip compression', () => {
      it('should handle gzip-compressed JSON requests', async () => {
        const uniqueMsg = `Gzip JSON test ${Date.now()}`;
        const otlpRequest = {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'gzip-json-test' } },
                ],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: String(Date.now() * 1000000),
                      severityNumber: 9,
                      body: { stringValue: uniqueMsg },
                    },
                  ],
                },
              ],
            },
          ],
        };

        const jsonData = JSON.stringify(otlpRequest);
        const gzippedData = gzipSync(Buffer.from(jsonData));

        // Use Fastify's inject() for proper binary body handling
        const response = await app.inject({
          method: 'POST',
          url: '/v1/otlp/logs',
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
            'x-api-key': apiKey,
          },
          payload: gzippedData,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.partialSuccess.rejectedLogRecords).toBe(0);

        // Verify log was stored
        const storedLog = await db
          .selectFrom('logs')
          .selectAll()
          .where('message', '=', uniqueMsg)
          .executeTakeFirst();

        expect(storedLog).toBeDefined();
        expect(storedLog?.service).toBe('gzip-json-test');
      });

      it('should handle gzip-compressed protobuf requests', async () => {
        // For protobuf, we'll test with JSON payload sent as protobuf content-type
        // (which the parser handles by detecting JSON format)
        const uniqueMsg = `Gzip protobuf test ${Date.now()}`;
        const otlpRequest = {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'gzip-protobuf-test' } },
                ],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: String(Date.now() * 1000000),
                      severityNumber: 13,
                      body: { stringValue: uniqueMsg },
                    },
                  ],
                },
              ],
            },
          ],
        };

        const jsonData = JSON.stringify(otlpRequest);
        const gzippedData = gzipSync(Buffer.from(jsonData));

        // Use Fastify's inject() for proper binary body handling
        const response = await app.inject({
          method: 'POST',
          url: '/v1/otlp/logs',
          headers: {
            'content-type': 'application/x-protobuf',
            'content-encoding': 'gzip',
            'x-api-key': apiKey,
          },
          payload: gzippedData,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.partialSuccess.rejectedLogRecords).toBe(0);

        const storedLog = await db
          .selectFrom('logs')
          .selectAll()
          .where('message', '=', uniqueMsg)
          .executeTakeFirst();

        expect(storedLog).toBeDefined();
        expect(storedLog?.level).toBe('warn');
      });

      it('should auto-detect gzip by magic bytes (without Content-Encoding header)', async () => {
        // This tests the fix for OpenTelemetry Collector which sends gzip data
        // without setting the Content-Encoding header
        const uniqueMsg = `Gzip magic bytes test ${Date.now()}`;
        const otlpRequest = {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'gzip-magic-test' } },
                ],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: String(Date.now() * 1000000),
                      severityNumber: 9,
                      body: { stringValue: uniqueMsg },
                    },
                  ],
                },
              ],
            },
          ],
        };

        const jsonData = JSON.stringify(otlpRequest);
        const gzippedData = gzipSync(Buffer.from(jsonData));

        // Send gzip data WITHOUT Content-Encoding header
        // The server should detect gzip by magic bytes (0x1f 0x8b)
        const response = await app.inject({
          method: 'POST',
          url: '/v1/otlp/logs',
          headers: {
            'content-type': 'application/x-protobuf',
            // NOTE: No 'content-encoding' header!
            'x-api-key': apiKey,
          },
          payload: gzippedData,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.partialSuccess.rejectedLogRecords).toBe(0);

        const storedLog = await db
          .selectFrom('logs')
          .selectAll()
          .where('message', '=', uniqueMsg)
          .executeTakeFirst();

        expect(storedLog).toBeDefined();
        expect(storedLog?.service).toBe('gzip-magic-test');
      });

      it('should auto-detect gzip JSON by magic bytes (without Content-Encoding header)', async () => {
        const uniqueMsg = `Gzip JSON magic bytes test ${Date.now()}`;
        const otlpRequest = {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'gzip-json-magic-test' } },
                ],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: String(Date.now() * 1000000),
                      severityNumber: 17,
                      body: { stringValue: uniqueMsg },
                    },
                  ],
                },
              ],
            },
          ],
        };

        const jsonData = JSON.stringify(otlpRequest);
        const gzippedData = gzipSync(Buffer.from(jsonData));

        // Send gzip JSON data WITHOUT Content-Encoding header
        const response = await app.inject({
          method: 'POST',
          url: '/v1/otlp/logs',
          headers: {
            'content-type': 'application/json',
            // NOTE: No 'content-encoding' header!
            'x-api-key': apiKey,
          },
          payload: gzippedData,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.partialSuccess.rejectedLogRecords).toBe(0);

        const storedLog = await db
          .selectFrom('logs')
          .selectAll()
          .where('message', '=', uniqueMsg)
          .executeTakeFirst();

        expect(storedLog).toBeDefined();
        expect(storedLog?.service).toBe('gzip-json-magic-test');
        expect(storedLog?.level).toBe('error');
      });
    });
  });

  // ==========================================================================
  // POST /v1/otlp/traces - OTLP Traces Ingestion
  // ==========================================================================
  describe('POST /v1/otlp/traces', () => {
    it('should ingest a basic OTLP span', async () => {
      const traceId = 'a'.repeat(32);
      const spanId = 'b'.repeat(16);
      const startTime = Date.now() * 1000000;
      const endTime = startTime + 100000000; // 100ms later

      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-trace-service' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'test-operation',
                    kind: 2, // SERVER
                    startTimeUnixNano: String(startTime),
                    endTimeUnixNano: String(endTime),
                    status: { code: 1 }, // OK
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body).toHaveProperty('partialSuccess');
      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      // Verify span was stored
      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('trace_id', '=', traceId)
        .where('span_id', '=', spanId)
        .executeTakeFirst();

      expect(storedSpan).toBeDefined();
      expect(storedSpan?.service_name).toBe('test-trace-service');
      expect(storedSpan?.operation_name).toBe('test-operation');
      expect(storedSpan?.kind).toBe('SERVER');
      expect(storedSpan?.status_code).toBe('OK');

      // Verify trace aggregation was created
      const storedTrace = await db
        .selectFrom('traces')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(storedTrace).toBeDefined();
      expect(storedTrace?.service_name).toBe('test-trace-service');
      expect(storedTrace?.span_count).toBe(1);
    });

    it('should handle parent-child span relationships', async () => {
      const traceId = 'c'.repeat(32);
      const parentSpanId = 'd'.repeat(16);
      const childSpanId = 'e'.repeat(16);
      const startTime = Date.now() * 1000000;

      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'parent-child-test' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId: parentSpanId,
                    name: 'parent-operation',
                    kind: 2, // SERVER
                    startTimeUnixNano: String(startTime),
                    endTimeUnixNano: String(startTime + 200000000),
                  },
                  {
                    traceId,
                    spanId: childSpanId,
                    parentSpanId,
                    name: 'child-operation',
                    kind: 3, // CLIENT
                    startTimeUnixNano: String(startTime + 50000000),
                    endTimeUnixNano: String(startTime + 150000000),
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      // Verify parent span
      const parentSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', parentSpanId)
        .executeTakeFirst();

      expect(parentSpan?.parent_span_id).toBeNull();

      // Verify child span
      const childSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', childSpanId)
        .executeTakeFirst();

      expect(childSpan?.parent_span_id).toBe(parentSpanId);

      // Verify trace aggregation
      const trace = await db
        .selectFrom('traces')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(trace?.span_count).toBe(2);
      expect(trace?.root_operation_name).toBe('parent-operation');
    });

    it('should handle spans with events and links', async () => {
      const timestamp = Date.now().toString(16).padStart(12, '0');
      const traceId = `evnt${timestamp}f5f6f7f8f1f2f3f4f5f6`; // 32 hex chars - unique per run
      const spanId = `e1a2${timestamp.slice(0, 12)}`; // 16 hex chars
      const linkedTraceId = `link${timestamp}b5b6b7b8b1b2b3b4b5b6`; // 32 hex chars
      const linkedSpanId = `l1c2${timestamp.slice(0, 12)}`; // 16 hex chars
      const startTime = Date.now() * 1000000;

      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'events-links-test' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'operation-with-events',
                    kind: 1, // INTERNAL
                    startTimeUnixNano: String(startTime),
                    endTimeUnixNano: String(startTime + 100000000),
                    events: [
                      {
                        timeUnixNano: String(startTime + 10000000),
                        name: 'cache.hit',
                        attributes: [
                          { key: 'cache.key', value: { stringValue: 'user:123' } },
                        ],
                      },
                    ],
                    links: [
                      {
                        traceId: linkedTraceId,
                        spanId: linkedSpanId,
                        attributes: [
                          { key: 'link.type', value: { stringValue: 'follows_from' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', spanId)
        .executeTakeFirst();

      expect(storedSpan?.events).toBeDefined();
      const events = storedSpan?.events as any[];
      expect(events.length).toBe(1);
      expect(events[0].name).toBe('cache.hit');

      expect(storedSpan?.links).toBeDefined();
      const links = storedSpan?.links as any[];
      expect(links.length).toBe(1);
      expect(links[0].trace_id).toBe(linkedTraceId);
    });

    it('should handle error spans', async () => {
      const traceId = 'b1b2b3b4b5b6b7b8b1b2b3b4b5b6b7b8'; // 32 hex chars
      const spanId = 'b2b3b4b5b6b7b8b9'; // 16 hex chars
      const startTime = Date.now() * 1000000;

      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'error-test' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'failing-operation',
                    kind: 2,
                    startTimeUnixNano: String(startTime),
                    endTimeUnixNano: String(startTime + 50000000),
                    status: {
                      code: 2, // ERROR
                      message: 'Database connection failed',
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', spanId)
        .executeTakeFirst();

      expect(storedSpan?.status_code).toBe('ERROR');
      expect(storedSpan?.status_message).toBe('Database connection failed');

      // Verify trace is marked as error
      const trace = await db
        .selectFrom('traces')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(trace?.error).toBe(true);
    });

    it('should handle empty request (valid per OTLP spec)', async () => {
      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send({ resourceSpans: [] })
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);
    });

    it('should reject request without API key', async () => {
      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('Content-Type', 'application/json')
        .send({ resourceSpans: [] })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should skip spans with invalid trace_id (all zeros)', async () => {
      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'skip-test' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: '0'.repeat(32), // All zeros - should be skipped
                    spanId: 'c1'.repeat(8),
                    name: 'should-be-skipped',
                    startTimeUnixNano: String(Date.now() * 1000000),
                    endTimeUnixNano: String(Date.now() * 1000000 + 100000000),
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      // The span should be silently skipped, not rejected as error
      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      // Verify no span was stored
      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('operation_name', '=', 'should-be-skipped')
        .executeTakeFirst();

      expect(storedSpan).toBeUndefined();
    });

    it('should handle snake_case field names (Python SDK format)', async () => {
      const traceId = 'd1d2d3d4d5d6d7d8d1d2d3d4d5d6d7d8'; // 32 hex chars
      const spanId = 'd2d3d4d5d6d7d8d9'; // 16 hex chars
      const startTime = Date.now() * 1000000;

      const otlpRequest = {
        resource_spans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'python-traces' } },
              ],
            },
            scope_spans: [
              {
                spans: [
                  {
                    trace_id: traceId,
                    span_id: spanId,
                    parent_span_id: null,
                    name: 'python-operation',
                    kind: 2,
                    start_time_unix_nano: String(startTime),
                    end_time_unix_nano: String(startTime + 100000000),
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('trace_id', '=', traceId)
        .executeTakeFirst();

      expect(storedSpan).toBeDefined();
      expect(storedSpan?.operation_name).toBe('python-operation');
    });

    it('should store span attributes', async () => {
      const traceId = 'e1e2e3e4e5e6e7e8e1e2e3e4e5e6e7e8'; // 32 hex chars
      const spanId = 'e2e3e4e5e6e7e8e9'; // 16 hex chars
      const startTime = Date.now() * 1000000;

      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'attrs-trace-test' } },
                { key: 'deployment.environment', value: { stringValue: 'testing' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'http.request',
                    kind: 3, // CLIENT
                    startTimeUnixNano: String(startTime),
                    endTimeUnixNano: String(startTime + 50000000),
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.url', value: { stringValue: 'https://api.example.com/users' } },
                      { key: 'http.status_code', value: { intValue: 200 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', apiKey)
        .set('Content-Type', 'application/json')
        .send(otlpRequest)
        .expect(200);

      expect(response.body.partialSuccess.rejectedSpans).toBe(0);

      const storedSpan = await db
        .selectFrom('spans')
        .selectAll()
        .where('span_id', '=', spanId)
        .executeTakeFirst();

      expect(storedSpan?.attributes).toBeDefined();
      const attrs = storedSpan?.attributes as Record<string, unknown>;
      expect(attrs['http.method']).toBe('GET');
      expect(attrs['http.status_code']).toBe(200);

      expect(storedSpan?.resource_attributes).toBeDefined();
      const resourceAttrs = storedSpan?.resource_attributes as Record<string, unknown>;
      expect(resourceAttrs['deployment.environment']).toBe('testing');
    });

    describe('GET /v1/otlp/traces (health check)', () => {
      it('should return ok status with valid API key', async () => {
        const response = await request(app.server)
          .get('/v1/otlp/traces')
          .set('x-api-key', apiKey)
          .expect(200);

        expect(response.body).toEqual({ status: 'ok' });
      });
    });
  });

  // ==========================================================================
  // Traces Query API
  // ==========================================================================
  describe('GET /api/v1/traces', () => {
    let ctx: Awaited<ReturnType<typeof createTestContext>>;
    let sessionToken: string;

    beforeEach(async () => {
      ctx = await createTestContext();

      // Create a session for the user
      const session = await db
        .insertInto('sessions')
        .values({
          user_id: ctx.user.id,
          token: `test-session-${Date.now()}`,
          expires_at: new Date(Date.now() + 86400000), // 24h
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      sessionToken = session.token;

      // Ingest some test traces
      const traceId = 'query-test-'.padEnd(32, '0');
      const spanId = 'span1234'.padEnd(16, '0');
      const startTime = Date.now() * 1000000;

      await request(app.server)
        .post('/v1/otlp/traces')
        .set('x-api-key', ctx.apiKey.plainKey)
        .set('Content-Type', 'application/json')
        .send({
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: 'query-test-service' } },
                ],
              },
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId,
                      spanId,
                      name: 'query-test-operation',
                      kind: 2,
                      startTimeUnixNano: String(startTime),
                      endTimeUnixNano: String(startTime + 100000000),
                    },
                  ],
                },
              ],
            },
          ],
        });
    });

    it('should list traces with session auth', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({ projectId: ctx.project.id })
        .expect(200);

      expect(response.body).toHaveProperty('traces');
      expect(Array.isArray(response.body.traces)).toBe(true);
    });

    it('should filter traces by service', async () => {
      const response = await request(app.server)
        .get('/api/v1/traces')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          projectId: ctx.project.id,
          service: 'query-test-service',
        })
        .expect(200);

      expect(response.body.traces.length).toBeGreaterThan(0);
      for (const trace of response.body.traces) {
        expect(trace.service_name).toBe('query-test-service');
      }
    });

    it('should require authentication', async () => {
      await request(app.server)
        .get('/api/v1/traces')
        .query({ projectId: ctx.project.id })
        .expect(401);
    });
  });
});
