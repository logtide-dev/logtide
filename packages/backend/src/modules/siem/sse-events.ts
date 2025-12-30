import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SiemService } from './service.js';
import { OrganizationsService } from '../organizations/service.js';
import { UsersService } from '../users/service.js';
import { db } from '../../database/index.js';
import { settingsService } from '../settings/service.js';
import { bootstrapService } from '../bootstrap/service.js';

const siemService = new SiemService(db);
const organizationsService = new OrganizationsService();
const usersService = new UsersService();

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
   * Server-Sent Events stream for real-time SIEM updates
   * Streams: new detections, new incidents, incident updates
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
          required: ['organizationId', 'token'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            incidentId: { type: 'string', format: 'uuid' },
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
          token: z.string().min(1),
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
        } else {
          // Standard mode: validate session token
          user = await usersService.validateSession(query.token);
          if (!user) {
            return reply.status(401).send({
              error: 'Invalid or expired session token',
            });
          }
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

        // Track last timestamps to detect new items
        let lastDetectionTime = new Date();
        let lastIncidentUpdate = new Date();

        // Send initial connection message
        const connectedMsg = JSON.stringify({ type: 'connected', timestamp: new Date() });
        reply.raw.write(`data: ${connectedMsg}\n\n`);

        // Poll for new events every 2 seconds
        const intervalId = setInterval(async () => {
          try {
            // Check for new detection events
            const newDetections = await siemService.getDetectionEvents({
              organizationId: query.organizationId,
              projectId: query.projectId,
              startTime: lastDetectionTime,
              limit: 50,
            });

            if (newDetections.length > 0) {
              // Update last detection time
              const latestDetection = newDetections[0];
              if (latestDetection.time > lastDetectionTime) {
                lastDetectionTime = latestDetection.time;
              }

              // Send detection events
              for (const detection of newDetections) {
                const msg = JSON.stringify({ type: 'detection_created', data: detection });
                reply.raw.write(`data: ${msg}\n\n`);
              }
            }

            // Check for new/updated incidents (if not watching a specific incident)
            if (!query.incidentId) {
              const incidents = await siemService.listIncidents({
                organizationId: query.organizationId,
                projectId: query.projectId,
                limit: 20,
              });

              // Check for new or updated incidents
              for (const incident of incidents) {
                const incidentTime = new Date(incident.updatedAt || incident.createdAt);
                if (incidentTime > lastIncidentUpdate) {
                  const isNew = new Date(incident.createdAt) > lastIncidentUpdate;
                  const msg = JSON.stringify({
                    type: isNew ? 'incident_created' : 'incident_updated',
                    data: incident,
                  });
                  reply.raw.write(`data: ${msg}\n\n`);
                }
              }

              if (incidents.length > 0) {
                const latestTime = Math.max(
                  ...incidents.map((i) =>
                    new Date(i.updatedAt || i.createdAt).getTime()
                  )
                );
                if (latestTime > lastIncidentUpdate.getTime()) {
                  lastIncidentUpdate = new Date(latestTime);
                }
              }
            } else {
              // Watch specific incident for updates
              const incident = await siemService.getIncident(
                query.incidentId,
                query.organizationId
              );

              if (incident) {
                const incidentTime = new Date(incident.updatedAt || incident.createdAt);
                if (incidentTime > lastIncidentUpdate) {
                  const msg = JSON.stringify({
                    type: 'incident_updated',
                    data: incident,
                  });
                  reply.raw.write(`data: ${msg}\n\n`);
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
