/**
 * OTLP Metric Routes
 *
 * OpenTelemetry Protocol HTTP endpoints for metric ingestion.
 *
 * Endpoint: POST /v1/otlp/metrics
 * Content-Types: application/json, application/x-protobuf
 * Content-Encoding: gzip (supported)
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOtlpMetricsJson, parseOtlpMetricsProtobuf, transformOtlpToMetrics } from './metric-transformer.js';
import { detectContentType, isGzipCompressed, decompressGzip } from './parser.js';
import { metricsService } from '../metrics/service.js';
import { config } from '../../config/index.js';
import { db } from '../../database/index.js';
import { context } from '@logtide/shared/context';
import { assertWithinUsageQuota } from '../../capabilities/index.js';
import { upgradeHintFor } from '../organizations/upgrade-handoff.js';

const collectStreamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

const otlpMetricRoutes: FastifyPluginAsync = async (fastify) => {
  // Remove default JSON parser to add our own with gzip support
  fastify.removeContentTypeParser('application/json');

  // Custom JSON parser with gzip decompression support
  fastify.addContentTypeParser(
    'application/json',
    async (request: FastifyRequest) => {
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      let buffer = await collectStreamToBuffer(request.raw);

      const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(buffer);
      if (needsDecompression) {
        try {
          buffer = await decompressGzip(buffer);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const decompressError = new Error(`Failed to decompress gzip JSON data: ${errMsg}`) as Error & { statusCode: number };
          decompressError.statusCode = 400;
          throw decompressError;
        }
      }

      try {
        return JSON.parse(buffer.toString('utf-8'));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Invalid JSON';
        const parseError = new Error(`Invalid JSON: ${errMsg}`) as Error & { statusCode: number };
        parseError.statusCode = 400;
        throw parseError;
      }
    }
  );

  fastify.addContentTypeParser(
    'application/x-protobuf',
    async (request: FastifyRequest) => collectStreamToBuffer(request.raw),
  );

  fastify.addContentTypeParser(
    'application/protobuf',
    async (request: FastifyRequest) => collectStreamToBuffer(request.raw),
  );

  /**
   * POST /v1/otlp/metrics
   *
   * Ingest metrics via OpenTelemetry Protocol.
   * Accepts both JSON and Protobuf content types.
   */
  fastify.post('/v1/otlp/metrics', {
    bodyLimit: 50 * 1024 * 1024,
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_MAX,
        timeWindow: config.RATE_LIMIT_WINDOW,
      },
    },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            partialSuccess: {
              type: 'object',
              properties: {
                rejectedDataPoints: { type: 'number' },
                errorMessage: { type: 'string' },
              },
            },
          },
        },
        429: {
          type: 'object',
          properties: {
            partialSuccess: {
              type: 'object',
              properties: {
                rejectedDataPoints: { type: 'number' },
                errorMessage: { type: 'string' },
              },
            },
            // Hosting seam: present only while the upgrade handoff is active.
            upgrade_available: { type: 'boolean' },
          },
        },
        400: {
          type: 'object',
          properties: {
            partialSuccess: {
              type: 'object',
              properties: {
                rejectedDataPoints: { type: 'number' },
                errorMessage: { type: 'string' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: any, reply) => {
      const projectId = request.projectId;

      if (!projectId) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedDataPoints: -1,
            errorMessage: 'Unauthorized: Missing or invalid API key',
          },
        });
      }

      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedDataPoints: -1,
            errorMessage: 'Unauthorized: Project not found',
          },
        });
      }

      const contentType = request.headers['content-type'] as string | undefined;
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      const detectedType = detectContentType(contentType);

      try {
        let otlpRequest;
        if (detectedType === 'protobuf') {
          let body = request.body;
          if (Buffer.isBuffer(body)) {
            const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(body);
            if (needsDecompression) {
              try {
                body = await decompressGzip(body);
              } catch (decompressError) {
                const errMsg = decompressError instanceof Error ? decompressError.message : 'Unknown error';
                throw new Error(`Failed to decompress gzip data: ${errMsg}`);
              }
            }
            otlpRequest = await parseOtlpMetricsProtobuf(body);
          } else {
            throw new Error('Protobuf content-type requires Buffer body');
          }
        } else {
          otlpRequest = parseOtlpMetricsJson(request.body);
        }

        const records = transformOtlpToMetrics(otlpRequest);

        if (records.length === 0) {
          return {
            partialSuccess: {
              rejectedDataPoints: 0,
              errorMessage: '',
            },
          };
        }

        // Capability: hard-block metrics ingestion when over the datapoint quota
        // (metrics only; logs and spans have their own quotas) or over the
        // combined telemetry byte quota (shared by logs, traces and metrics).
        await context.runAsSystem('otlp:metric-ingest', async () => {
          await context.with({ organizationId: project.organization_id }, async () => {
            await assertWithinUsageQuota('metrics.max_datapoints_monthly');
            await assertWithinUsageQuota('telemetry.max_bytes_monthly');
            await metricsService.ingestMetrics(records, projectId, project.organization_id);
          });
        });

        return {
          partialSuccess: {
            rejectedDataPoints: 0,
            errorMessage: '',
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Over-quota metric batches return 429 (retry later / upgrade), not 400.
        if (error && (error as any).statusCode === 429) {
          return reply.code(429).send({
            partialSuccess: {
              rejectedDataPoints: -1,
              errorMessage,
            },
            ...upgradeHintFor(error),
          });
        }

        console.error('[OTLP Metrics] Ingestion error:', errorMessage);

        return reply.code(400).send({
          partialSuccess: {
            rejectedDataPoints: -1,
            errorMessage,
          },
        });
      }
    },
  });

  /**
   * Health check endpoint for OTLP metrics
   */
  fastify.get('/v1/otlp/metrics', async () => {
    return { status: 'ok' };
  });
};

export default otlpMetricRoutes;
