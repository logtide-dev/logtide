import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrganizationsService } from './service.js';
import { authenticate } from '../auth/middleware.js';
import type { OrgRole } from '@logtide/shared';
import { auditLogService } from '../audit-log/index.js';
import { config } from '../../config/index.js';
import { withLimitLock } from '../../capabilities/limit-lock.js';
import { startOfUtcMonth } from '../../capabilities/month.js';
import { isUpgradeHandoffActive, signUpgradeToken, buildUpgradeUrl } from './upgrade-handoff.js';
import { termsAcceptanceService } from '../users/terms.js';
import { isBillingApiActive } from '../billing/seam.js';
import { billingRoutes } from '../billing/routes.js';

const organizationsService = new OrganizationsService();

const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  description: z.string().optional(),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(2).max(50).optional(),
  description: z.string().optional(),
});

const organizationIdSchema = z.object({
  id: z.string().uuid('Invalid organization ID format'),
});

const organizationSlugSchema = z.object({
  slug: z.string().min(1, 'Slug is required'),
});

const memberIdSchema = z.object({
  id: z.string().uuid('Invalid organization ID format'),
  memberId: z.string().uuid('Invalid member ID format'),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const transferOwnershipBodySchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
});

const upgradeHandoffBodySchema = z.object({
  intent: z.enum(['upgrade', 'manage']),
});

export async function organizationsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  // Signed handoff to the external billing portal. Registered ONLY when the
  // feature is configured (boot-time), so inactive = default Fastify 404.
  // Owner/admin of the org only. Uses the normal user session.
  if (isUpgradeHandoffActive()) fastify.post('/:id/upgrade-handoff', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);
      const { intent } = upgradeHandoffBodySchema.parse(request.body);

      const role = await organizationsService.getMemberRole(id, request.user.id);
      if (role !== 'owner' && role !== 'admin') {
        return reply.status(403).send({ error: 'Only organization owners and admins can manage billing' });
      }

      const cfg = config as { LOGTIDE_UPGRADE_URL?: string; LOGTIDE_UPGRADE_SIGNING_SECRET?: string };
      const token = signUpgradeToken(
        { org: id, user: request.user.id, email: request.user.email, role, intent },
        cfg.LOGTIDE_UPGRADE_SIGNING_SECRET!
      );
      return reply.send({ url: buildUpgradeUrl(cfg.LOGTIDE_UPGRADE_URL!, token) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request' });
      }
      throw error;
    }
  });

  // In-app billing proxy, registered only when the billing seam is configured.
  if (isBillingApiActive()) await fastify.register(billingRoutes);

  // Get all organizations for current user
  fastify.get('/', async (request: any, reply) => {
    const organizations = await organizationsService.getUserOrganizations(request.user.id);

    return reply.send({ organizations });
  });

  // Get a single organization by ID
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);

      const organization = await organizationsService.getOrganizationById(id, request.user.id);

      if (!organization) {
        return reply.status(404).send({
          error: 'Organization not found',
        });
      }

      return reply.send({ organization });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid organization ID format',
        });
      }

      throw error;
    }
  });

  // Get organization by slug
  fastify.get('/slug/:slug', async (request: any, reply) => {
    try {
      const { slug } = organizationSlugSchema.parse(request.params);

      const organization = await organizationsService.getOrganizationBySlug(slug, request.user.id);

      if (!organization) {
        return reply.status(404).send({
          error: 'Organization not found',
        });
      }

      return reply.send({ organization });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid slug format',
        });
      }

      throw error;
    }
  });

  // Get organization members with user details
  fastify.get('/:id/members', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);

      const members = await organizationsService.getOrganizationMembersWithDetails(id, request.user.id);

      return reply.send({ members });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid organization ID format',
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('do not have access')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Update member role (owner/admin only)
  fastify.put('/:id/members/:memberId/role', async (request: any, reply) => {
    try {
      const { id, memberId } = memberIdSchema.parse(request.params);
      const { role } = updateMemberRoleSchema.parse(request.body);

      await organizationsService.updateMemberRole(id, memberId, role as OrgRole, request.user.id);

      await auditLogService.record({
        action: 'user.role_changed',
        target: { type: 'organization_member', id: memberId },
        organizationId: id,
        metadata: { role },
      });

      return reply.send({ success: true });
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
        if (error.message.includes('Only the owner')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
        if (error.message.includes('Cannot demote yourself')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Remove member from organization (owner/admin only)
  fastify.delete('/:id/members/:memberId', async (request: any, reply) => {
    try {
      const { id, memberId } = memberIdSchema.parse(request.params);

      await organizationsService.removeMember(id, memberId, request.user.id);

      await auditLogService.record({
        action: 'user.removed',
        target: { type: 'organization_member', id: memberId },
        organizationId: id,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid ID format',
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('not a member')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
        if (error.message.includes('Only owners and admins')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
        if (error.message.includes('Cannot remove yourself')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
        if (error.message.includes('Cannot remove the organization owner')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
        if (error.message.includes('Admins can only remove members')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Leave organization (self-removal)
  fastify.post('/:id/leave', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);

      await organizationsService.leaveOrganization(id, request.user.id);

      await auditLogService.record({
        action: 'user.left',
        target: { type: 'organization', id },
        organizationId: id,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid organization ID format',
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('not a member')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
        if (error.message.includes('Cannot leave as owner')) {
          return reply.status(400).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Transfer ownership (owner only). The previous owner becomes an admin.
  fastify.post('/:id/transfer-ownership', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);
      const { userId } = transferOwnershipBodySchema.parse(request.body);

      const result = await organizationsService.transferOwnership(id, request.user.id, userId);

      await auditLogService.record({
        action: 'org.ownership_transferred',
        target: { type: 'organization', id },
        organizationId: id,
        metadata: { previousOwnerId: result.previousOwnerId, newOwnerId: result.newOwnerId },
      });

      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('Only the organization owner')) {
          return reply.status(403).send({ error: error.message });
        }
        if (error.message.includes('not found')) {
          return reply.status(404).send({ error: error.message });
        }
        if (error.message.includes('already own') || error.message.includes('must be a member')) {
          return reply.status(400).send({ error: error.message });
        }
      }

      throw error;
    }
  });

  // Create a new organization
  fastify.post('/', async (request: any, reply) => {
    try {
      const body = createOrganizationSchema.parse(request.body);

      // Terms gate (no-op unless the LOGTIDE_TERMS_* seam is active), checked
      // before the per-user organization caps.
      if (await termsAcceptanceService.isPending(request.user.id)) {
        return reply.status(403).send({ error: 'terms_not_accepted' });
      }

      // One lock per user: the cap counts and the insert must not interleave
      // across parallel POSTs, otherwise both caps can be overshot.
      const outcome = await withLimitLock(`user:${request.user.id}`, 'organizations.create', async () => {
        const maxOwned = config.MAX_ORGANIZATIONS_PER_USER;
        if (maxOwned !== undefined) {
          const owned = await organizationsService.countOwnedOrganizations(request.user.id);
          if (owned >= maxOwned) {
            return {
              denied: {
                error: 'organization_limit_reached',
                message: `You can own at most ${maxOwned.toLocaleString('en-US')} organization${maxOwned === 1 ? '' : 's'}`,
              },
            };
          }
        }

        const maxCreations = config.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH;
        if (maxCreations !== undefined) {
          const createdThisMonth = await organizationsService.countCreationsSince(
            request.user.id,
            startOfUtcMonth(new Date()),
          );
          if (createdThisMonth >= maxCreations) {
            return {
              denied: {
                error: 'organization_creation_limit_reached',
                message: `You can create at most ${maxCreations.toLocaleString('en-US')} organization${maxCreations === 1 ? '' : 's'} per month`,
              },
            };
          }
        }

        const created = await organizationsService.createOrganization({
          userId: request.user.id,
          name: body.name,
          description: body.description,
        });
        return { organization: created };
      });

      if ('denied' in outcome) {
        return reply.status(403).send(outcome.denied);
      }
      const organization = outcome.organization;

      await auditLogService.record({
        action: 'org.created',
        target: { type: 'organization', id: organization.id },
        organizationId: organization.id,
        metadata: { name: organization.name },
      });

      return reply.status(201).send({ organization });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Update an organization
  fastify.put('/:id', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);
      const body = updateOrganizationSchema.parse(request.body);

      const organization = await organizationsService.updateOrganization(id, request.user.id, body);

      await auditLogService.record({
        action: 'org.updated',
        target: { type: 'organization', id },
        organizationId: id,
        metadata: body,
      });

      return reply.send({ organization });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        if (firstError?.path[0] === 'id') {
          return reply.status(400).send({
            error: 'Invalid organization ID format',
          });
        }
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
        if (error.message.includes('already exists')) {
          return reply.status(409).send({
            error: error.message,
          });
        }
        if (error.message.includes('Only the organization owner')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });

  // Delete an organization
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { id } = organizationIdSchema.parse(request.params);

      await organizationsService.deleteOrganization(id, request.user.id);

      await auditLogService.record({
        action: 'org.deleted',
        target: { type: 'organization', id },
        organizationId: id,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid organization ID format',
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
        if (error.message.includes('Only the organization owner')) {
          return reply.status(403).send({
            error: error.message,
          });
        }
      }

      throw error;
    }
  });
}
