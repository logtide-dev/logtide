import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { savedSearchCreateSchema, savedSearchUpdateSchema } from '@logtide/shared';
import type { OrgRole, SavedSearchState } from '@logtide/shared';
import { authenticate } from '../auth/middleware.js';
import { auditLogService } from '../audit-log/service.js';
import { context } from '@logtide/shared/context';
import { assertWithinLimit, withLimitLock } from '../../capabilities/index.js';
import { CapabilityError } from '../../capabilities/errors.js';
import { buildLogFilter, LogQueryError } from '../query/build-log-filter.js';
import {
  SavedSearchForbiddenError,
  SavedSearchNotFoundError,
  savedSearchesService,
} from './service.js';

// Saved log searches. Session auth only: API keys are project-scoped machine
// credentials and get 401 from `authenticate`.

const uuidSchema = z.string().uuid();

const isUuid = (value: unknown): value is string => uuidSchema.safeParse(value).success;

type MemberCheck = { ok: true; role: OrgRole } | { ok: false };

/** 400 without an organizationId, 403 when the caller is not a member. */
async function requireMember(
  reply: FastifyReply,
  userId: string,
  organizationId: unknown,
): Promise<MemberCheck> {
  if (organizationId === undefined || organizationId === null || organizationId === '') {
    reply.status(400).send({ error: 'organizationId required' });
    return { ok: false };
  }
  const role = isUuid(organizationId) ? await savedSearchesService.getMemberRole(organizationId, userId) : null;
  if (!role) {
    reply.status(403).send({ error: 'Forbidden' });
    return { ok: false };
  }
  return { ok: true, role };
}

/** `state.q` parses like `q` on /api/v1/logs and `state.projectIds` belong to the organization. */
async function checkState(reply: FastifyReply, organizationId: string, state: SavedSearchState): Promise<boolean> {
  try {
    buildLogFilter({ q: state.q });
  } catch (err) {
    if (err instanceof LogQueryError) {
      reply.status(400).send({ error: err.message, position: err.position });
      return false;
    }
    throw err;
  }
  if (!(await savedSearchesService.projectsBelongToOrg(organizationId, state.projectIds))) {
    reply.status(400).send({ error: 'Some projects do not belong to this organization' });
    return false;
  }
  return true;
}

function sendKnownError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof SavedSearchNotFoundError) {
    reply.status(404).send({ error: err.message });
    return true;
  }
  if (err instanceof SavedSearchForbiddenError) {
    reply.status(403).send({ error: err.message });
    return true;
  }
  if (err instanceof z.ZodError) {
    reply.status(400).send({ error: 'Validation error', details: err.errors });
    return true;
  }
  return false;
}

export async function savedSearchesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', authenticate);

  // List: own private searches plus every organization one.
  fastify.get('/', async (request: any, reply) => {
    const { organizationId } = (request.query ?? {}) as { organizationId?: string };
    const member = await requireMember(reply, request.user.id, organizationId);
    if (!member.ok) return reply;

    const savedSearches = await savedSearchesService.list(organizationId as string, request.user.id, member.role);
    return reply.send({ savedSearches });
  });

  // Create
  fastify.post('/', async (request: any, reply) => {
    try {
      const raw = (request.body ?? {}) as { organizationId?: unknown };
      if (raw.organizationId === undefined || raw.organizationId === null || raw.organizationId === '') {
        return reply.status(400).send({ error: 'organizationId required' });
      }
      const body = savedSearchCreateSchema.parse(request.body);
      const member = await requireMember(reply, request.user.id, body.organizationId);
      if (!member.ok) return reply;
      if (!(await checkState(reply, body.organizationId, body.state))) return reply;

      const orgId = body.organizationId;
      const savedSearch = await withLimitLock(orgId, 'saved_searches.max_per_org', async () => {
        await context.runAsSystem('saved-searches:create-limit-check', () =>
          context.with({ organizationId: orgId }, async () => {
            await assertWithinLimit('saved_searches.max_per_org', await savedSearchesService.countForOrg(orgId));
          }),
        );
        return savedSearchesService.create({
          organizationId: orgId,
          userId: request.user.id,
          name: body.name,
          visibility: body.visibility,
          state: body.state,
        });
      });

      await auditLogService.record({
        action: 'search.created',
        target: { type: 'saved_search', id: savedSearch.id },
        organizationId: body.organizationId,
        metadata: { name: savedSearch.name, visibility: savedSearch.visibility },
      });

      return reply.status(201).send({ savedSearch });
    } catch (err) {
      if (err instanceof CapabilityError) throw err;
      if (sendKnownError(reply, err)) return reply;
      throw err;
    }
  });

  // Update: name, visibility and/or state (replaced as a whole).
  fastify.patch('/:id', async (request: any, reply) => {
    try {
      const { organizationId } = (request.query ?? {}) as { organizationId?: string };
      const member = await requireMember(reply, request.user.id, organizationId);
      if (!member.ok) return reply;
      const orgId = organizationId as string;
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw new SavedSearchNotFoundError();

      const patch = savedSearchUpdateSchema.parse(request.body);
      if (patch.state !== undefined && !(await checkState(reply, orgId, patch.state))) return reply;

      const savedSearch = await savedSearchesService.update(id, orgId, request.user.id, member.role, patch);

      await auditLogService.record({
        action: 'search.updated',
        target: { type: 'saved_search', id: savedSearch.id },
        organizationId: orgId,
        metadata: { name: savedSearch.name, visibility: savedSearch.visibility },
      });

      return reply.send({ savedSearch });
    } catch (err) {
      if (sendKnownError(reply, err)) return reply;
      throw err;
    }
  });

  // Delete
  fastify.delete('/:id', async (request: any, reply) => {
    try {
      const { organizationId } = (request.query ?? {}) as { organizationId?: string };
      const member = await requireMember(reply, request.user.id, organizationId);
      if (!member.ok) return reply;
      const orgId = organizationId as string;
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw new SavedSearchNotFoundError();

      const deleted = await savedSearchesService.delete(id, orgId, request.user.id, member.role);

      await auditLogService.record({
        action: 'search.deleted',
        target: { type: 'saved_search', id: deleted.id },
        organizationId: orgId,
        metadata: { name: deleted.name, visibility: deleted.visibility },
      });

      return reply.status(204).send();
    } catch (err) {
      if (sendKnownError(reply, err)) return reply;
      throw err;
    }
  });
}
