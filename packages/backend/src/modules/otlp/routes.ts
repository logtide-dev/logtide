/**
 * OTLP Routes
 *
 * OpenTelemetry Protocol HTTP endpoints for log ingestion.
 *
 * Endpoint: POST /v1/otlp/logs
 * Content-Types: application/json, application/x-protobuf
 * Content-Encoding: gzip (supported)
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOtlpRequest, detectContentType, decompressGzip, isGzipCompressed } from './parser.js';
import { transformOtlpToLogTide } from './transformer.js';
import { ingestionService } from '../ingestion/service.js';
import { config } from '../../config/index.js';
import { db } from '../../database/index.js';
import { context } from '@logtide/shared/context';
import { upgradeHintFor } from '../organizations/upgrade-handoff.js';

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
  // Remove default JSON parser to add our own with gzip support
  // This only affects routes registered in this plugin
  fastify.removeContentTypeParser('application/json');

  // Custom JSON parser with gzip decompression support
  // Handles both Content-Encoding header and magic byte detection
  fastify.addContentTypeParser(
    'application/json',
    async (request: FastifyRequest) => {
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      let buffer = await collectStreamToBuffer(request.raw);

      // Handle gzip decompression - check header OR magic bytes
      const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(buffer);
      if (needsDecompression) {
        try {
          buffer = await decompressGzip(buffer);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[OTLP] Gzip JSON decompression failed:', errMsg);
          const decompressError = new Error(`Failed to decompress gzip JSON data: ${errMsg}`) as Error & { statusCode: number };
          decompressError.statusCode = 400;
          throw decompressError;
        }
      }

      // Parse JSON
      try {
        return JSON.parse(buffer.toString('utf-8'));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Invalid JSON';
        // Create an error that Fastify will recognize as a 400 error
        const parseError = new Error(`Invalid JSON: ${errMsg}`) as Error & { statusCode: number };
        parseError.statusCode = 400;
        throw parseError;
      }
    }
  );

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
    bodyLimit: 50 * 1024 * 1024, // 50MB for OTLP batches
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
        429: {
          type: 'object',
          properties: {
            partialSuccess: {
              type: 'object',
              properties: {
                rejectedLogRecords: { type: 'number' },
                errorMessage: { type: 'string' },
              },
            },
            // Hosting seam: present only while the upgrade handoff is active.
            upgrade_available: { type: 'boolean' },
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

      // Get organization_id for the project so quota enforcement has org context.
      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedLogRecords: -1,
            errorMessage: 'Unauthorized: Project not found',
          },
        });
      }

      const contentType = request.headers['content-type'] as string | undefined;
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      const detectedType = detectContentType(contentType);

      // Validate content type
      if (detectedType === 'unknown' && contentType) {
        console.warn('[OTLP] Unknown content type, attempting JSON parse:', contentType);
      }

      try {
        // Handle gzip decompression if needed (for protobuf - JSON is handled by content parser)
        // Check both Content-Encoding header AND magic bytes for auto-detection
        let body = request.body;
        if (Buffer.isBuffer(body)) {
          const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(body);
          if (needsDecompression) {
            try {
              body = await decompressGzip(body);
            } catch (decompressError) {
              const errMsg = decompressError instanceof Error ? decompressError.message : 'Unknown error';
              console.error('[OTLP] Gzip decompression failed:', errMsg);
              throw new Error(`Failed to decompress gzip data: ${errMsg}`);
            }
          }
        }

        // Parse OTLP request
        const otlpRequest = await parseOtlpRequest(body, contentType);

        // Transform to LogTide format
        const logs = transformOtlpToLogTide(otlpRequest);

        if (logs.length === 0) {
          // Empty request is valid per OTLP spec
          return {
            partialSuccess: {
              rejectedLogRecords: 0,
              errorMessage: '',
            },
          };
        }

        // Ingest logs using existing service.
        // Wrap in org context so the ingestion service quota guard can read organizationId.
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

        let ingestResult = { received: 0, rejected: [] as Array<{ index: number; reason: string }> };
        await context.runAsSystem('otlp:log-ingest', async () => {
          await context.with({ organizationId: project.organization_id }, async () => {
            ingestResult = await ingestionService.ingestLogs(logInputs, projectId);
          });
        });

        return {
          partialSuccess: {
            rejectedLogRecords: ingestResult.rejected.length,
            errorMessage: ingestResult.rejected.length > 0 ? 'pii_masking_failed' : '',
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : undefined;

        // Client-addressable rejections (quota 429, hook policy 4xx) keep
        // their status so OTLP exporters can react appropriately.
        if (statusCode && statusCode >= 400 && statusCode < 500) {
          // Cast needed: schema only enumerates 400/401/429 but hook
          // rejections can carry arbitrary 4xx codes (e.g. 403).
          return (reply as any).code(statusCode).send({
            partialSuccess: {
              rejectedLogRecords: -1,
              errorMessage,
            },
            ...upgradeHintFor(error),
          });
        }

        console.error('[OTLP] Ingestion error:', errorMessage);

        // Server-side failures (e.g. a broken hook failing closed) are
        // retryable: 503, not 400 (400 makes OTLP exporters drop the batch).
        if (statusCode && statusCode >= 500) {
          return (reply as any).code(503).send({
            partialSuccess: {
              rejectedLogRecords: -1,
              errorMessage: 'temporary ingestion failure',
            },
          });
        }

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
