/**
 * OTLP Routes
 *
 * OpenTelemetry Protocol HTTP endpoints for log ingestion.
 *
 * Endpoint: POST /v1/otlp/logs
 * Content-Types: application/json, application/x-protobuf
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOtlpRequest, detectContentType } from './parser.js';
import { transformOtlpToLogWard } from './transformer.js';
import { ingestionService } from '../ingestion/service.js';
import { config } from '../../config/index.js';

/**
 * Helper to collect chunks from a stream into a buffer.
 * This handles both Content-Length and chunked transfer encoding.
 */
const collectStreamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

const otlpRoutes: FastifyPluginAsync = async (fastify) => {
  // Register content type parser for protobuf
  // Use stream-based parsing to support both Content-Length and chunked encoding
  fastify.addContentTypeParser(
    'application/x-protobuf',
    async (request: FastifyRequest) => {
      return collectStreamToBuffer(request.raw);
    }
  );

  // Also handle application/protobuf (alternative)
  fastify.addContentTypeParser(
    'application/protobuf',
    async (request: FastifyRequest) => {
      return collectStreamToBuffer(request.raw);
    }
  );

  /**
   * POST /v1/otlp/logs
   *
   * Ingest logs via OpenTelemetry Protocol.
   * Accepts both JSON and Protobuf content types.
   */
  fastify.post('/v1/otlp/logs', {
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
                rejectedLogRecords: { type: 'number' },
                errorMessage: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            partialSuccess: {
              type: 'object',
              properties: {
                rejectedLogRecords: { type: 'number' },
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

      // Auth check (handled by auth plugin, but double-check)
      if (!projectId) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedLogRecords: -1,
            errorMessage: 'Unauthorized: Missing or invalid API key',
          },
        });
      }

      const contentType = request.headers['content-type'] as string | undefined;
      const detectedType = detectContentType(contentType);

      // Validate content type
      if (detectedType === 'unknown' && contentType) {
        console.warn('[OTLP] Unknown content type, attempting JSON parse:', contentType);
      }

      try {
        // Parse OTLP request
        const otlpRequest = await parseOtlpRequest(request.body, contentType);

        // Transform to LogWard format
        const logs = transformOtlpToLogWard(otlpRequest);

        if (logs.length === 0) {
          // Empty request is valid per OTLP spec
          return {
            partialSuccess: {
              rejectedLogRecords: 0,
              errorMessage: '',
            },
          };
        }

        // Ingest logs using existing service
        // Convert TransformedLog to LogInput format
        const logInputs = logs.map((log) => ({
          time: log.time,
          service: log.service,
          level: log.level,
          message: log.message,
          metadata: log.metadata,
          trace_id: log.trace_id,
          span_id: log.span_id,
        }));

        await ingestionService.ingestLogs(logInputs, projectId);

        console.log(`[OTLP] Ingested ${logs.length} logs for project ${projectId}`);

        return {
          partialSuccess: {
            rejectedLogRecords: 0,
            errorMessage: '',
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        console.error('[OTLP] Ingestion error:', errorMessage);

        return reply.code(400).send({
          partialSuccess: {
            rejectedLogRecords: -1,
            errorMessage,
          },
        });
      }
    },
  });

  /**
   * Health check endpoint for OTLP
   * Some OTLP clients check this before sending data
   */
  fastify.get('/v1/otlp/logs', async () => {
    return { status: 'ok' };
  });
};

export default otlpRoutes;
