/**
 * OTLP Trace Routes
 *
 * OpenTelemetry Protocol HTTP endpoints for trace ingestion.
 *
 * Endpoint: POST /v1/otlp/traces
 * Content-Types: application/json, application/x-protobuf
 */

import type { FastifyPluginAsync } from 'fastify';
import { parseOtlpTracesJson, transformOtlpToSpans } from './trace-transformer.js';
import { detectContentType } from './parser.js';
import { tracesService } from '../traces/service.js';
import { config } from '../../config/index.js';
import { db } from '../../database/index.js';

const otlpTraceRoutes: FastifyPluginAsync = async (fastify) => {
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
      const detectedType = detectContentType(contentType);

      if (detectedType === 'unknown' && contentType) {
        console.warn('[OTLP Traces] Unknown content type, attempting JSON parse:', contentType);
      }

      try {
        // Parse OTLP request (currently JSON only, protobuf throws helpful error)
        let otlpRequest;
        if (detectedType === 'protobuf') {
          throw new Error(
            'Protobuf parsing requires proto definitions. ' +
            'Please use application/json content-type or configure protobuf support.'
          );
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
