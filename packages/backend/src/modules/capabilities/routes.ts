import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { OrganizationsService } from '../organizations/service.js';
import { capabilities } from '../../capabilities/index.js';

const organizationsService = new OrganizationsService();

const querySchema = z.object({
  organizationId: z.string().guid(),
});

async function checkMembership(userId: string, orgId: string): Promise<boolean> {
  const orgs = await organizationsService.getUserOrganizations(userId);
  return orgs.some((o) => o.id === orgId);
}

export async function capabilitiesRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  // GET /api/v1/capabilities?organizationId=...
  // Returns the merged capability set (booleans, static limits, quota caps).
  // Caps only; not live usage. Frontend uses it to gate UI.
  fastify.get('/', async (request: any, reply) => {
    try {
      const q = querySchema.parse(request.query);
      if (!(await checkMembership(request.user.id, q.organizationId))) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const list = await capabilities.list(q.organizationId);
      return reply.send({ capabilities: list });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: e.issues });
      }
      throw e;
    }
  });
}
