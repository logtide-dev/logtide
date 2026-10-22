import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  INCIDENT_SOURCES,
  type IncidentListItem,
  type IncidentSource,
  type IncidentStreamEvent,
} from '@logtide/shared';
import { SiemService } from './service.js';
import { incidentsService } from '../incidents/service.js';
import { listParam } from '../incidents/query-params.js';
import { OrganizationsService } from '../organizations/service.js';
import { UsersService } from '../users/service.js';
import { db } from '../../database/index.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';
import { streamTicketService } from '../streaming/stream-ticket-service.js';

const siemService = new SiemService(db);
const organizationsService = new OrganizationsService();
const usersService = new UsersService();

/**
 * Incident changes are polled with this overlap behind the cursor, so a
 * change committed late (its transaction started before the cursor moved,
 * so its updated_at is older than rows already seen) is still delivered.
 */
export const INCIDENT_STREAM_OVERLAP_MS = 5000;

const INCIDENT_PAGE_SIZE = 100;
/** Ids announced as incident_created on one connection (oldest dropped beyond this). */
const MAX_ANNOUNCED_IDS = 1000;

/**
 * Per-connection state of the incident change feed (every source).
 * - Rows come oldest change first from `listUpdatedSince(since)`, with
 *   `since = cursor - INCIDENT_STREAM_OVERLAP_MS`.
 * - A row is emitted when its updatedAt is newer than the last one emitted
 *   for that id (or than the connection time minus the overlap).
 * - `incident_created` when the incident was created after the connection
 *   (minus the overlap) and was never announced before, else
 *   `incident_updated`.
 * - A full page means more changes than one page inside the window: the
 *   next poll continues after the page instead of re-reading the overlap,
 *   so the feed never stalls (a late commit inside such a burst can be
 *   missed).
 */
export class IncidentChangeFeed {
  private cursor: number;
  private nextSince: number;
  private readonly emitted = new Map<string, number>();
  private readonly announced = new Set<string>();

  constructor(private readonly connectedAt: number) {
    this.cursor = connectedAt;
    this.nextSince = connectedAt - INCIDENT_STREAM_OVERLAP_MS;
  }

  /** Lower bound (exclusive) of the next `listUpdatedSince` call. */
  get since(): Date {
    return new Date(this.nextSince);
  }

  /** Consumes one page fetched with `since`; returns the events to send, in order. */
  consume(rows: IncidentListItem[], pageSize: number): IncidentStreamEvent[] {
    const since = this.nextSince;
    const floor = this.connectedAt - INCIDENT_STREAM_OVERLAP_MS;
    const out: IncidentStreamEvent[] = [];
    let pageMax = since;

    for (const row of rows) {
      const u = new Date(row.updatedAt).getTime();
      pageMax = Math.max(pageMax, u);
      if (u < since || u <= (this.emitted.get(row.id) ?? floor)) continue;

      const isNew =
        !this.emitted.has(row.id) &&
        !this.announced.has(row.id) &&
        new Date(row.createdAt).getTime() > floor;
      if (isNew) {
        this.announced.add(row.id);
        if (this.announced.size > MAX_ANNOUNCED_IDS) {
          const oldest = this.announced.values().next().value;
          if (oldest !== undefined) this.announced.delete(oldest);
        }
      }
      out.push({ type: isNew ? 'incident_created' : 'incident_updated', data: row });
      this.emitted.set(row.id, u);
    }

    this.cursor = Math.max(this.cursor, pageMax);
    const keepFrom = this.cursor - INCIDENT_STREAM_OVERLAP_MS;
    for (const [id, u] of this.emitted) {
      if (u < keepFrom) this.emitted.delete(id);
    }

    if (rows.length >= pageSize) {
      this.nextSince = pageMax > since ? pageMax : since + 1;
    } else {
      this.nextSince = keepFrom;
    }
    return out;
  }
}

/**
 * Check if user is member of organization
 */
async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}

/**
 * Register SSE endpoint for real-time SIEM updates
 */
export async function registerSiemSseRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/siem/events
   * Server-Sent Events stream for real-time updates
   * Streams: new detections, new incidents and incident updates of every
   * source (optionally filtered by `source`)
   */
  fastify.get(
    '/api/v1/siem/events',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        querystring: {
          type: 'object',
          required: ['organizationId'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            incidentId: { type: 'string', format: 'uuid' },
            // Incident sources (repeated or comma separated); detections are
            // streamed only when sigma is included or no source is given.
            source: { type: 'array', items: { type: 'string' } },
            // Either a single-use stream ticket (preferred) or a legacy session
            // token must be provided; EventSource cannot send an auth header.
            ticket: { type: 'string' },
            token: { type: 'string' },
          },
        },
      },
    },
    async (request: any, reply) => {
      try {
        const schema = z.object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          incidentId: z.string().uuid().optional(),
          source: listParam(z.enum(INCIDENT_SOURCES)),
          ticket: z.string().min(1).optional(),
          token: z.string().min(1).optional(),
        });

        const query = schema.parse(request.query);

        // Check for auth-free mode first
        const authMode = await settingsService.getAuthMode();
        let user;

        if (authMode === 'none') {
          // Auth-free mode: use default user
          user = await bootstrapService.getDefaultUser();
          if (!user) {
            return reply.status(503).send({
              error: 'Auth-free mode enabled but default user not configured',
            });
          }
        } else if (request.user) {
          // The auth plugin already authenticated the request (it consumes the
          // single-use ticket or validates the token): a second consume would fail.
          user = request.user;
        } else if (query.ticket) {
          // Preferred: single-use stream ticket (keeps the session token out of the URL)
          const userId = await streamTicketService.consumeTicket(query.ticket);
          user = userId ? await usersService.getUserById(userId) : null;
          if (!user) {
            return reply.status(401).send({
              error: 'Invalid or expired stream ticket',
            });
          }
        } else if (query.token) {
          // Legacy: validate session token from the query string
          user = await usersService.validateSession(query.token);
          if (!user) {
            return reply.status(401).send({
              error: 'Invalid or expired session token',
            });
          }
        } else {
          return reply.status(401).send({
            error: 'A stream ticket or session token is required',
          });
        }

        // Verify user is member of organization
        const isMember = await checkOrganizationMembership(
          user.id,
          query.organizationId
        );

        if (!isMember) {
          return reply.status(403).send({
            error: 'You are not a member of this organization',
          });
        }

        // Set CORS headers (required when using reply.raw)
        const origin = request.headers.origin || 'http://localhost:3000';
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

        // Set headers for SSE
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        const sources: IncidentSource[] | undefined =
          query.source && query.source.length > 0 ? query.source : undefined;
        const streamDetections = !sources || sources.includes('sigma');

        // Detection cursor: the query is `time >= cursor`, so the ids already
        // sent at the cursor time are remembered instead of being re-sent.
        let lastDetectionTime = new Date();
        let sentAtDetectionCursor = new Set<string>();
        const incidentFeed = new IncidentChangeFeed(Date.now());
        // Watched incident (incidentId): emit when its updatedAt moves.
        let lastIncidentUpdate = new Date();

        const send = (event: IncidentStreamEvent) => {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        // Send initial connection message
        const connectedMsg = JSON.stringify({ type: 'connected', timestamp: new Date() });
        reply.raw.write(`data: ${connectedMsg}\n\n`);

        // Poll for new events every 2 seconds
        const intervalId = setInterval(async () => {
          try {
            if (streamDetections) {
              const newDetections = await siemService.getDetectionEvents({
                organizationId: query.organizationId,
                projectId: query.projectId,
                startTime: lastDetectionTime,
                limit: 50,
              });

              let latest = lastDetectionTime.getTime();
              for (const detection of newDetections) {
                latest = Math.max(latest, new Date(detection.time).getTime());
              }
              for (const detection of newDetections) {
                if (sentAtDetectionCursor.has(detection.id)) continue;
                send({ type: 'detection_created', data: detection });
              }
              if (latest > lastDetectionTime.getTime()) {
                lastDetectionTime = new Date(latest);
                sentAtDetectionCursor = new Set();
              }
              for (const detection of newDetections) {
                if (new Date(detection.time).getTime() === lastDetectionTime.getTime()) {
                  sentAtDetectionCursor.add(detection.id);
                }
              }
            }

            if (!query.incidentId) {
              // New and updated incidents of every requested source
              const rows = await incidentsService.listUpdatedSince({
                organizationId: query.organizationId,
                projectId: query.projectId,
                sources,
                since: incidentFeed.since,
                limit: INCIDENT_PAGE_SIZE,
              });
              for (const event of incidentFeed.consume(rows, INCIDENT_PAGE_SIZE)) {
                send(event);
              }
            } else {
              // Watch specific incident for updates
              const incident = await incidentsService.getItem(query.incidentId, query.organizationId);

              if (incident) {
                const incidentTime = new Date(incident.updatedAt || incident.createdAt);
                if (incidentTime > lastIncidentUpdate) {
                  send({ type: 'incident_updated', data: incident });
                  lastIncidentUpdate = incidentTime;
                }
              }
            }

            // Send heartbeat to keep connection alive
            reply.raw.write(`: heartbeat\n\n`);
          } catch (error) {
            console.error('Error in SIEM SSE stream:', error);
            // Don't close connection on query errors, just log
          }
        }, 2000); // Poll every 2 seconds

        // Clean up on client disconnect
        request.raw.on('close', () => {
          clearInterval(intervalId);
          console.log('SIEM SSE client disconnected');
        });

        // Keep connection open
        reply.hijack();
      } catch (error: any) {
        // Handle Zod validation errors with 400
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }
        console.error('Error setting up SIEM SSE:', error);
        return reply.status(500).send({
          error: 'Failed to establish SSE connection',
          details: error.message,
        });
      }
    }
  );
}
