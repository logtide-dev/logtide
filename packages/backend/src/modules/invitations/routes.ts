import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { invitationsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import type { OrgRole } from '@logward/shared';

const organizationIdSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID format'),
});

const invitationIdSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID format'),
  invitationId: z.string().uuid('Invalid invitation ID format'),
});

const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'member']).default('member'),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export async function invitationsRoutes(fastify: FastifyInstance) {
  // Get invitation details by token (public - for accept page preview)
  fastify.get('/token/:token', async (request: any, reply) => {
    try {
      const { token } = z.object({ token: z.string().min(1) }).parse(request.params);

      const result = await invitationsService.getInvitationByToken(token);

      if (!result) {
        return reply.status(404).send({
          error: 'Invitation not found or expired',
        });
      }

      // Don't expose sensitive info, just what's needed for the accept page
      return reply.send({
        email: result.invitation.email,
        role: result.invitation.role,
        organizationName: result.organizationName,
        inviterName: result.inviterName,
        expiresAt: result.invitation.expiresAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid token format',
        });
      }

      throw error;
    }
  });

  // Accept invitation (requires auth - user must be logged in)
  fastify.post('/accept', { onRequest: authenticate }, async (request: any, reply) => {
    try {
      const { token } = acceptInvitationSchema.parse(request.body);

      const result = await invitationsService.acceptInvitation({
        token,
        userId: request.user.id,
      });

      return reply.send({
        success: true,
        organizationId: result.organizationId,
        role: result.role,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('Invalid or already accepted')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
        if (error.message.includes('expired')) {
          return reply.status(410).send({
            error: error.message,
          });
        }
        if (error.message.includes('different email')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
        if (error.message.includes('already a member')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // All routes below require authentication
  fastify.register(async (authRoutes) => {
    authRoutes.addHook('onRequest', authenticate);

    // Invite a user to organization
    authRoutes.post('/:organizationId/invite', async (request: any, reply) => {
      try {
        const { organizationId } = organizationIdSchema.parse(request.params);
        const body = inviteUserSchema.parse(request.body);

        const result = await invitationsService.inviteUser({
          organizationId,
          email: body.email,
          role: body.role as OrgRole,
          invitedBy: request.user.id,
        });

        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation error',
            details: error.errors,
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('Only owners and admins')) {
            return reply.status(403).send({
              error: error.message,
            });
          }
          if (error.message.includes('already a member')) {
            return reply.status(409).send({
              error: error.message,
            });
          }
          if (error.message.includes('already been sent')) {
            return reply.status(409).send({
              error: error.message,
            });
          }
          if (error.message.includes('Email server is not configured')) {
            return reply.status(503).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    });

    // Get pending invitations for organization
    authRoutes.get('/:organizationId/invitations', async (request: any, reply) => {
      try {
        const { organizationId } = organizationIdSchema.parse(request.params);

        const invitations = await invitationsService.getPendingInvitations(
          organizationId,
          request.user.id
        );

        return reply.send({ invitations });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid organization ID format',
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('Only owners and admins')) {
            return reply.status(403).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    });

    // Revoke a pending invitation
    authRoutes.delete('/:organizationId/invitations/:invitationId', async (request: any, reply) => {
      try {
        const { organizationId, invitationId } = invitationIdSchema.parse(request.params);

        await invitationsService.revokeInvitation(invitationId, request.user.id, organizationId);

        return reply.status(204).send();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid ID format',
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('Only owners and admins')) {
            return reply.status(403).send({
              error: error.message,
            });
          }
          if (error.message.includes('not found or already accepted')) {
            return reply.status(404).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    });

    // Resend a pending invitation
    authRoutes.post('/:organizationId/invitations/:invitationId/resend', async (request: any, reply) => {
      try {
        const { organizationId, invitationId } = invitationIdSchema.parse(request.params);

        const result = await invitationsService.resendInvitation(
          invitationId,
          request.user.id,
          organizationId
        );

        // Email is queued in the service

        return reply.send({
          success: true,
          message: `Invitation resent to ${result.email}`,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Invalid ID format',
          });
        }

        if (error instanceof Error) {
          if (error.message.includes('Only owners and admins')) {
            return reply.status(403).send({
              error: error.message,
            });
          }
          if (error.message.includes('not found or already accepted')) {
            return reply.status(404).send({
              error: error.message,
            });
          }
          if (error.message.includes('Email server is not configured')) {
            return reply.status(503).send({
              error: error.message,
            });
          }
        }

        throw error;
      }
    });
  });
}
