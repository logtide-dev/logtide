import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { OrgRole } from '@logtide/shared';
import { authenticate } from '../modules/auth/middleware.js';
import { OrganizationsService } from '../modules/organizations/service.js';
import type { ExtensionAuth } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `api.auth.requireOrgRole` on extension routes. */
    extOrg?: { id: string; role: OrgRole };
  }
}

const organizationsService = new OrganizationsService();

// Any value matching this shape is accepted by Postgres' uuid type, so a
// passing orgId can never turn into a cast error (500) downstream.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireSession: preHandlerHookHandler = authenticate;

function orgRoleCheck(roles: readonly OrgRole[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request.params as Record<string, unknown> | undefined)?.orgId;
    if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
      return reply.status(404).send({ error: 'not_found' });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const role = await organizationsService.getMemberRole(orgId, request.user.id);
    if (!role) {
      return reply.status(404).send({ error: 'not_found' });
    }
    if (!roles.includes(role)) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    request.extOrg = { id: orgId, role };
  };
}

export const extensionAuth: ExtensionAuth = {
  requireSession,
  requireOrgRole(roles) {
    return [requireSession, orgRoleCheck([...roles])];
  },
};
