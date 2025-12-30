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
        const detectedBy = isGzipCompressed(buffer) ? 'magic bytes' : 'Content-Encoding header';
        console.log(`[OTLP] Decompressing gzip JSON (detected by ${detectedBy})`);
        try {
          buffer = await decompressGzip(buffer);
          console.log(`[OTLP] Decompressed JSON to ${buffer.length} bytes`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[OTLP] Gzip JSON decompression failed:', errMsg);
          throw new Error(`Failed to decompress gzip JSON data: ${errMsg}`);
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
            const detectedBy = isGzipCompressed(body) ? 'magic bytes' : 'Content-Encoding header';
            console.log(`[OTLP] Decompressing gzip protobuf (detected by ${detectedBy})`);
            try {
              body = await decompressGzip(body);
              console.log(`[OTLP] Decompressed protobuf to ${body.length} bytes`);
            } catch (decompressError) {
              const errMsg = decompressError instanceof Error ? decompressError.message : 'Unknown error';
              console.error('[OTLP] Gzip decompression failed:', errMsg);
              throw new Error(`Failed to decompress gzip data: ${errMsg}`);
            }
          }
        }

        // Parse OTLP request
        const otlpRequest = await parseOtlpRequest(body, contentType);

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
