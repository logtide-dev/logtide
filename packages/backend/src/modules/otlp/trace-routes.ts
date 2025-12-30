/**
 * OTLP Trace Routes
 *
 * OpenTelemetry Protocol HTTP endpoints for trace ingestion.
 *
 * Endpoint: POST /v1/otlp/traces
 * Content-Types: application/json, application/x-protobuf
 * Content-Encoding: gzip (supported)
 *
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOtlpTracesJson, parseOtlpTracesProtobuf, transformOtlpToSpans } from './trace-transformer.js';
import { detectContentType, isGzipCompressed, decompressGzip } from './parser.js';
import { tracesService } from '../traces/service.js';
import { config } from '../../config/index.js';
import { db } from '../../database/index.js';

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

const otlpTraceRoutes: FastifyPluginAsync = async (fastify) => {
  // Remove default JSON parser to add our own with gzip support
  fastify.removeContentTypeParser('application/json');

  // Custom JSON parser with gzip decompression support
  fastify.addContentTypeParser(
    'application/json',
    async (request: FastifyRequest) => {
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      let buffer = await collectStreamToBuffer(request.raw);

      // Handle gzip decompression - check header OR magic bytes
      const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(buffer);
      if (needsDecompression) {
        const detectedBy = isGzipCompressed(buffer) ? 'magic bytes' : 'Content-Encoding header';
        console.log(`[OTLP Traces] Decompressing gzip JSON (detected by ${detectedBy})`);
        try {
          buffer = await decompressGzip(buffer);
          console.log(`[OTLP Traces] Decompressed JSON to ${buffer.length} bytes`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[OTLP Traces] Gzip JSON decompression failed:', errMsg);
          throw new Error(`Failed to decompress gzip JSON data: ${errMsg}`);
        }
      }

      // Parse JSON
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

  // Register content type parser for protobuf
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
   * POST /v1/otlp/traces
   *
   * Ingest traces via OpenTelemetry Protocol.
   * Accepts both JSON and Protobuf content types.
   */
  fastify.post('/v1/otlp/traces', {
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
                rejectedSpans: { type: 'number' },
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
                rejectedSpans: { type: 'number' },
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

      // Auth check
      if (!projectId) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedSpans: -1,
            errorMessage: 'Unauthorized: Missing or invalid API key',
          },
        });
      }

      // Get organization_id for the project
      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        return reply.code(401).send({
          partialSuccess: {
            rejectedSpans: -1,
            errorMessage: 'Unauthorized: Project not found',
          },
        });
      }

      const contentType = request.headers['content-type'] as string | undefined;
      const contentEncoding = request.headers['content-encoding'] as string | undefined;
      const detectedType = detectContentType(contentType);

      if (detectedType === 'unknown' && contentType) {
        console.warn('[OTLP Traces] Unknown content type, attempting JSON parse:', contentType);
      }

      try {
        // Parse OTLP request based on content type
        let otlpRequest;
        if (detectedType === 'protobuf') {
          // Handle gzip decompression if needed (for protobuf - JSON is handled by content parser)
          let body = request.body;
          if (Buffer.isBuffer(body)) {
            const needsDecompression = contentEncoding?.toLowerCase() === 'gzip' || isGzipCompressed(body);
            if (needsDecompression) {
              const detectedBy = isGzipCompressed(body) ? 'magic bytes' : 'Content-Encoding header';
              console.log(`[OTLP Traces] Decompressing gzip protobuf (detected by ${detectedBy})`);
              try {
                body = await decompressGzip(body);
                console.log(`[OTLP Traces] Decompressed protobuf to ${body.length} bytes`);
              } catch (decompressError) {
                const errMsg = decompressError instanceof Error ? decompressError.message : 'Unknown error';
                console.error('[OTLP Traces] Gzip decompression failed:', errMsg);
                throw new Error(`Failed to decompress gzip data: ${errMsg}`);
              }
            }
            otlpRequest = await parseOtlpTracesProtobuf(body);
          } else {
            throw new Error('Protobuf content-type requires Buffer body');
          }
        } else {
          otlpRequest = parseOtlpTracesJson(request.body);
        }

        // Transform to LogWard format
        const { spans, traces } = transformOtlpToSpans(otlpRequest);

        if (spans.length === 0) {
          // Empty request is valid per OTLP spec
          return {
            partialSuccess: {
              rejectedSpans: 0,
              errorMessage: '',
            },
          };
        }

        // Ingest spans and trace aggregations
        await tracesService.ingestSpans(spans, traces, projectId, project.organization_id);

        console.log(`[OTLP Traces] Ingested ${spans.length} spans for project ${projectId}`);

        return {
          partialSuccess: {
            rejectedSpans: 0,
            errorMessage: '',
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        console.error('[OTLP Traces] Ingestion error:', errorMessage);

        return reply.code(400).send({
          partialSuccess: {
            rejectedSpans: -1,
            errorMessage,
          },
        });
      }
    },
  });

  /**
   * Health check endpoint for OTLP traces
   */
  fastify.get('/v1/otlp/traces', async () => {
    return { status: 'ok' };
  });
};

export default otlpTraceRoutes;
