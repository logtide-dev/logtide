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

      // Detect if this is a systemd-journald formatted log
      const isJournaldFormat = (data: any): boolean => {
        // journald logs have specific fields starting with underscore
        return data._SYSTEMD_UNIT || data._COMM || data._EXE ||
               data.SYSLOG_IDENTIFIER || data.MESSAGE !== undefined ||
               data.PRIORITY !== undefined || data._HOSTNAME;
      };

      // Extract service name from journald fields
      const extractJournaldService = (data: any): string => {
        // Priority order for service name extraction
        if (data.SYSLOG_IDENTIFIER) return data.SYSLOG_IDENTIFIER;
        if (data._SYSTEMD_UNIT) {
          // Remove .service suffix for cleaner display
          return data._SYSTEMD_UNIT.replace(/\.service$/, '');
        }
        if (data._COMM) return data._COMM;
        if (data._EXE) {
          // Extract basename from path
          const parts = data._EXE.split('/');
          return parts[parts.length - 1];
        }
        return 'unknown';
      };

      // Extract message from journald format
      const extractJournaldMessage = (data: any): string => {
        // MESSAGE is the standard journald field
        if (data.MESSAGE) return data.MESSAGE;
        // Fallback to other common fields
        if (data.message) return data.message;
        if (data.log) return data.log;
        return '';
      };

      // Convert syslog PRIORITY (0-7) to LogWard level
      const priorityToLevel = (priority: number | string): string => {
        const p = typeof priority === 'string' ? parseInt(priority, 10) : priority;
        // Syslog priority levels: 0=emerg, 1=alert, 2=crit, 3=err, 4=warning, 5=notice, 6=info, 7=debug
        if (p <= 2) return 'critical';  // emerg, alert, crit
        if (p === 3) return 'error';     // err
        if (p === 4) return 'warn';      // warning
        if (p <= 6) return 'info';       // notice, info
        return 'debug';                   // debug
      };

      // Extract journald metadata fields (underscore-prefixed)
      const extractJournaldMetadata = (data: any): Record<string, unknown> => {
        const metadata: Record<string, unknown> = {};
        const journaldFields = [
          '_HOSTNAME', '_MACHINE_ID', '_BOOT_ID', '_PID', '_UID', '_GID',
          '_COMM', '_EXE', '_CMDLINE', '_SYSTEMD_CGROUP', '_SYSTEMD_UNIT',
          '_SYSTEMD_SLICE', '_SYSTEMD_USER_UNIT', '_STREAM_ID', '_TRANSPORT',
          'SYSLOG_FACILITY', 'SYSLOG_IDENTIFIER', 'SYSLOG_PID',
          '_SELINUX_CONTEXT', '_RUNTIME_SCOPE', '_SYSTEMD_CGROUP'
        ];
        for (const field of journaldFields) {
          if (data[field] !== undefined) {
            metadata[field] = data[field];
          }
        }
        return metadata;
      };

      // Extract timestamp from journald fields (microseconds epoch, already UTC)
      const extractJournaldTimestamp = (data: any): string | null => {
        // Priority: __REALTIME_TIMESTAMP > _SOURCE_REALTIME_TIMESTAMP
        // These are in microseconds since epoch (UTC)
        const realtimeTs = data.__REALTIME_TIMESTAMP || data._SOURCE_REALTIME_TIMESTAMP;
        if (realtimeTs) {
          try {
            const microseconds = typeof realtimeTs === 'string' ? parseInt(realtimeTs, 10) : realtimeTs;
            const milliseconds = Math.floor(microseconds / 1000);
            return new Date(milliseconds).toISOString();
          } catch {
            // Invalid timestamp, fall through
          }
        }
        return null;
      };

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

      // Build log object based on format detection
      let log;

      if (isJournaldFormat(logData)) {
        // systemd-journald format - extract from journald-specific fields
        const journaldMetadata = extractJournaldMetadata(logData);

        // Get level from PRIORITY field if available, otherwise from level field
        const level = logData.PRIORITY !== undefined
          ? priorityToLevel(logData.PRIORITY)
          : normalizeLevel(logData.level);

        // Get timestamp: prefer journald's __REALTIME_TIMESTAMP (already UTC),
        // then fall back to syslog timestamp from Fluent Bit
        const journaldTime = extractJournaldTimestamp(logData);
        const time = journaldTime
          || logData.time
          || (logData.date ? new Date(logData.date * 1000).toISOString() : new Date().toISOString());

        log = {
          time,
          service: logData.service || extractJournaldService(logData),
          level,
          message: extractJournaldMessage(logData),
          metadata: {
            ...logData.metadata,
            ...journaldMetadata,
            container_id: logData.container_id,
            container_short_id: logData.container_short_id,
            source: 'journald',
          },
        };
      } else {
        // Standard Fluent Bit format
        log = {
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
      }

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
