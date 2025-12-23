import type { FastifyPluginAsync } from 'fastify';
import { ingestRequestSchema, logSchema } from '@logward/shared';
import { ingestionService } from './service.js';
import { config } from '../../config/index.js';

const ingestionRoutes: FastifyPluginAsync = async (fastify) => {
  // Add parser for Fluent Bit's NDJSON format
  fastify.addContentTypeParser('application/x-ndjson', { parseAs: 'string' }, (_req, body, done) => {
    try {
      // NDJSON sends newline-separated JSON objects
      // Parse the first line (single log per request with json_lines)
      const firstLine = body.toString().trim().split('\n')[0];
      const json = JSON.parse(firstLine);
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  // POST /api/v1/ingest/single - Ingest single log (for Fluent Bit)
  fastify.post('/api/v1/ingest/single', {
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_MAX, // configurable via RATE_LIMIT_MAX env var
        timeWindow: config.RATE_LIMIT_WINDOW
      }
    },
    schema: {
      description: 'Ingest a single log entry (optimized for Fluent Bit)',
      tags: ['ingestion'],
      body: {
        type: 'object',
        properties: {
          time: { type: 'string' },
          date: { type: 'number' },
          service: { type: 'string' },
          container_name: { type: 'string' },
          level: { type: 'string' },
          message: { type: 'string' },
          log: { type: 'string' },
          metadata: { type: 'object' },
          trace_id: { type: 'string' },
        },
        additionalProperties: true,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            received: { type: 'number' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: any, reply) => {
      // Get projectId from authenticated request (set by auth plugin)
      const projectId = request.projectId;

      if (!projectId) {
        return reply.code(401).send({
          error: 'Project context missing',
        });
      }

      const logData = request.body;

      // Convert numeric log levels (Pino/Bunyan format) and syslog levels to string
      const normalizeLevel = (level: any): string => {
        // Handle numeric levels (Pino/Bunyan format)
        if (typeof level === 'number' || !isNaN(Number(level))) {
          const numLevel = Number(level);
          if (numLevel >= 60) return 'critical';
          if (numLevel >= 50) return 'error';
          if (numLevel >= 40) return 'warn';
          if (numLevel >= 30) return 'info';
          return 'debug';
        }

        // Handle string levels (including syslog levels)
        if (typeof level === 'string') {
          const lowerLevel = level.toLowerCase().trim();

          // Map syslog and common log levels to LogWard's 5 levels
          switch (lowerLevel) {
            // Critical levels
            case 'emergency':
            case 'emerg':
            case 'alert':
            case 'crit':
            case 'critical':
            case 'fatal':
              return 'critical';

            // Error levels
            case 'error':
            case 'err':
              return 'error';

            // Warning levels
            case 'warning':
            case 'warn':
              return 'warn';

            // Info levels
            case 'notice':
            case 'info':
            case 'information':
              return 'info';

            // Debug levels
            case 'debug':
            case 'trace':
            case 'verbose':
              return 'debug';

            default:
              // If it's already a valid level, return it
              if (['debug', 'info', 'warn', 'error', 'critical'].includes(lowerLevel)) {
                return lowerLevel;
              }
              return 'info'; // Default fallback
          }
        }

        return 'info'; // Default fallback for undefined/null
      };

      // Normalize fields from Fluent Bit format to LogWard format
      const log = {
        time: logData.time || (logData.date ? new Date(logData.date * 1000).toISOString() : new Date().toISOString()),
        service: logData.service || logData.container_name || 'unknown',
        level: normalizeLevel(logData.level),
        message: logData.message || logData.log || '',
        metadata: {
          ...logData.metadata,
          container_id: logData.container_id,
          container_short_id: logData.container_short_id,
        },
      };

      // Validate normalized log
      const parseResult = logSchema.safeParse(log);

      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parseResult.error.format(),
        });
      }

      // Wrap single log in array and ingest
      const received = await ingestionService.ingestLogs([parseResult.data], projectId);

      return {
        received,
        timestamp: new Date().toISOString(),
      };
    },
  });

  // POST /api/v1/ingest - Ingest logs
  fastify.post('/api/v1/ingest', {
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_MAX, // configurable via RATE_LIMIT_MAX env var
        timeWindow: config.RATE_LIMIT_WINDOW
      }
    },
    schema: {
      description: 'Ingest logs in batch',
      tags: ['ingestion'],
      body: {
        type: 'object',
        properties: {
          logs: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            received: { type: 'number' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: any, reply) => {
      // Validate request body
      const parseResult = ingestRequestSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parseResult.error.format(),
        });
      }

      const { logs } = parseResult.data;

      // Get projectId from authenticated request (set by auth plugin)
      const projectId = request.projectId;

      if (!projectId) {
        return reply.code(401).send({
          error: 'Project context missing',
        });
      }

      // Ingest logs
      const received = await ingestionService.ingestLogs(logs, projectId);

      return {
        received,
        timestamp: new Date().toISOString(),
      };
    },
  });

  // GET /api/v1/stats - Get log statistics
  fastify.get('/api/v1/stats', {
    schema: {
      description: 'Get log statistics',
      tags: ['ingestion'],
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request: any, reply) => {
      const { from, to } = request.query as { from?: string; to?: string };

      // Get projectId from authenticated request (set by auth plugin)
      const projectId = request.projectId;

      if (!projectId) {
        return reply.code(401).send({
          error: 'Project context missing',
        });
      }

      const stats = await ingestionService.getStats(
        projectId,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );

      return stats;
    },
  });
};

export default ingestionRoutes;
